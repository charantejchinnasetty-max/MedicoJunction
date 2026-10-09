<?php
require __DIR__.'/app/bootstrap.php';
redirect(isset($_SESSION['identity'])?'/'.($_SESSION['identity']['role']==='admin'?'admin':'employee').'/dashboard.php':'/login.php');
