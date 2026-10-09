<?php
declare(strict_types=1);
function cleanText(string $key,int $max,bool $required=false): string {
    $v=trim((string)($_POST[$key] ?? ''));
    if(strlen($v)>$max || ($required && $v==='')) throw new InvalidArgumentException('Please enter a valid '.str_replace('_',' ',$key).'.');
    return $v;
}
function uploadImage(string $field): ?string {
    if(empty($_FILES[$field]) || $_FILES[$field]['error']===UPLOAD_ERR_NO_FILE) return null;
    $f=$_FILES[$field];
    if($f['error']!==UPLOAD_ERR_OK || $f['size']>2*1024*1024) throw new InvalidArgumentException('Upload a JPG or PNG image smaller than 2 MB.');
    $info=@getimagesize($f['tmp_name']);
    if(!$info || !in_array($info['mime'],['image/jpeg','image/png'],true) || $info[0]>3000 || $info[1]>3000) throw new InvalidArgumentException('Choose a JPG or PNG image up to 3000 × 3000 pixels.');
    $image=$info['mime']==='image/png'?@imagecreatefrompng($f['tmp_name']):@imagecreatefromjpeg($f['tmp_name']);
    if(!$image) throw new InvalidArgumentException('The image could not be read.');
    $path='assets/uploads/'.bin2hex(random_bytes(16)).'.png';
    imagealphablending($image,false); imagesavealpha($image,true);
    if(!imagepng($image,ROOT.'/'.$path)) throw new RuntimeException('Cannot save upload.');
    imagedestroy($image); return $path;
}
function saveEmployee(): void {
    $id=(int)($_POST['id'] ?? 0); $old=$id?one('SELECT * FROM employees WHERE id=?',[$id]):null;
    if($id && !$old) throw new InvalidArgumentException('Employee not found.');
    if($old && $old['deleted_at']!==null) throw new InvalidArgumentException('Restore this deleted employee before editing their profile.');
    $name=cleanText('employee_name',100,true); $code=cleanText('employee_code',20,true); $mobile=normalizeMobile(cleanText('mobile',15,true));
    if(!preg_match('/^[6-9][0-9]{9}$/',$mobile)) throw new InvalidArgumentException('Enter a valid mobile number.');
    $dept=cleanText('department',50); $designation=cleanText('designation',100); $join=cleanText('joining_date',10);
    if($join!=='' && !validDate($join)) throw new InvalidArgumentException('Enter a valid joining date.');
    $active=isset($_POST['active'])?1:0; $resetPassword=!$id || isset($_POST['reset_password']);
    $photo=uploadImage('photo') ?? ($old['photo'] ?? null);
    $pdo=db(); $pdo->beginTransaction();
    try {
        $departmentId=null;
        if($dept!=='') { query('INSERT IGNORE INTO departments(department_name) VALUES(?)',[$dept]); $departmentId=one('SELECT id FROM departments WHERE department_name=?',[$dept])['id']; }
        $args=[$name,$code,$mobile,$mobile,$dept,$departmentId,$designation,$join ?: null,$active,$photo];
        if($id) { $args[]=$id; $saved=query('UPDATE employees SET employee_name=?,employee_code=?,mobile=?,mobile_login=?,department=?,department_id=?,designation=?,joining_date=?,active=?,photo=?,updated_at=NOW() WHERE id=? AND deleted_at IS NULL',$args); if(!$saved->rowCount() && one('SELECT deleted_at FROM employees WHERE id=?',[$id])['deleted_at']!==null)throw new InvalidArgumentException('This employee was deleted. Restore them before editing.'); }
        else { query('INSERT INTO employees(employee_name,employee_code,mobile,mobile_login,department,department_id,designation,joining_date,active,photo) VALUES(?,?,?,?,?,?,?,?,?,?)',$args); $id=(int)$pdo->lastInsertId(); }
        if($resetPassword) query('UPDATE employees SET password_hash=?,password=NULL,session_version=session_version+1 WHERE id=?',[employeePasswordHash(),$id]);
        elseif($old && ((int)$old['active']!==$active || $old['mobile_login']!==$mobile)) query('UPDATE employees SET session_version=session_version+1 WHERE id=?',[$id]);
        $before=$old; if($before) unset($before['password'],$before['password_hash']);
        $after=one('SELECT id,employee_name,employee_code,mobile,department,designation,active,photo FROM employees WHERE id=?',[$id]);
        audit($old?'employee_updated':'employee_created',$before,$after);
        if($resetPassword) audit('employee_password_reset',null,['employee_id'=>$id]);
        $pdo->commit();
    } catch(Throwable $ex) { $pdo->rollBack(); if($ex instanceof PDOException && ($ex->errorInfo[1] ?? 0)===1062) throw new InvalidArgumentException('That employee ID or mobile number is already in use.'); throw $ex; }
    $_SESSION['flash']='Employee saved. Attendance history is preserved.'; redirect('/admin/employees.php');
}
function changeEmployeeDeletion(int $id,bool $deleted): void {
    $pdo=db();$pdo->beginTransaction();
    try {
        $old=one('SELECT id,employee_name,employee_code,active,deleted_at,session_version FROM employees WHERE id=? FOR UPDATE',[$id]);
        if(!$old)throw new InvalidArgumentException('Employee not found.');
        if(($old['deleted_at']!==null)===$deleted){$pdo->commit();return;}
        query('UPDATE employees SET deleted_at=?,active=0,session_version=session_version+1,updated_at=NOW() WHERE id=?',[$deleted?now()->format('Y-m-d H:i:s'):null,$id]);
        $new=one('SELECT id,employee_name,employee_code,active,deleted_at,session_version FROM employees WHERE id=?',[$id]);
        audit($deleted?'employee_deleted':'employee_restored',$old,$new,$deleted?'Employee removed from employee list; login disabled and attendance retained.':'Employee restored as inactive; administrator can activate through Edit.');
        $pdo->commit();
    }catch(Throwable $ex){if($pdo->inTransaction())$pdo->rollBack();throw $ex;}
}
function employeeRowActions(array $employee): string {
    $deleted=$employee['deleted_at']!==null;
    $id=(int)$employee['id'];
    $html='<div class="actions"><a class="text-link" href="employee-view.php?id='.$id.'">View</a>';
    if(!$deleted)$html.='<a class="text-link" href="?edit='.$id.'">Edit</a>';
    $message=$deleted?'Restore '.$employee['employee_name'].' as an inactive employee?':'Delete '.$employee['employee_name'].'? Login will be disabled. Attendance history will be kept, and you can restore this employee later.';
    return $html.'<form method="post">'.csrf().'<input type="hidden" name="id" value="'.$id.'"><input type="hidden" name="action" value="'.($deleted?'restore':'delete').'"><button type="submit" class="button '.($deleted?'':'danger').'" data-confirm="'.e($message).'">'.($deleted?'Restore':'Delete').'</button></form></div>';
}
function correctAttendance(): void {
    $id=(int)($_POST['id'] ?? 0); $action=$_POST['action'] ?? 'save'; $reason=cleanText('reason',500,true);
    if(strlen($reason)<8) throw new InvalidArgumentException('Please give a meaningful correction reason (at least 8 characters).');
    $employee=(int)($_POST['employee_id'] ?? 0); $meal=(int)($_POST['meal_type_id'] ?? 0); $date=cleanText('meal_date',10);
    if(!validDate($date) || $date>now()->format('Y-m-d')) throw new InvalidArgumentException('Attendance date must be today or earlier.');
    if(!one('SELECT id FROM employees WHERE id=?',[$employee]) || !one('SELECT id FROM meal_types WHERE id=?',[$meal])) throw new InvalidArgumentException('Choose a valid employee and meal.');
    $pdo=db(); $pdo->beginTransaction();
    try {
        $old=$id?one('SELECT * FROM meal_attendance WHERE id=? FOR UPDATE',[$id]):null;
        if($id && !$old) throw new InvalidArgumentException('Attendance not found.');
        if($id && $action==='void') query("UPDATE meal_attendance SET status='void' WHERE id=?",[$id]);
        elseif($id) query("UPDATE meal_attendance SET employee_id=?,meal_type_id=?,meal_date=?,status='valid' WHERE id=?",[$employee,$meal,$date,$id]);
        else { query("INSERT INTO meal_attendance(employee_id,meal_type_id,meal_date,source,status) VALUES(?,?,?,'manual','valid')",[$employee,$meal,$date]); $id=(int)$pdo->lastInsertId(); }
        audit('attendance_'.$action,$old,one('SELECT * FROM meal_attendance WHERE id=?',[$id]),$reason); $pdo->commit();
    } catch(Throwable $ex) { $pdo->rollBack(); if($ex instanceof PDOException && ($ex->errorInfo[1] ?? 0)===1062) throw new InvalidArgumentException('This employee already has this meal on this date. Edit the existing record, including voided records in the activity log.'); throw $ex; }
    $_SESSION['flash']='Correction saved with an audit trail.'; redirect('/admin/attendance.php?preset=custom&from='.$date.'&to='.$date);
}
function saveMealSettings(): void {
    $old=meals(); $new=[];
    foreach($old as $m) {
        $id=$m['id']; $start=(string)($_POST['start'][$id] ?? ''); $end=(string)($_POST['end'][$id] ?? '');
        if(strlen($start)===5)$start.=':00'; if(strlen($end)===5)$end.=':00';
        $m['start_time']=$start; $m['end_time']=$end; $m['status']=isset($_POST['active'][$id])?1:0; $m['end_inclusive']=isset($_POST['inclusive'][$id])?1:0; $new[]=$m;
    }
    validateWindows($new); $pdo=db(); $pdo->beginTransaction();
    try { rows('SELECT id FROM meal_types ORDER BY id FOR UPDATE'); foreach($new as $m) query('UPDATE meal_types SET start_time=?,end_time=?,status=?,end_inclusive=? WHERE id=?',[$m['start_time'],$m['end_time'],$m['status'],$m['end_inclusive'],$m['id']]); audit('meal_timings_changed',$old,$new); $pdo->commit(); } catch(Throwable $ex) { $pdo->rollBack(); throw $ex; }
    $_SESSION['flash']='Meal timings updated. New scans use these timings immediately.'; redirect('/admin/meal-settings.php');
}
function saveSettings(): void {
    $name=cleanText('company_name',100,true); $ttl=(int)($_POST['qr_ttl'] ?? 60);
    if($ttl<30 || $ttl>60) throw new InvalidArgumentException('QR validity must be between 30 and 60 seconds.');
    $new=['company_name'=>$name,'qr_ttl'=>(string)$ttl,'timezone'=>'Asia/Kolkata'];
    $logo=uploadImage('logo'); if($logo)$new['logo']=$logo;
    $old=rows("SELECT * FROM system_settings WHERE setting_key<>'employee_default_password_hash'"); $pdo=db(); $pdo->beginTransaction();
    try { foreach($new as $k=>$v) query('UPDATE system_settings SET setting_value=? WHERE setting_key=?',[$v,$k]); audit('settings_changed',$old,$new); $pdo->commit(); }catch(Throwable $ex){ $pdo->rollBack(); throw $ex; }
    $_SESSION['flash']='Company settings saved.'; redirect('/admin/settings.php');
}
function saveRates(): void {
    $month=cleanText('month',7,true); if(!validDate($month.'-01')) throw new InvalidArgumentException('Choose a valid month.');
    $values=[]; foreach(['breakfast_rate','lunch_rate','dinner_rate'] as $k) { $v=$_POST[$k] ?? ''; if(!is_numeric($v) || $v<0 || $v>999999) throw new InvalidArgumentException('Enter non-negative meal rates below ₹999,999.'); $values[]=round((float)$v,2); }
    $pdo=db(); $pdo->beginTransaction();
    try { $old=rows('SELECT * FROM meal_prices WHERE month_year=?',[$month]); query('INSERT INTO meal_prices(month_year,breakfast_rate,lunch_rate,dinner_rate) VALUES(?,?,?,?)',array_merge([$month],$values)); audit('meal_rates_changed',$old,['month'=>$month,'rates'=>$values]); $pdo->commit(); }catch(Throwable $ex){ $pdo->rollBack(); throw $ex; }
    $_SESSION['flash']='Meal rates saved for '.$month.'.'; redirect('/admin/meal_prices.php?month='.$month);
}
