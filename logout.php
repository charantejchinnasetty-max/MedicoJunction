<?php
require __DIR__.'/app/bootstrap.php';
checkCsrf();
$_SESSION=[];
session_destroy();
setcookie(session_name(),'', ['expires'=>time()-3600,'path'=>BASE,'httponly'=>true,'samesite'=>'Lax','secure'=>!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS']!=='off']);
redirect('/login.php');
