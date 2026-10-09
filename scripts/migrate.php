<?php
declare(strict_types=1);
if(PHP_SAPI!=='cli') { http_response_code(404); exit; }
require __DIR__.'/../app/bootstrap.php';
$pdo=db();
// Additive migration: original tables and every original record are retained.
$sql=file_get_contents(ROOT.'/database/upgrade.sql');
foreach(explode(';',$sql) as $statement) if(trim($statement)) $pdo->exec($statement);
if(!is_dir(ROOT.'/storage')) mkdir(ROOT.'/storage',0700,true);
if(!file_exists(ROOT.'/storage/qr.key')) file_put_contents(ROOT.'/storage/qr.key',bin2hex(random_bytes(32)),LOCK_EX);
if(one("SELECT version FROM schema_migrations WHERE version='medico-v1'")) { echo "Already migrated.\n"; exit; }
$columns=array_column(rows('SHOW COLUMNS FROM employees'),'Field');
foreach(['department_id'=>'INT NULL','designation'=>"VARCHAR(100) NOT NULL DEFAULT ''",'password_hash'=>'VARCHAR(255) NULL','session_version'=>'INT NOT NULL DEFAULT 1','updated_at'=>'TIMESTAMP NULL DEFAULT NULL'] as $column=>$type) if(!in_array($column,$columns,true)) $pdo->exec("ALTER TABLE employees ADD `$column` $type");
$pdo->beginTransaction();
try {
    $pdo->exec("INSERT IGNORE INTO departments(department_name) SELECT DISTINCT department FROM employees WHERE department IS NOT NULL AND department<>''");
    $pdo->exec('UPDATE employees e JOIN departments d ON d.department_name=e.department SET e.department_id=d.id WHERE e.department_id IS NULL');
    foreach(rows('SELECT id,username,password FROM users WHERE role=\'admin\'') as $u) {
        $hash=password_get_info($u['password'])['algo'] ? $u['password'] : password_hash($u['password'],PASSWORD_DEFAULT);
        query('INSERT IGNORE INTO admins(name,username,password_hash) VALUES(?,?,?)',[$u['username'],$u['username'],$hash]);
        query('UPDATE users SET password=? WHERE id=?',[$hash,$u['id']]);
    }
    if(!(int)one('SELECT COUNT(*) n FROM admins')['n']) throw new RuntimeException('No legacy admin found; create an administrator through a reviewed CLI setup.');
    foreach(rows("SELECT id,password FROM employees WHERE password IS NOT NULL AND password<>''") as $u) query('UPDATE employees SET password_hash=?,password=NULL WHERE id=?',[password_get_info($u['password'])['algo'] ? $u['password'] : password_hash($u['password'],PASSWORD_DEFAULT),$u['id']]);
    // Legacy created_at is a save timestamp, NOT evidence of an actual scan time.
    $pdo->exec("INSERT INTO meal_attendance(employee_id,meal_type_id,meal_date,scan_timestamp,status,source,legacy_id,created_at) SELECT a.employee_id,m.id,a.attendance_date,NULL,IF(a.status=1,'valid','void'),'legacy',a.id,a.created_at FROM attendance a JOIN meal_types m ON m.meal_name=a.meal_type WHERE NOT EXISTS(SELECT 1 FROM meal_attendance n WHERE n.legacy_id=a.id)");
    $old=(int)one('SELECT COUNT(*) n FROM attendance')['n']; $new=(int)one('SELECT COUNT(*) n FROM meal_attendance WHERE legacy_id IS NOT NULL')['n'];
    if($old!==$new) throw new RuntimeException('Attendance reconciliation failed.');
    query("INSERT INTO schema_migrations(version) VALUES('medico-v1')");
    $pdo->commit();
} catch(Throwable $ex) { if($pdo->inTransaction())$pdo->rollBack(); throw $ex; }
echo "Migration complete: $old legacy attendance records preserved.\n";
