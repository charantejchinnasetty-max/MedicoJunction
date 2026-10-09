<?php
declare(strict_types=1);
return [
    'dsn' => getenv('MJ_DB_DSN') ?: 'mysql:host=127.0.0.1;dbname=mess_management;charset=utf8mb4',
    'user' => getenv('MJ_DB_USER') ?: 'root',
    'password' => getenv('MJ_DB_PASSWORD') ?: '',
];
