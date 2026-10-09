<?php
declare(strict_types=1);
function icon(string $name): string {
    $paths=['dashboard'=>'M3 3h7v7H3z M14 3h7v7h-7z M3 14h7v7H3z M14 14h7v7h-7z','attendance'=>'M8 3v4 M16 3v4 M4 10h16 M5 5h14v16H5z M8 14h3 M14 14h2 M8 17h3','employees'=>'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2 M9 3a4 4 0 1 0 0 8 4 4 0 0 0 0-8 M17 4a4 4 0 0 1 0 8 M22 21v-2a4 4 0 0 0-3-3.87','reports'=>'M4 3h12l4 4v14H4z M8 16v-4 M12 16V9 M16 16v-6','qr'=>'M3 3h6v6H3z M15 3h6v6h-6z M3 15h6v6H3z M15 15h2v2h-2z M20 14v4h-3v3 M21 21h-1','settings'=>'M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8 M12 2v3 M12 19v3 M2 12h3 M19 12h3 M5 5l2 2 M17 17l2 2 M5 19l2-2 M17 7l2-2','clock'=>'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18 M12 7v5l3 2','arrow'=>'M5 12h14 M14 7l5 5-5 5','check'=>'M5 12l4 4L19 6','sun'=>'M12 3v2 M12 19v2 M3 12h2 M19 12h2 M5 5l2 2 M17 17l2 2 M5 19l2-2 M17 7l2-2 M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8'];
    return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="'.($paths[$name] ?? $paths['dashboard']).'"/></svg>';
}
function logo(): string { $custom=setting('logo'); return '<img class="brand-mark" src="'.BASE.'/'.e($custom ?: 'assets/logo/medico.svg').'" alt="Medico Junction logo">'; }
function pageStart(string $title,string $active,array $user,string $role='admin',bool $full=false): void {
    $name=$role==='admin'?$user['name']:$user['employee_name'];
    $company=setting('company_name','Medico Junction');
    echo '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="csrf-token" content="'.e($_SESSION['csrf']).'"><title>'.e($title).' · '.e($company).'</title><link rel="icon" href="'.BASE.'/assets/logo/medico.svg"><link rel="stylesheet" href="'.BASE.'/assets/css/medico.css"><script defer src="'.BASE.'/assets/js/medico.js"></script></head><body data-base="'.BASE.'"'.($full?' class="counter-body"':'').'>';
    if($full) return;
    $nav=$role==='admin'?['dashboard'=>['Overview','dashboard.php','dashboard'],'attendance'=>['Attendance','attendance.php','attendance'],'employees'=>['Employees','employees.php','employees'],'reports'=>['Reports & expenses','reports.php','reports'],'qr'=>['Counter QR','meal-qr.php','qr'],'meals'=>['Meal timings','meal-settings.php','clock'],'rates'=>['Meal rates','meal_prices.php','reports'],'settings'=>['Settings','settings.php','settings'],'audit'=>['Activity log','audit.php','clock']]:['dashboard'=>['My dashboard','dashboard.php','dashboard'],'scan'=>['Scan meal QR','scan.php','qr'],'history'=>['My meal history','history.php','attendance'],'profile'=>['My profile','profile.php','employees']];
    echo '<aside class="sidebar" id="sidebar"><a class="brand" href="'.BASE.'/'.$role.'/dashboard.php">'.logo().'<span>'.e($company).'<small>MEALS · CARE · COMMUNITY</small></span></a><div class="nav-label">'.($role==='admin'?'WORKSPACE':'EMPLOYEE PORTAL').'</div><nav aria-label="Main navigation">';
    foreach($nav as $key=>$n) echo '<a '.($key===$active?'aria-current="page" class="active"':'').' href="'.BASE.'/'.$role.'/'.$n[1].'">'.icon($n[2]).'<span>'.e($n[0]).'</span></a>';
    echo '</nav><div class="sidebar-bottom"><div class="care-note">Good meals.<br>Better workdays.<span>A little care, every day.</span></div><div class="user-mini"><span class="avatar">'.e(strtoupper(substr($name,0,1))).'</span><div><strong>'.e($name).'</strong><small>'.ucfirst($role).'</small></div><form action="'.BASE.'/logout.php" method="post">'.csrf().'<button class="logout" title="Log out" aria-label="Log out">↗</button></form></div></div></aside><div class="app-shell"><header class="topbar"><button class="menu-button" id="menu-toggle" aria-label="Toggle navigation" aria-expanded="false">☰</button><div class="breadcrumb">Workspace <span>/</span> <strong>'.e($title).'</strong></div><div class="topbar-right"><span class="pill soft">'.($role==='admin'?'Admin workspace':'Employee portal').'</span><span>'.now()->format('D, d M Y').'</span></div></header><main id="main">';
    if(isset($_SESSION['flash'])) { echo '<div role="status" class="notice success">'.e($_SESSION['flash']).'</div>'; unset($_SESSION['flash']); }
}
function pageEnd(): void { echo '</main><footer class="footer">'.e(setting('company_name','Medico Junction')).' <span>Meals that bring us together · All times IST</span></footer></div><div id="toast" role="status" aria-live="polite"></div></body></html>'; }
function heading(string $eyebrow,string $title,string $description,string $actions=''): void { echo '<div class="page-heading"><div><div class="eyebrow">'.e($eyebrow).'</div><h1>'.e($title).'</h1><p>'.e($description).'</p></div><div class="actions">'.$actions.'</div></div>'; }
function notice(string $message): void { echo '<div role="alert" class="notice error">'.e($message).'</div>'; }
function filterForm(array $f,bool $admin=true,string $view=''): void {
    echo '<form method="get" class="filter-panel"><div class="filter-grid"><label>Period<select name="preset" id="period">';
    foreach(['today'=>'Today','yesterday'=>'Yesterday','week'=>'This week','month'=>'This month','previous'=>'Previous month','custom'=>'Custom range'] as $k=>$v) echo '<option value="'.$k.'" '.($f['preset']===$k?'selected':'').'>'.$v.'</option>';
    echo '</select></label><label>From<input type="date" name="from" value="'.e($f['from']).'"></label><label>To<input type="date" name="to" value="'.e($f['to']).'"></label><label>Meal<select name="meal"><option value="0">All meals</option>';
    foreach(meals() as $m) echo '<option value="'.$m['id'].'" '.($f['meal']==$m['id']?'selected':'').'>'.e($m['meal_name']).'</option>';
    echo '</select></label>';
    if($admin) {
        echo '<label>Employee<select name="employee"><option value="0">All employees</option>';
        foreach(rows('SELECT id,employee_name,employee_code FROM employees ORDER BY employee_name') as $r) echo '<option value="'.$r['id'].'" '.($f['employee']==$r['id']?'selected':'').'>'.e($r['employee_name'].' · '.$r['employee_code']).'</option>';
        echo '</select></label><label>Department<select name="department"><option value="0">All departments</option>';
        foreach(rows('SELECT * FROM departments ORDER BY department_name') as $r) echo '<option value="'.$r['id'].'" '.($f['department']==$r['id']?'selected':'').'>'.e($r['department_name']).'</option>';
        echo '</select></label><label class="search-label">Search<input name="q" placeholder="Name or employee ID" value="'.e($f['q']).'"></label>';
    }
    if($view!=='') echo '<input type="hidden" name="view" value="'.e($view).'">';
    echo '<button class="button primary filter-submit">Apply filters</button></div><div class="filter-foot">Showing '.e(date('d M Y',strtotime($f['from']))).' – '.e(date('d M Y',strtotime($f['to']))).' <a href="?">Reset filters</a></div></form>';
}
function cards(array $counts,?int $employees=null): void {
    $total=array_sum(array_column($counts,'count')); echo '<div class="stats-grid">';
    foreach($counts as $i=>$r) echo '<article class="stat-card tone-'.($i%3).'"><div class="stat-top"><span>'.e($r['name']).'</span><span class="stat-icon">'.icon($i===2?'clock':'sun').'</span></div><div class="stat-value" data-stat="'.$r['id'].'">'.$r['count'].'</div><div class="stat-sub">Meals recorded'.($employees!==null?' · '.($employees?round(100*$r['count']/$employees):0).'% of active employees':'').'</div></article>';
    echo '<article class="stat-card total"><div class="stat-top"><span>Total meals</span><span class="stat-icon">'.icon('attendance').'</span></div><div class="stat-value" data-stat="total">'.$total.'</div><div class="stat-sub">A little care in every meal</div></article></div>';
}
function attendanceTable(array $records,bool $correct=false,int $offset=0): void {
    echo '<div class="table-wrap"><table><thead><tr><th>#</th><th>Employee</th><th>Department</th><th>Date</th><th>Meal</th><th>Scan time · IST</th><th>Status</th>'.($correct?'<th>Action</th>':'').'</tr></thead><tbody>';
    if(!$records) echo '<tr><td colspan="8"><div class="empty">'.icon('attendance').'<h3>No meal attendance recorded for this date.</h3><p>Try another date range or clear your filters.</p></div></td></tr>';
    foreach($records as $i=>$r) {
        echo '<tr><td class="muted">'.($offset+$i+1).'</td><td><div class="person"><span class="avatar small">'.e(strtoupper(substr($r['employee_name'],0,1))).'</span><div><strong>'.e($r['employee_name']).'</strong><small>'.e($r['employee_code']).'</small></div></div></td><td>'.e($r['department']).'</td><td>'.date('d M Y',strtotime($r['meal_date'])).'</td><td><span class="pill meal-'.(int)$r['meal_type_id'].'">'.e($r['meal_name']).'</span></td><td>'.($r['scan_timestamp']?date('h:i:s A',strtotime($r['scan_timestamp'])):'<span class="muted">Not available</span>').'<small class="source">'.e(ucfirst($r['source'])).'</small></td><td><span class="valid-dot"></span> Valid</td>'.($correct?'<td><a class="text-link" href="?correct='.(int)$r['id'].'">Correct</a></td>':'').'</tr>';
    }
    echo '</tbody></table></div>';
}
