<?php
require __DIR__.'/../app/bootstrap.php';
auth('admin');
if($_SERVER['REQUEST_METHOD']!=='GET'){http_response_code(410);exit('This legacy action has been retired. Use the current administration form.');}
redirect('/admin/employees.php');
