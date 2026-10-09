<?php
declare(strict_types=1);
date_default_timezone_set('Asia/Kolkata');
ini_set('display_errors', '0');
ini_set('log_errors', '1');
const ROOT = __DIR__ . '/..';
const BASE = '/mess_management';
function db(): PDO {
    static $db;
    if (!$db) {
        $c = require ROOT . '/config/database.php';
        $db = new PDO($c['dsn'], $c['user'], $c['password'], [PDO::ATTR_ERRMODE=>PDO::ERRMODE_EXCEPTION, PDO::ATTR_DEFAULT_FETCH_MODE=>PDO::FETCH_ASSOC, PDO::ATTR_EMULATE_PREPARES=>false]);
        $db->exec("SET time_zone = '+05:30'");
    }
    return $db;
}
function query(string $sql, array $args=[]): PDOStatement { $s=db()->prepare($sql); $s->execute($args); return $s; }
function rows(string $sql, array $args=[]): array { return query($sql,$args)->fetchAll(); }
function one(string $sql, array $args=[]): ?array { return query($sql,$args)->fetch() ?: null; }
function e($v): string { return htmlspecialchars((string)($v ?? ''), ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8'); }
function now(): DateTimeImmutable { return new DateTimeImmutable('now', new DateTimeZone('Asia/Kolkata')); }
function setting(string $key, string $default=''): string { return (string)(one('SELECT setting_value FROM system_settings WHERE setting_key=?',[$key])['setting_value'] ?? $default); }
function redirect(string $path): void { header('Location: '.BASE.$path); exit; }
function jsonResponse(bool $ok, string $code, string $message, array $data=[], int $status=200): void {
    http_response_code($status); header('Content-Type: application/json; charset=utf-8');
    echo json_encode(['success'=>$ok,'code'=>$code,'message'=>$message,'data'=>$data], JSON_UNESCAPED_UNICODE); exit;
}
function isApi(): bool { return strpos($_SERVER['SCRIPT_NAME'] ?? '', '/api/') !== false; }
set_exception_handler(function(Throwable $ex): void {
    if (isset($GLOBALS['db']) && $GLOBALS['db']->inTransaction()) $GLOBALS['db']->rollBack();
    error_log((string)$ex);
    if (PHP_SAPI==='cli') { fwrite(STDERR, $ex->getMessage().PHP_EOL); exit(1); }
    if (isApi()) jsonResponse(false,'SERVER_ERROR','We could not complete this request. Please try again.',[],500);
    http_response_code(500); echo '<!doctype html><meta name="viewport" content="width=device-width"><h1>Temporarily unavailable</h1><p>Please try again. Your request could not be completed.</p>';
});
if (PHP_SAPI !== 'cli') {
    header('X-Content-Type-Options: nosniff'); header('X-Frame-Options: SAMEORIGIN');
    header('Referrer-Policy: same-origin'); header('Cache-Control: no-store');
    header("Content-Security-Policy: default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; media-src 'self' blob:; connect-src 'self'; worker-src 'self' blob:; frame-ancestors 'self'; base-uri 'self'; form-action 'self'");
    ini_set('session.use_strict_mode','1');
    session_name('MJSESSION');
    session_set_cookie_params(['lifetime'=>0,'path'=>BASE,'secure'=>!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS']!=='off','httponly'=>true,'samesite'=>'Lax']);
    session_start();
    if (!isset($_SESSION['csrf'])) $_SESSION['csrf']=bin2hex(random_bytes(32));
}
function csrf(): string { return '<input type="hidden" name="csrf" value="'.e($_SESSION['csrf']).'">'; }
function checkCsrf(): void {
    if ($_SERVER['REQUEST_METHOD']!=='POST' || !hash_equals($_SESSION['csrf'] ?? '', (string)($_POST['csrf'] ?? $_SERVER['HTTP_X_CSRF_TOKEN'] ?? ''))) {
        if (isApi()) jsonResponse(false,'CSRF_FAILED','Your session changed. Reload and try again.',[],403);
        http_response_code(403); exit('Your session changed. Reload and try again.');
    }
}
function auth(string $role): array {
    $s=$_SESSION['identity'] ?? [];
    if (($s['role'] ?? '')!==$role || (time()-($_SESSION['last_active'] ?? 0))>28800) {
        if(isApi()) jsonResponse(false,'LOGIN_REQUIRED','Please log in to continue.',[],401);
        redirect('/login.php');
    }
    $u=one($role==='admin'?'SELECT * FROM admins WHERE id=? AND status=1':'SELECT * FROM employees WHERE id=? AND active=1 AND deleted_at IS NULL',[$s['id']]);
    if(!$u || (int)$u['session_version'] !== (int)($s['version'] ?? -1)) {
        unset($_SESSION['identity']);
        if(isApi()) jsonResponse(false,'ACCOUNT_UNAVAILABLE','Your account is inactive or your password changed. Please log in again.',[],403);
        redirect('/login.php');
    }
    $_SESSION['last_active']=time(); return $u;
}
function audit(string $action, $old=null, $new=null, string $reason=''): void {
    query('INSERT INTO audit_logs(admin_id,action,old_value,new_value,reason,ip_address,created_at) VALUES(?,?,?,?,?,?,?)', [$_SESSION['identity']['role']==='admin'?$_SESSION['identity']['id']:null,$action,json_encode($old),json_encode($new),$reason,$_SERVER['REMOTE_ADDR'] ?? 'CLI',now()->format('Y-m-d H:i:s')]);
}
function rateLimit(string $key,int $limit,int $seconds): bool {
    $bucket=(int)floor(time()/$seconds); $key=hash('sha256',$key);
    query('INSERT INTO rate_limits(bucket_key,bucket,hits) VALUES(?,?,1) ON DUPLICATE KEY UPDATE hits=hits+1',[$key,$bucket]);
    return (int)one('SELECT hits FROM rate_limits WHERE bucket_key=? AND bucket=?',[$key,$bucket])['hits'] <= $limit;
}
function meals(): array { return rows('SELECT * FROM meal_types ORDER BY display_order,id'); }
function normalizeMobile(string $value): string {
    $digits=preg_replace('/[^0-9]/','',$value);
    if(strlen($digits)===12 && substr($digits,0,2)==='91')$digits=substr($digits,2);
    if(strlen($digits)===11 && $digits[0]==='0')$digits=substr($digits,1);
    return $digits;
}
function employeePasswordHash(): string {
    $hash=setting('employee_default_password_hash');
    if(!$hash || !password_get_info($hash)['algo'])throw new RuntimeException('Employee password policy is not configured.');
    return $hash;
}
require_once __DIR__.'/meals.php';
