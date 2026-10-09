<?php
declare(strict_types=1);
function validDate(string $v): bool { $d=DateTimeImmutable::createFromFormat('!Y-m-d',$v); return $d && $d->format('Y-m-d')===$v; }
function filters(?int $employee=null,string $default='today'): array {
    $today=now()->setTime(0,0); $preset=(string)($_GET['preset'] ?? $default);
    $ranges=['today'=>[$today,$today],'yesterday'=>[$today->modify('-1 day'),$today->modify('-1 day')],'week'=>[$today->modify('monday this week'),$today],'month'=>[$today->modify('first day of this month'),$today->modify('last day of this month')],'previous'=>[$today->modify('first day of last month'),$today->modify('last day of last month')]];
    [$from,$to]=$ranges[$preset] ?? [$today,$today];
    $start=$from->format('Y-m-d'); $end=$to->format('Y-m-d');
    if($preset==='custom') { $start=(string)($_GET['from'] ?? $start); $end=(string)($_GET['to'] ?? $end); }
    if(!validDate($start) || !validDate($end) || $start>$end || (strtotime($end)-strtotime($start))>366*86400*3) throw new InvalidArgumentException('Choose a valid date range of up to three years.');
    return ['preset'=>$preset,'from'=>$start,'to'=>$end,'employee'=>$employee ?? max(0,(int)($_GET['employee'] ?? 0)),'department'=>max(0,(int)($_GET['department'] ?? 0)),'meal'=>max(0,(int)($_GET['meal'] ?? 0)),'q'=>substr(trim((string)($_GET['q'] ?? '')),0,100)];
}
function whereAttendance(array $f): array {
    $sql="a.status='valid' AND a.meal_date BETWEEN ? AND ?"; $args=[$f['from'],$f['to']];
    foreach(['employee'=>'a.employee_id','department'=>'e.department_id','meal'=>'a.meal_type_id'] as $k=>$col) if($f[$k]) { $sql.=" AND $col=?"; $args[]=$f[$k]; }
    if($f['q']!=='') { $sql.=' AND (e.employee_name LIKE ? OR e.employee_code LIKE ?)'; $args[]='%'.$f['q'].'%'; $args[]='%'.$f['q'].'%'; }
    return [$sql,$args];
}
function attendanceRows(array $f,?int $page=null,string $sort='date',string $direction='desc'): array {
    [$where,$args]=whereAttendance($f);
    $col=['date'=>'a.meal_date','employee'=>'e.employee_name','code'=>'e.employee_code','meal'=>'m.display_order','time'=>'a.scan_timestamp'][$sort] ?? 'a.meal_date';
    $dir=$direction==='asc'?'ASC':'DESC';
    $sql="SELECT a.*,e.employee_name,e.employee_code,COALESCE(d.department_name,'Unassigned') department,m.meal_name FROM meal_attendance a JOIN employees e ON e.id=a.employee_id JOIN meal_types m ON m.id=a.meal_type_id LEFT JOIN departments d ON d.id=e.department_id WHERE $where ORDER BY $col $dir,a.id DESC";
    if($page!==null) $sql.=' LIMIT 25 OFFSET '.(max(0,$page-1)*25);
    return rows($sql,$args);
}
function totals(array $f): array {
    [$where,$args]=whereAttendance($f);
    $data=rows("SELECT a.meal_type_id,COUNT(*) n FROM meal_attendance a JOIN employees e ON e.id=a.employee_id WHERE $where GROUP BY a.meal_type_id",$args);
    $counts=array_column($data,'n','meal_type_id'); $result=[];
    foreach(meals() as $m) $result[]=['id'=>$m['id'],'name'=>$m['meal_name'],'count'=>(int)($counts[$m['id']] ?? 0)];
    return $result;
}
function summaryRows(array $f): array {
    [$where,$args]=whereAttendance($f);
    $data=rows("SELECT e.id,e.employee_name,e.employee_code,m.id meal_id,COUNT(*) n,SUM(CASE m.id WHEN 1 THEN COALESCE(p.breakfast_rate,0) WHEN 2 THEN COALESCE(p.lunch_rate,0) WHEN 3 THEN COALESCE(p.dinner_rate,0) ELSE 0 END) amount,SUM(p.id IS NULL) missing_rates FROM meal_attendance a JOIN employees e ON e.id=a.employee_id JOIN meal_types m ON m.id=a.meal_type_id LEFT JOIN meal_prices p ON p.id=(SELECT MAX(p2.id) FROM meal_prices p2 WHERE p2.month_year=DATE_FORMAT(a.meal_date,'%Y-%m')) WHERE $where GROUP BY e.id,e.employee_name,e.employee_code,m.id ORDER BY e.employee_name",$args);
    $result=[];
    // Include employees with zero meals so monthly reports do not hide absences.
    $es='1=1'; $ea=[];
    foreach(['employee'=>'id','department'=>'department_id'] as $k=>$col) if($f[$k]) { $es.=" AND $col=?"; $ea[]=$f[$k]; }
    if($f['q']!=='') { $es.=' AND (employee_name LIKE ? OR employee_code LIKE ?)'; $ea[]='%'.$f['q'].'%'; $ea[]='%'.$f['q'].'%'; }
    foreach(rows("SELECT id,employee_name,employee_code FROM employees WHERE $es ORDER BY employee_name",$ea) as $r) $result[$r['id']]=$r+['counts'=>[],'total'=>0,'amount'=>0,'missing_rates'=>0];
    foreach($data as $r) { $id=$r['id']; $result[$id]['counts'][$r['meal_id']]=(int)$r['n']; $result[$id]['total']+=(int)$r['n']; $result[$id]['amount']+=(float)$r['amount']; $result[$id]['missing_rates']+=(int)$r['missing_rates']; }
    return array_values($result);
}
function dashboardData(array $f): array {
    [$where,$args]=whereAttendance($f);
    $daily=rows("SELECT a.meal_date,a.meal_type_id,COUNT(*) n FROM meal_attendance a JOIN employees e ON e.id=a.employee_id WHERE $where GROUP BY a.meal_date,a.meal_type_id ORDER BY a.meal_date",$args);
    $count=(int)one('SELECT COUNT(*) n FROM employees WHERE active=1 AND deleted_at IS NULL')['n'];
    return ['totals'=>totals($f),'active_employees'=>$count,'employees'=>(int)one('SELECT COUNT(*) n FROM employees WHERE deleted_at IS NULL')['n'],'daily'=>$daily,'recent'=>array_slice(attendanceRows($f,1),0,6),'service'=>serviceStatus(meals(),now()),'server_time'=>time(),'from'=>$f['from'],'to'=>$f['to']];
}
function exportCsv(array $f,string $view): void {
    audit('report_exported',null,['filters'=>$f,'view'=>$view]);
    header('Content-Type: text/csv; charset=utf-8'); header('Content-Disposition: attachment; filename="medico-junction-'.$view.'-'.$f['from'].'.csv"');
    $out=fopen('php://output','w'); fwrite($out,"\xEF\xBB\xBF");
    $put=function(array $r)use($out){ fputcsv($out,array_map(function($v){ $v=(string)$v; return preg_match('/^[=+@\-\t\r\n]/',$v)?"'".$v:$v; },$r)); };
    if($view==='summary') {
        $ms=meals(); $put(array_merge(['Employee','Employee ID'],array_column($ms,'meal_name'),['Total meals','Amount INR','Meals missing rates']));
        foreach(summaryRows($f) as $r) { $line=[$r['employee_name'],$r['employee_code']]; foreach($ms as $m)$line[]=$r['counts'][$m['id']] ?? 0; $put(array_merge($line,[$r['total'],number_format($r['amount'],2,'.',''),$r['missing_rates']])); }
    } else { $put(['Employee','Employee ID','Department','Date','Meal','Scan time IST','Source','Status']); foreach(attendanceRows($f) as $r) $put([$r['employee_name'],$r['employee_code'],$r['department'],$r['meal_date'],$r['meal_name'],$r['scan_timestamp'] ?? 'Not available',$r['source'],$r['status']]); }
    fclose($out); exit;
}
