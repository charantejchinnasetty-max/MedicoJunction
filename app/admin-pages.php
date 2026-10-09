<?php
declare(strict_types=1);
$user=auth('admin'); require __DIR__.'/reports.php'; require __DIR__.'/actions.php';
$page=basename($_SERVER['SCRIPT_NAME'],'.php'); $error='';
if($_SERVER['REQUEST_METHOD']==='POST') {
    checkCsrf();
    try {
        switch($page) {
            case 'employees':
                $action=(string)($_POST['action'] ?? 'save');
                if(in_array($action,['delete','restore'],true)){
                    changeEmployeeDeletion((int)($_POST['id'] ?? 0),$action==='delete');
                    $_SESSION['flash']=$action==='delete'?'Employee deleted. Attendance history is preserved. You can restore them from the Deleted filter.':'Employee restored as inactive. Use Edit to activate their account.';
                    redirect('/admin/employees.php'.($action==='restore'?'?status=0':''));
                }
                if($action!=='save')throw new InvalidArgumentException('Unknown employee action.');
                saveEmployee(); break;
            case 'attendance': correctAttendance(); break;
            case 'meal-settings': saveMealSettings(); break;
            case 'settings': saveSettings(); break;
            case 'meal_prices': saveRates(); break;
            default: throw new InvalidArgumentException('This action is not supported.');
        }
    }catch(InvalidArgumentException $ex){$error=$ex->getMessage();}
}
try { $f=filters(null,in_array($page,['reports','report','export_report'],true)?'month':'today'); }catch(InvalidArgumentException $ex){ $error=$ex->getMessage(); $_GET=[]; $f=filters(); }
if(in_array($page,['export_report','export_employees'],true)) {
    if($page==='export_report') exportCsv($f,($_GET['view'] ?? 'summary')==='detail'?'detail':'summary');
    audit('employees_exported'); header('Content-Type: text/csv; charset=utf-8'); header('Content-Disposition: attachment; filename="employees.csv"'); $o=fopen('php://output','w'); fputcsv($o,['Name','Employee ID','Department','Designation','Status']); foreach(rows('SELECT employee_name,employee_code,department,designation,active FROM employees WHERE deleted_at IS NULL ORDER BY employee_name') as $r)fputcsv($o,array_map(fn($v)=>preg_match('/^[=+@\-\t\r\n]/',(string)$v)?"'".$v:$v,$r)); fclose($o);exit;
}
if($page==='meal-qr') {
    pageStart('Counter QR','qr',$user,'admin',true);
    echo '<header class="counter-header"><a class="brand" href="dashboard.php">'.logo().'<span>'.e(setting('company_name')).'<small>MEALS · CARE · COMMUNITY</small></span></a><button class="button" id="fullscreen">Fullscreen</button></header><main class="counter"><div class="eyebrow">WELCOME TO THE TABLE</div><h1>Scan before your meal.</h1><p>Open your employee dashboard, tap Scan meal QR, and point your camera here.</p><div class="qr-card"><div id="qr-code" aria-label="Rotating meal QR code"><p>Preparing secure QR…</p></div><div class="qr-countdown"><span class="valid-dot"></span><span id="qr-status">Connecting to server</span></div></div><div class="counter-service" id="service-status">Checking meal service…</div><p id="server-clock">All times Indian Standard Time</p><p class="muted">One scan. One meal. A moment to recharge.</p><a class="text-link" href="dashboard.php">← Back to dashboard</a></main><script src="'.BASE.'/assets/vendor/qrcode.min.js"></script><script defer src="'.BASE.'/assets/js/counter.js"></script></body></html>'; exit;
}
$titles=['dashboard'=>['Overview','dashboard'],'attendance'=>['Attendance','attendance'],'employees'=>['Employees','employees'],'employee-view'=>['Employee details','employees'],'reports'=>['Reports & expenses','reports'],'report'=>['Reports & expenses','reports'],'meal-settings'=>['Meal timings','meals'],'meal_prices'=>['Meal rates','rates'],'settings'=>['Settings','settings'],'audit'=>['Activity log','audit']];
[$title,$active]=$titles[$page] ?? ['Overview','dashboard']; pageStart($title,$active,$user); if($error)notice($error);
if($page==='dashboard') {
    $d=dashboardData($f);
    heading('THE DAILY TABLE','A good day starts with a good meal.','Your meal service, attendance, and people — all in one place.','<a class="button primary" href="meal-qr.php">'.icon('qr').' Open counter QR</a>');
    echo '<section class="service-banner"><div><span class="live-dot"></span><strong id="service-status">'.e($d['service']['message']).'</strong><small>Service follows Asia/Kolkata server time</small></div><a href="meal-settings.php">Manage timings →</a></section>';
    filterForm($f); cards($d['totals'],$f['from']===$f['to']?$d['active_employees']:null);
    echo '<div class="dashboard-grid"><section class="panel"><div class="panel-heading"><div><h2>Meal consumption</h2><p>Daily meals in your selected date range</p></div><span class="pill soft">'.e($f['from']).' — '.e($f['to']).'</span></div><div class="chart-wrap"><canvas id="trend-chart" aria-label="Daily meal consumption chart" role="img"></canvas><p class="chart-loading">Loading chart…</p></div></section><section class="panel"><div class="panel-heading"><div><h2>At a glance</h2><p>Your people and their meals</p></div></div><div class="people-count"><strong>'.$d['active_employees'].'</strong><span>active employees<br><small>'.$d['employees'].' total employees</small></span></div><div class="donut-wrap"><canvas id="distribution-chart" aria-label="Meal distribution chart" role="img"></canvas></div><a href="employees.php" class="panel-link">View all employees '.icon('arrow').'</a></section></div><section class="panel"><div class="panel-heading"><div><h2>Last 7 days</h2><p>Breakfast, lunch, and dinner consumption</p></div></div><div class="chart-wrap short"><canvas id="week-chart" aria-label="Seven day meal consumption chart" role="img"></canvas></div></section><section class="panel"><div class="panel-heading"><div><h2>Recent meal attendance</h2><p>Newest dates first · updates automatically</p></div><a class="text-link" href="attendance.php">View attendance →</a></div><div id="recent-scans">'; attendanceTable($d['recent']); echo '</div></section><script src="'.BASE.'/assets/vendor/chart.umd.min.js"></script><script defer src="'.BASE.'/assets/js/dashboard-medico.js"></script>';
}
elseif($page==='attendance') {
    heading('ATTENDANCE','Every meal, accounted for.','Verified scans and recorded corrections in one reliable register.','<a class="button" href="reports.php?'.e(http_build_query($f+['view'=>'detail'])).'">'.icon('reports').' Export / print</a><a class="button primary" href="?correct=new">+ Add missed meal</a>');
    if(isset($_GET['correct']) || $_SERVER['REQUEST_METHOD']==='POST') {
        $id=(int)($_POST['id'] ?? $_GET['correct'] ?? 0); $r=$id?one('SELECT * FROM meal_attendance WHERE id=?',[$id]):null;
        echo '<section class="panel form-panel"><h2>'.($r?'Correct attendance #'.$id:'Add missed attendance').'</h2><p>Every change requires a reason and is permanently logged. Removing attendance voids the entry and preserves its history.</p><form method="post">'.csrf().'<input type="hidden" name="id" value="'.$id.'"><div class="form-grid"><label>Employee<select name="employee_id" required>';
        foreach(rows('SELECT id,employee_name,employee_code FROM employees ORDER BY employee_name') as $emp)echo '<option value="'.$emp['id'].'" '.(($r['employee_id'] ?? $_POST['employee_id'] ?? '')==$emp['id']?'selected':'').'>'.e($emp['employee_name'].' · '.$emp['employee_code']).'</option>';
        echo '</select></label><label>Meal<select name="meal_type_id">';foreach(meals() as $m)echo '<option value="'.$m['id'].'" '.(($r['meal_type_id'] ?? '')==$m['id']?'selected':'').'>'.e($m['meal_name']).'</option>';
        echo '</select></label><label>Date<input type="date" name="meal_date" required max="'.now()->format('Y-m-d').'" value="'.e($r['meal_date'] ?? $_POST['meal_date'] ?? now()->format('Y-m-d')).'"></label><label>Action<select name="action"><option value="save">'.($r?'Save correction / restore':'Add attendance').'</option>'.($r?'<option value="void">Remove invalid attendance (void)</option>':'').'</select></label><label class="wide">Reason for modification<textarea name="reason" required minlength="8" maxlength="500" placeholder="Explain why this correction is necessary">'.e($_POST['reason'] ?? '').'</textarea></label></div><div class="actions"><button class="button primary" data-confirm="Save this attendance correction and its audit trail?">Save correction</button><a class="button" href="attendance.php">Cancel</a></div></form></section>';
    }
    filterForm($f); cards(totals($f)); [$w,$a]=whereAttendance($f); $count=(int)one("SELECT COUNT(*) n FROM meal_attendance a JOIN employees e ON e.id=a.employee_id WHERE $w",$a)['n']; $pages=max(1,(int)ceil($count/25)); $p=max(1,min($pages,(int)($_GET['page'] ?? 1))); $sort=$_GET['sort'] ?? 'date'; $dir=$_GET['dir'] ?? 'desc';
    echo '<section class="panel"><div class="panel-heading"><div><h2>Meal register</h2><p>'.$count.' records · showing up to 25 per page</p></div><details class="sort-menu"><summary>Sort records</summary>';
    foreach(['date'=>'Date','employee'=>'Employee','code'=>'Employee ID','meal'=>'Meal','time'=>'Scan time'] as $k=>$v)echo '<a href="?'.e(http_build_query(array_merge($_GET,['sort'=>$k,'dir'=>$sort===$k&&$dir==='asc'?'desc':'asc','page'=>1]))).'">'.$v.'</a>';
    echo '</details></div>';attendanceTable(attendanceRows($f,$p,$sort,$dir),true,($p-1)*25);echo '<div class="pagination"><span>Page '.$p.' of '.$pages.'</span><div>';if($p>1)echo '<a class="button" href="?'.e(http_build_query(array_merge($_GET,['page'=>$p-1]))).'">Previous</a>';if($p<$pages)echo '<a class="button" href="?'.e(http_build_query(array_merge($_GET,['page'=>$p+1]))).'">Next</a>';echo '</div></div></section>';
}
elseif($page==='employees') {
    heading('OUR PEOPLE','A place for everyone.','Manage employee access, profiles, and meal history.','<a class="button" href="export_employees.php">Export CSV</a><a class="button primary" href="?edit=new">+ Add employee</a>');
    if(isset($_GET['edit']) || ($_SERVER['REQUEST_METHOD']==='POST' && ($_POST['action'] ?? 'save')==='save')) {
        $id=(int)($_POST['id'] ?? $_GET['edit'] ?? 0); $r=$id?one('SELECT * FROM employees WHERE id=?',[$id]):[]; if($_SERVER['REQUEST_METHOD']==='POST')$r=array_merge($r ?? [],$_POST);
        echo '<section class="panel form-panel"><h2>'.($id?'Edit employee':'New employee').'</h2><form method="post" enctype="multipart/form-data">'.csrf().'<input type="hidden" name="id" value="'.$id.'"><div class="form-grid">';
        foreach(['employee_name'=>['Employee name','text',100],'employee_code'=>['Employee ID','text',20],'mobile'=>['Mobile number','tel',15],'department'=>['Department','text',50],'designation'=>['Designation','text',100],'joining_date'=>['Joining date','date',10]] as $k=>$v) echo '<label>'.$v[0].'<input type="'.$v[1].'" name="'.$k.'" maxlength="'.$v[2].'" value="'.e($r[$k] ?? '').'" '.(in_array($k,['employee_name','employee_code'],true)?'required':'').'></label>';
        echo '<label class="check-label"><input type="checkbox" name="reset_password"> Reset to common employee password</label><p>Employees sign in with their mobile number. New employees receive the common password automatically.</p><label>Profile photo<input type="file" name="photo" accept="image/png,image/jpeg"><small>JPG / PNG · max 2 MB</small></label><label class="check-label"><input type="checkbox" name="active" '.(($r['active'] ?? 1)?'checked':'').'> Active employee</label></div><div class="actions"><button class="button primary">Save employee</button><a class="button" href="employees.php">Cancel</a></div></form></section>';
    }
    $q=substr(trim($_GET['q'] ?? ''),0,100);$status=$_GET['status'] ?? 'all';$where='(employee_name LIKE ? OR employee_code LIKE ? OR department LIKE ?) AND deleted_at IS '.($status==='deleted'?'NOT NULL':'NULL');$args=['%'.$q.'%','%'.$q.'%','%'.$q.'%'];if(in_array($status,['0','1'],true)){$where.=' AND active=?';$args[]=$status;}
    echo '<form class="filter-panel inline-filter"><label>Search employees<input name="q" value="'.e($q).'" placeholder="Name, employee ID, department"></label><label>Status<select name="status">';foreach(['all'=>'Current employees','1'=>'Active','0'=>'Inactive','deleted'=>'Deleted'] as $k=>$v)echo '<option value="'.$k.'" '.($status===(string)$k?'selected':'').'>'.$v.'</option>';echo '</select></label><button class="button primary">Search</button></form><section class="panel"><div class="table-wrap"><table><thead><tr><th>Employee</th><th>Department</th><th>Mobile</th><th>Access</th><th>Status</th><th>Actions</th></tr></thead><tbody>';
    $list=rows("SELECT * FROM employees WHERE $where ORDER BY employee_name",$args);if(!$list)echo '<tr><td colspan="6" class="empty">No employees match your search.</td></tr>';
    foreach($list as $r) echo '<tr><td><div class="person"><span class="avatar">'.e(strtoupper(substr($r['employee_name'],0,1))).'</span><div><strong>'.e($r['employee_name']).'</strong><small>'.e($r['employee_code']).'</small></div></div></td><td>'.e($r['department']).'<small class="source">'.e($r['designation']).'</small></td><td>'.e($r['mobile']).'</td><td>'.($r['password_hash']&&$r['mobile_login']?'Mobile login ready':'Mobile login setup needed').'</td><td><span class="pill '.($r['active']?'green':'soft').'">'.($r['deleted_at']?'Deleted':($r['active']?'Active':'Inactive')).'</span></td><td>'.employeeRowActions($r).'</td></tr>';echo '</tbody></table></div></section>';
}
elseif($page==='employee-view') {
    $r=one('SELECT * FROM employees WHERE id=?',[(int)($_GET['id'] ?? 0)]);
    if(!$r)notice('Employee not found.');else {
        heading('EMPLOYEE PROFILE',$r['employee_name'],$r['employee_code'].' · '.$r['department'].' · '.$r['designation'],'<a class="button" href="employees.php?edit='.$r['id'].'">Edit profile</a>');
        $f['employee']=$r['id'];$f['preset']='month';$f['from']=now()->format('Y-m-01');$f['to']=now()->format('Y-m-t');
        echo '<section class="panel form-panel"><h2>Contact & access</h2><p>Mobile: '.e($r['mobile'] ?: 'Not provided').'</p><p>Status: '.($r['deleted_at']?'Deleted':($r['active']?'Active':'Inactive')).' · '.($r['password_hash']?'Login ready':'Password not yet set').'</p></section>';cards(totals($f));echo '<a class="button" href="reports.php?employee='.$r['id'].'&preset=month">Full meal history & reports →</a>';
    }
}
elseif(in_array($page,['reports','report'],true)) {
    $view=($_GET['view'] ?? 'summary')==='detail'?'detail':'summary';
    heading('REPORTS & INSIGHTS','The whole picture, down to a meal.','Daily, monthly, employee, and meal-wise reports from verified records.','<a class="button" href="export_report.php?'.e(http_build_query($f+['view'=>$view])).'">Export CSV</a><button class="button primary" id="print-report">Print report</button>');
    filterForm($f,true,$view);cards(totals($f));
    echo '<div class="tabs"><a class="'.($view==='summary'?'selected':'').'" href="?'.e(http_build_query($f+['view'=>'summary'])).'">Employee summary</a><a class="'.($view==='detail'?'selected':'').'" href="?'.e(http_build_query($f+['view'=>'detail'])).'">Detailed register</a></div><section class="panel"><div class="panel-heading"><div><h2>'.($view==='summary'?'Employee meal summary':'Meal attendance details').'</h2><p>'.e(setting('company_name')).' · '.e($f['from']).' to '.e($f['to']).'</p></div></div>';
    if($view==='detail')attendanceTable(attendanceRows($f));else {
        $ms=meals();$list=summaryRows($f);$grand=0;$amount=0;$missing=0;$cols=[];echo '<div class="table-wrap"><table><thead><tr><th>Employee</th>';foreach($ms as $m)echo '<th>'.e($m['meal_name']).'</th>';echo '<th>Total meals</th><th>Amount · INR</th></tr></thead><tbody>';
        foreach($list as $r){$grand+=$r['total'];$amount+=$r['amount'];$missing+=$r['missing_rates'];echo '<tr><td><strong>'.e($r['employee_name']).'</strong><small class="source">'.e($r['employee_code']).'</small></td>';foreach($ms as $m){$n=$r['counts'][$m['id']] ?? 0;$cols[$m['id']]=($cols[$m['id']] ?? 0)+$n;echo '<td>'.$n.'</td>';}echo '<td><strong>'.$r['total'].'</strong></td><td>₹'.number_format($r['amount'],2).($r['missing_rates']?' *':'').'</td></tr>';}
        if(!$list)echo '<tr><td colspan="6" class="empty">No employees match these filters.</td></tr>';echo '</tbody><tfoot><tr><th>Total</th>';foreach($ms as $m)echo '<th>'.($cols[$m['id']] ?? 0).'</th>';echo '<th>'.$grand.'</th><th>₹'.number_format($amount,2).'</th></tr></tfoot></table></div>';if($missing)echo '<p class="report-note">* '.$missing.' meals have no rate configured for their month. Their cost is excluded. Set monthly meal rates for a complete expense total.</p>';
    }echo '</section>';
}
elseif($page==='meal-settings') {
    heading('SERVICE SETTINGS','Your kitchen. Your timings.','Scans are matched automatically to the active meal using server time.');
    echo '<section class="panel form-panel"><h2>Daily meal windows</h2><p>Asia/Kolkata (IST). Windows must stay within one day and cannot overlap.</p><form method="post">'.csrf().'<div class="table-wrap"><table><thead><tr><th>Meal</th><th>Start</th><th>End</th><th>Include exact end second</th><th>Active</th></tr></thead><tbody>';
    foreach(meals() as $m)echo '<tr><td><strong>'.e($m['meal_name']).'</strong></td><td><input aria-label="'.e($m['meal_name']).' start" type="time" step="1" name="start['.$m['id'].']" value="'.$m['start_time'].'" required></td><td><input aria-label="'.e($m['meal_name']).' end" type="time" step="1" name="end['.$m['id'].']" value="'.$m['end_time'].'" required></td><td><input aria-label="Include '.e($m['meal_name']).' end second" type="checkbox" name="inclusive['.$m['id'].']" '.($m['end_inclusive']?'checked':'').'></td><td><input aria-label="'.e($m['meal_name']).' active" type="checkbox" name="active['.$m['id'].']" '.($m['status']?'checked':'').'></td></tr>';
    echo '</tbody></table></div><p class="report-note">Breakfast excludes 11:00:00. Lunch includes exactly 15:00:00; dinner includes exactly 23:30:00 by default. Adjust the boundary checkbox if your policy changes.</p><button class="button primary">Save meal timings</button></form></section>';
}
elseif($page==='settings') {
    heading('COMPANY SETTINGS','Make it yours.','Manage your company identity and counter QR refresh period.');echo '<section class="panel form-panel"><form method="post" enctype="multipart/form-data">'.csrf().'<div class="form-grid"><label>Company name<input name="company_name" required maxlength="100" value="'.e(setting('company_name')).'"></label><label>QR validity (seconds)<input type="number" min="30" max="60" required name="qr_ttl" value="'.e(setting('qr_ttl')).'"></label><label>Timezone<input value="Asia/Kolkata · Indian Standard Time" readonly></label><label>Company logo<input type="file" name="logo" accept="image/png,image/jpeg"><small>JPG / PNG · max 2 MB. Leave blank to retain the current logo.</small></label></div><button class="button primary">Save settings</button></form></section>';
}
elseif($page==='meal_prices') {
    $month=(string)($_GET['month'] ?? now()->format('Y-m'));if(!validDate($month.'-01'))$month=now()->format('Y-m');$r=one('SELECT * FROM meal_prices WHERE month_year=? ORDER BY id DESC LIMIT 1',[$month]);
    heading('MEAL RATES','Simple, transparent meal costs.','Monthly rates are applied to attendance for the same month.');echo '<section class="panel form-panel"><form method="get" class="inline-filter"><label>View month<input type="month" name="month" required value="'.e($month).'"></label><button class="button">Load month</button></form><form method="post">'.csrf().'<input type="hidden" name="month" value="'.e($month).'"><h2>Rates for '.date('F Y',strtotime($month.'-01')).'</h2><div class="form-grid">';foreach(['breakfast_rate'=>'Breakfast','lunch_rate'=>'Lunch','dinner_rate'=>'Dinner'] as $k=>$v)echo '<label>'.$v.' · INR<input type="number" name="'.$k.'" step="0.01" min="0" max="999999" required value="'.e($r[$k] ?? '').'"></label>';echo '</div><button class="button primary">Save monthly rates</button></form></section>';
}
elseif($page==='audit') {
    heading('ACCOUNTABILITY','A clear trail of every change.','Administrative actions, report exports, and attendance corrections.');$p=max(1,(int)($_GET['page'] ?? 1));$offset=($p-1)*50;$list=rows('SELECT l.*,a.name admin_name FROM audit_logs l LEFT JOIN admins a ON a.id=l.admin_id ORDER BY l.id DESC LIMIT 50 OFFSET '.$offset);
    echo '<section class="panel"><div class="table-wrap"><table><thead><tr><th>Time · IST</th><th>Admin</th><th>Action</th><th>Reason / details</th></tr></thead><tbody>';foreach($list as $r)echo '<tr><td>'.e($r['created_at']).'</td><td>'.e($r['admin_name'] ?? 'System').'</td><td>'.e(str_replace('_',' ',$r['action'])).'</td><td>'.e($r['reason']).'<details><summary>View before / after</summary><pre>'.e(json_encode(['before'=>json_decode($r['old_value'],true),'after'=>json_decode($r['new_value'],true)],JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE)).'</pre></details></td></tr>';if(!$list)echo '<tr><td colspan="4" class="empty">No activity has been recorded yet.</td></tr>';echo '</tbody></table></div><div class="pagination"><span>Page '.$p.'</span><div>'.($p>1?'<a class="button" href="?page='.($p-1).'">Previous</a>':'').(count($list)===50?'<a class="button" href="?page='.($p+1).'">Next</a>':'').'</div></div></section>';
}
pageEnd();
