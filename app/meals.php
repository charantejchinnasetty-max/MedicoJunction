<?php
declare(strict_types=1);
function activeMeal(array $meals, DateTimeImmutable $at): ?array {
    $t=$at->format('H:i:s');
    foreach($meals as $m) if($m['status'] && $t >= $m['start_time'] && ($m['end_inclusive'] ? $t <= $m['end_time'] : $t < $m['end_time'])) return $m;
    return null;
}
function serviceStatus(array $meals, DateTimeImmutable $at): array {
    $current=activeMeal($meals,$at);
    if($current) return ['open'=>true,'meal'=>$current,'message'=>$current['meal_name'].' service is open.'];
    $active=array_values(array_filter($meals,fn($m)=>$m['status']));
    usort($active,fn($a,$b)=>strcmp($a['start_time'],$b['start_time']));
    foreach($active as $m) if($at->format('H:i:s') < $m['start_time']) return ['open'=>false,'meal'=>null,'message'=>'Meal service is currently closed. '.$m['meal_name'].' starts at '.date('g:i A',strtotime($m['start_time'])).'.'];
    $last=$active ? $active[count($active)-1]['meal_name'] : 'Meal';
    return ['open'=>false,'meal'=>null,'message'=>$last.' service is closed for today.'];
}
function validateWindows(array $list): void {
    $active=[];
    foreach($list as $m) {
        foreach(['start_time','end_time'] as $k) if(!preg_match('/^(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d$/',$m[$k])) throw new InvalidArgumentException('Enter valid meal times.');
        if($m['start_time'] >= $m['end_time']) throw new InvalidArgumentException('Each meal must end after it starts, on the same day.');
        if($m['status']) $active[]=$m;
    }
    usort($active,fn($a,$b)=>strcmp($a['start_time'],$b['start_time']));
    for($i=1;$i<count($active);$i++) if($active[$i]['start_time'] < $active[$i-1]['end_time'] || ($active[$i]['start_time']===$active[$i-1]['end_time'] && $active[$i-1]['end_inclusive'])) throw new InvalidArgumentException('Active meal windows must not overlap.');
}
function qrSecret(): string {
    $key=getenv('MJ_QR_SECRET') ?: @file_get_contents(ROOT.'/storage/qr.key');
    if(!$key || strlen($key)<32) throw new RuntimeException('QR signing key is missing. Run the migration.');
    return trim($key);
}
function b64(string $s): string { return rtrim(strtr(base64_encode($s),'+/','-_'),'='); }
function issueToken(): array {
    $at=now(); $iat=$at->getTimestamp(); $ttl=max(30,min(60,(int)setting('qr_ttl','60')));
    $payload=b64(json_encode(['v'=>1,'nonce'=>bin2hex(random_bytes(24)),'iat'=>$iat,'exp'=>$iat+$ttl]));
    $token=$payload.'.'.hash_hmac('sha256',$payload,qrSecret());
    query('INSERT INTO qr_tokens(token_hash,issued_at,expires_at,status) VALUES(?,?,?,1)',[hash('sha256',$token),$at->format('Y-m-d H:i:s'),$at->modify("+$ttl seconds")->format('Y-m-d H:i:s')]);
    return ['token'=>$token,'expires_at'=>$iat+$ttl,'server_time'=>$iat,'ttl'=>$ttl,'service'=>serviceStatus(meals(),$at)];
}
function validateToken(string $token,DateTimeImmutable $at): array {
    if(strlen($token)>1024 || !preg_match('/^([A-Za-z0-9_-]+)\.([a-f0-9]{64})$/',$token,$m) || !hash_equals(hash_hmac('sha256',$m[1] ?? '',qrSecret()),$m[2] ?? '')) return ['code'=>'INVALID_QR','message'=>'Invalid QR. Scan the Medico Junction counter QR.'];
    $p=json_decode(base64_decode(strtr($m[1],'-_','+/'),true) ?: '',true);
    if(!is_array($p) || ($p['v'] ?? 0)!==1 || !is_int($p['iat'] ?? null) || !is_int($p['exp'] ?? null) || $p['iat']>$at->getTimestamp() || $p['exp']-$p['iat']>60 || $p['exp']<=$p['iat']) return ['code'=>'INVALID_QR','message'=>'Invalid QR token.'];
    if($p['exp']<=$at->getTimestamp()) return ['code'=>'QR_EXPIRED','message'=>'QR expired. Please scan the latest QR displayed at the counter.'];
    $row=one('SELECT * FROM qr_tokens WHERE token_hash=? AND status=1',[hash('sha256',$token)]);
    if(!$row || strtotime($row['expires_at'])<=$at->getTimestamp()) return ['code'=>'INVALID_QR','message'=>'QR is no longer valid. Scan the latest counter QR.'];
    return ['row'=>$row];
}
function recordMeal(int $employeeId,string $token,?DateTimeImmutable $testTime=null): array {
    // The optional clock is for isolated CLI tests only; no HTTP input is passed here.
    $at=PHP_SAPI==='cli' && $testTime ? $testTime : now();
    $valid=validateToken($token,$at);
    if(isset($valid['code'])) return ['success'=>false]+$valid;
    $pdo=db(); $pdo->beginTransaction();
    try {
        $employee=one('SELECT * FROM employees WHERE id=? AND active=1 AND deleted_at IS NULL FOR UPDATE',[$employeeId]);
        if(!$employee) { $pdo->rollBack(); return ['success'=>false,'code'=>'ACCOUNT_UNAVAILABLE','message'=>'This employee account is inactive.']; }
        $meal=activeMeal(rows('SELECT * FROM meal_types ORDER BY display_order LOCK IN SHARE MODE'),$at);
        if(!$meal) { $pdo->rollBack(); return ['success'=>false,'code'=>'MEAL_CLOSED','message'=>serviceStatus(meals(),$at)['message']]; }
        $args=[$employeeId,$at->format('Y-m-d'),$meal['id']];
        $existing=one('SELECT * FROM meal_attendance WHERE employee_id=? AND meal_date=? AND meal_type_id=?',$args);
        if($existing && $existing['status']==='valid') { $pdo->rollBack(); return duplicateResult($meal,$existing); }
        // A voided record can only be restored by an administrator, preserving the correction trail.
        if($existing) { $pdo->rollBack(); return ['success'=>false,'code'=>'ADMIN_REVIEW','message'=>'This meal was corrected by an administrator. Contact the mess manager.']; }
        query("INSERT INTO meal_attendance(employee_id,meal_date,meal_type_id,scan_timestamp,qr_token_id,source,status) VALUES(?,?,?,?,?,'scan','valid')",array_merge($args,[$at->format('Y-m-d H:i:s'),$valid['row']['id']]));
        $pdo->commit();
        return ['success'=>true,'code'=>'MEAL_RECORDED','message'=>$meal['meal_name'].' recorded successfully. Enjoy your meal!','data'=>['employee'=>$employee['employee_name'],'meal'=>$meal['meal_name'],'date'=>$at->format('Y-m-d'),'time'=>$at->format('H:i:s')]];
    } catch(PDOException $ex) {
        if($pdo->inTransaction()) $pdo->rollBack();
        if(($ex->errorInfo[1] ?? 0)===1062) {
            $existing=one('SELECT * FROM meal_attendance WHERE employee_id=? AND meal_date=? AND meal_type_id=?',$args);
            if($existing) return duplicateResult($meal,$existing);
        }
        throw $ex;
    } catch(Throwable $ex) { if($pdo->inTransaction()) $pdo->rollBack(); throw $ex; }
}
function duplicateResult(array $meal,array $existing): array {
    $t=$existing['scan_timestamp'] ? date('g:i A',strtotime($existing['scan_timestamp'])) : 'an unknown time (legacy attendance)';
    return ['success'=>false,'code'=>'ALREADY_RECORDED','message'=>$meal['meal_name'].' already recorded today at '.$t.'.','data'=>['recorded_time'=>$existing['scan_timestamp'] ? substr($existing['scan_timestamp'],11) : null]];
}
