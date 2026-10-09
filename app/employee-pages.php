<?php
declare(strict_types=1);
$user=auth('employee');require __DIR__.'/reports.php';require __DIR__.'/actions.php';$page=basename($_SERVER['SCRIPT_NAME'],'.php');$error='';
if($page==='profile' && $_SERVER['REQUEST_METHOD']==='POST') {
    checkCsrf();
    try {
        $photo=uploadImage('photo') ?? $user['photo'];
        query('UPDATE employees SET photo=?,updated_at=NOW() WHERE id=?',[$photo,$user['id']]);
        $_SESSION['flash']='Your profile has been updated.';redirect('/employee/profile.php');
    }catch(InvalidArgumentException $ex){$error=$ex->getMessage();}
}
$titles=['dashboard'=>'My dashboard','scan'=>'Scan meal QR','history'=>'My meal history','profile'=>'My profile'];pageStart($titles[$page] ?? 'My dashboard',$page,$user,'employee');if($error)notice($error);
if($page==='dashboard') {
    heading('YOUR DAILY TABLE','Hello, '.$user['employee_name'].'.','A good meal is waiting. Make a little time for yourself.','<a class="button primary scan-button" href="scan.php">'.icon('qr').' Scan meal QR</a>');
    $service=serviceStatus(meals(),now());echo '<section class="service-banner"><div><span class="live-dot"></span><strong>'.e($service['message']).'</strong><small>'.now()->format('d F Y · h:i A').' IST</small></div></section>';
    $today=now()->format('Y-m-d');$taken=rows("SELECT * FROM meal_attendance WHERE employee_id=? AND meal_date=? AND status='valid'",[$user['id'],$today]);$byMeal=array_column($taken,null,'meal_type_id');$ms=meals();
    echo '<section class="panel meal-today"><div class="panel-heading"><div><h2>Today’s meals</h2><p>A small ritual. A better day.</p></div><span class="pill green">'.count($taken).' / '.count($ms).' meals</span></div><div class="today-grid">';
    foreach($ms as $m) { $a=$byMeal[$m['id']] ?? null;echo '<div class="today-meal '.($a?'taken':'').'"><span class="meal-symbol">'.icon($a?'check':'clock').'</span><h3>'.e($m['meal_name']).'</h3><p>'.date('g:i A',strtotime($m['start_time'])).' – '.date('g:i A',strtotime($m['end_time'])).'</p><strong>'.($a?'Taken'.($a['scan_timestamp']?' · '.date('g:i A',strtotime($a['scan_timestamp'])):' · recorded manually'):($m['status']?'Not taken':'Service inactive')).'</strong></div>'; }
    echo '</div></section><div class="dashboard-grid"><section class="panel form-panel"><div class="eyebrow">THIS MONTH</div><h2>Your meals at a glance</h2>'; $f=filters((int)$user['id'],'month');cards(totals($f));echo '<a class="text-link" href="history.php">Explore your meal history →</a></section><section class="panel form-panel"><h2>Your profile</h2><div class="profile-card">';if($user['photo'] && preg_match('#^assets/uploads/[a-zA-Z0-9_.-]+\.(png|jpg|jpeg)$#',$user['photo']))echo '<img class="profile-photo" src="'.BASE.'/'.e($user['photo']).'" alt="Your profile photo">';else echo '<span class="avatar large">'.e(strtoupper(substr($user['employee_name'],0,1))).'</span>';echo '<h3>'.e($user['employee_name']).'</h3><p>'.e($user['employee_code']).' · '.e($user['department']).'</p><a href="profile.php" class="button">View profile</a></div></section></div>';
}
elseif($page==='scan') {
    heading('LOGIN → SCAN → EAT','Your next meal is one scan away.','Point your camera at the live QR displayed at the food counter.');
    echo '<section class="panel scanner-panel"><div class="scanner-illustration">'.icon('qr').'</div><h2>Scan meal QR</h2><p>We’ll work out the meal automatically.<br>No dates, times, or meal selection needed.</p><div id="reader"></div><div id="scan-result" role="status" aria-live="polite"></div><div class="actions scanner-actions"><button class="button primary" id="start-scanner">'.icon('qr').' Open camera</button><button class="button" id="stop-scanner" hidden>Stop camera</button></div><p class="muted">Allow camera access when prompted. The rear camera is preferred.</p><a class="text-link" href="dashboard.php">Back to my dashboard</a></section><script src="'.BASE.'/assets/vendor/html5-qrcode.min.js"></script><script defer src="'.BASE.'/assets/js/scanner.js"></script>';
}
elseif($page==='history') {
    heading('YOUR MEAL HISTORY','The meals that made your month.','Your attendance, available whenever you need it.');try{$f=filters((int)$user['id'],'month');}catch(InvalidArgumentException $ex){notice($ex->getMessage());$_GET=[];$f=filters((int)$user['id'],'month');}filterForm($f,false);cards(totals($f));
    $records=attendanceRows($f);$days=[];foreach($records as $r)$days[$r['meal_date']][$r['meal_type_id']]=$r;$ms=meals();
    echo '<section class="panel"><div class="panel-heading"><h2>Day by day</h2></div><div class="table-wrap"><table><thead><tr><th>Date</th>';foreach($ms as $m)echo '<th>'.e($m['meal_name']).'</th>';echo '<th>Total</th></tr></thead><tbody>';
    $cursor=new DateTimeImmutable($f['to']);$first=new DateTimeImmutable($f['from']);while($cursor>=$first) { $date=$cursor->format('Y-m-d');$entries=$days[$date] ?? [];echo '<tr><td>'.$cursor->format('d M Y').'</td>';foreach($ms as $m) { $r=$entries[$m['id']] ?? null;echo '<td>'.($r?'<span class="pill green">✓ Taken</span><small class="source">'.($r['scan_timestamp']?date('g:i A',strtotime($r['scan_timestamp'])):'Time unavailable').'</small>':'<span class="muted">—</span>').'</td>'; }echo '<td>'.count($entries).'</td></tr>';$cursor=$cursor->modify('-1 day'); }echo '</tbody></table></div></section>';
}
elseif($page==='profile') {
    heading('YOUR PROFILE','The person behind the plate.',$user['employee_name'].' · '.$user['employee_code']);echo '<section class="panel form-panel"><form method="post" enctype="multipart/form-data">'.csrf().'<div class="form-grid"><label>Department<input readonly value="'.e($user['department']).'"></label><label>Designation<input readonly value="'.e($user['designation']).'"></label><label>Mobile number<input readonly type="tel" value="'.e($user['mobile']).'"></label><label>Profile photo<input type="file" name="photo" accept="image/png,image/jpeg"><small>JPG or PNG, up to 2 MB.</small></label><p class="wide">Your mobile number is your login username. Contact your administrator to update it. The company uses a common employee password.</p></div><button class="button primary">Save profile</button></form></section>';
}
pageEnd();
