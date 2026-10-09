<?php
declare(strict_types=1);
require __DIR__.'/reports.php';
$endpoint=basename($_SERVER['SCRIPT_NAME'],'.php');
if($endpoint==='scan-meal') {
    $u=auth('employee'); checkCsrf();
    if(!rateLimit('scan:'.$u['id'],12,60))jsonResponse(false,'RATE_LIMITED','Please wait a minute before scanning again.',[],429);
    $body=json_decode(file_get_contents('php://input'),true);
    $token=is_array($body) && is_string($body['token'] ?? null)?$body['token']:'';
    // Release the PHP session lock. The database protects simultaneous requests.
    session_write_close();
    $result=recordMeal((int)$u['id'],$token);
    jsonResponse($result['success'],$result['code'],$result['message'],$result['data'] ?? [],$result['success']?200:409);
}
$u=auth('admin');
if($endpoint==='qr-token') {
    checkCsrf(); if(!rateLimit('qr:'.$u['id'],10,60))jsonResponse(false,'RATE_LIMITED','Please wait before refreshing the QR.',[],429);
    jsonResponse(true,'QR_READY','Counter QR refreshed.',issueToken());
}
if($endpoint==='dashboard-stats') {
    try { $f=filters(); }catch(InvalidArgumentException $ex){jsonResponse(false,'INVALID_FILTER',$ex->getMessage(),[],422);}
    $d=dashboardData($f); $week=$f; $week['from']=now()->modify('-6 days')->format('Y-m-d'); $week['to']=now()->format('Y-m-d'); $d['week']=dashboardData($week)['daily'];
    jsonResponse(true,'STATS_READY','Statistics loaded.',$d);
}
if($endpoint==='reports') { try{$f=filters();}catch(InvalidArgumentException $ex){jsonResponse(false,'INVALID_FILTER',$ex->getMessage(),[],422);} jsonResponse(true,'REPORT_READY','Report loaded.',['totals'=>totals($f),'rows'=>attendanceRows($f,max(1,(int)($_GET['page'] ?? 1)))]); }
jsonResponse(false,'NOT_FOUND','This endpoint does not exist.',[],404);
