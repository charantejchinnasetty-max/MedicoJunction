<?php
declare(strict_types=1);
$error='';
if($_SERVER['REQUEST_METHOD']==='POST') {
    checkCsrf();
    $username=substr(trim((string)($_POST['username'] ?? '')),0,50); $password=(string)($_POST['password'] ?? ''); $role=($_POST['role'] ?? '')==='admin'?'admin':'employee';
    if($role==='employee')$username=normalizeMobile($username);
    if(!rateLimit('login-ip:'.($_SERVER['REMOTE_ADDR'] ?? ''),40,900) || !rateLimit('login:'.$role.':'.strtolower($username),10,900)) $error='Too many login attempts. Please wait 15 minutes and try again.';
    else {
        $u=one($role==='admin'?'SELECT * FROM admins WHERE username=? AND status=1':'SELECT * FROM employees WHERE mobile_login=? AND active=1 AND deleted_at IS NULL',[$username]);
        $hash=$u['password_hash'] ?? '$2y$10$92IXUNpkjO0rOQ5byMi.Ye4oKoEa3Ro9llC/.og/at2uheWG/igi.';
        if(password_verify($password,$hash) && $u && !empty($u['password_hash'])) {
            session_regenerate_id(true); $_SESSION['csrf']=bin2hex(random_bytes(32)); $_SESSION['identity']=['id'=>$u['id'],'role'=>$role,'version'=>$u['session_version']]; $_SESSION['last_active']=time();
            if($role==='admin')audit('admin_login'); redirect('/'.$role.'/dashboard.php');
        } else $error='Login details are incorrect or your account is inactive. Contact your administrator if you need access.';
    }
}
?><!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Welcome · Medico Junction</title><link rel="stylesheet" href="<?=BASE?>/assets/css/medico.css"><script defer src="<?=BASE?>/assets/js/medico.js"></script></head><body class="login-body" data-base="<?=BASE?>"><main class="login-layout"><section class="login-story"><div class="brand"><?=logo()?><span><?=e(setting('company_name'))?><small>MEALS · CARE · COMMUNITY</small></span></div><div><div class="eyebrow">A PLACE AT THE TABLE</div><h1>Good food.<br>Good company.<br>Every day.</h1><p>Your daily meals, thoughtfully managed.<br>Log in, scan, and enjoy your meal.</p><div class="plate-art"><div>✦</div></div></div><small>Made for the people who make a difference.</small></section><section class="login-form"><div class="eyebrow">WELCOME BACK</div><h2>A little care starts here.</h2><p>Sign in to your Medico Junction account.</p><?php if($error)notice($error);?><form method="post"><?=csrf()?><label>Account type<select name="role"><option value="employee" <?=($_POST['role'] ?? '')==='employee'?'selected':''?>>Employee</option><option value="admin" <?=($_POST['role'] ?? '')==='admin'?'selected':''?>>Administrator</option></select></label><label>Employee mobile number / Admin username<input name="username" autocomplete="username" required maxlength="50" value="<?=e($_POST['username'] ?? '')?>" placeholder="Enter employee mobile number or admin username"></label><label>Password<input name="password" type="password" autocomplete="current-password" required maxlength="72" placeholder="Enter your password"></label><button class="button primary full">Sign in <?=icon('arrow')?></button></form><p class="login-help">Need access? Your administrator can set up your account or reset your password.</p><div class="secure-note"><?=icon('check')?> Secure sign-in · Server-verified attendance</div></section></main></body></html>
