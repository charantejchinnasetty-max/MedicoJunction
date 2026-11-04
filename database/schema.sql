-- Medico Junction — complete schema for a NEW installation.
--
-- Existing installations: do NOT import this file. Keep your current database and run
-- `npm run migrate` (it is additive and idempotent, like the old scripts/migrate.php).
--
-- New installation:
--   1. CREATE DATABASE mess_management CHARACTER SET utf8mb4;
--   2. mysql mess_management < database/schema.sql
--   3. npm run create-admin
--   4. npm run set-employee-password
--   5. npm run migrate        (creates the QR signing key and the sessions table)
--
-- Tables `users` and `attendance` are the original (pre-v1) tables. They are kept so the
-- migration and old data remain compatible; the application itself uses `admins` and
-- `meal_attendance`.

SET NAMES utf8mb4;
SET FOREIGN_KEY_CHECKS=0;
/*M!999999\- enable the sandbox mode */ 
CREATE TABLE IF NOT EXISTS `admins` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `name` varchar(100) NOT NULL,
  `username` varchar(50) NOT NULL,
  `password_hash` varchar(255) NOT NULL,
  `role` varchar(20) NOT NULL DEFAULT 'admin',
  `status` tinyint(4) NOT NULL DEFAULT 1,
  `session_version` int(11) NOT NULL DEFAULT 1,
  PRIMARY KEY (`id`),
  UNIQUE KEY `username` (`username`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
CREATE TABLE IF NOT EXISTS `attendance` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `employee_id` int(11) NOT NULL,
  `attendance_date` date NOT NULL,
  `meal_type` varchar(20) NOT NULL,
  `status` tinyint(4) NOT NULL DEFAULT 1,
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
CREATE TABLE IF NOT EXISTS `audit_logs` (
  `id` bigint(20) NOT NULL AUTO_INCREMENT,
  `admin_id` int(11) DEFAULT NULL,
  `action` varchar(80) NOT NULL,
  `old_value` longtext DEFAULT NULL,
  `new_value` longtext DEFAULT NULL,
  `reason` varchar(500) NOT NULL DEFAULT '',
  `ip_address` varchar(45) NOT NULL,
  `created_at` datetime NOT NULL,
  PRIMARY KEY (`id`),
  KEY `created_at` (`created_at`),
  KEY `admin_id` (`admin_id`),
  CONSTRAINT `audit_logs_ibfk_1` FOREIGN KEY (`admin_id`) REFERENCES `admins` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
CREATE TABLE IF NOT EXISTS `departments` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `department_name` varchar(50) NOT NULL,
  `status` tinyint(4) NOT NULL DEFAULT 1,
  PRIMARY KEY (`id`),
  UNIQUE KEY `department_name` (`department_name`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
CREATE TABLE IF NOT EXISTS `employees` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `employee_name` varchar(100) NOT NULL,
  `employee_code` varchar(20) NOT NULL,
  `mobile` varchar(15) DEFAULT NULL,
  `mobile_login` varchar(15) DEFAULT NULL,
  `department` varchar(50) DEFAULT NULL,
  `joining_date` date DEFAULT NULL,
  `active` tinyint(4) NOT NULL DEFAULT 1,
  `photo` varchar(255) DEFAULT NULL,
  `password` varchar(255) DEFAULT NULL,
  `deleted_at` datetime DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  `department_id` int(11) DEFAULT NULL,
  `designation` varchar(100) NOT NULL DEFAULT '',
  `password_hash` varchar(255) DEFAULT NULL,
  `session_version` int(11) NOT NULL DEFAULT 1,
  `updated_at` timestamp NULL DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `employee_code` (`employee_code`),
  UNIQUE KEY `mobile_login` (`mobile_login`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
CREATE TABLE IF NOT EXISTS `meal_attendance` (
  `id` bigint(20) NOT NULL AUTO_INCREMENT,
  `employee_id` int(11) NOT NULL,
  `meal_type_id` int(11) NOT NULL,
  `meal_date` date NOT NULL,
  `scan_timestamp` datetime DEFAULT NULL,
  `qr_token_id` bigint(20) DEFAULT NULL,
  `status` enum('valid','void') NOT NULL DEFAULT 'valid',
  `source` enum('scan','manual','legacy') NOT NULL,
  `legacy_id` int(11) DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`id`),
  UNIQUE KEY `employee_day_meal` (`employee_id`,`meal_date`,`meal_type_id`),
  UNIQUE KEY `legacy_id` (`legacy_id`),
  KEY `report_date` (`meal_date`,`meal_type_id`,`status`),
  KEY `mj_meal_fk` (`meal_type_id`),
  KEY `mj_token_fk` (`qr_token_id`),
  CONSTRAINT `mj_employee_fk` FOREIGN KEY (`employee_id`) REFERENCES `employees` (`id`),
  CONSTRAINT `mj_meal_fk` FOREIGN KEY (`meal_type_id`) REFERENCES `meal_types` (`id`),
  CONSTRAINT `mj_token_fk` FOREIGN KEY (`qr_token_id`) REFERENCES `qr_tokens` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
CREATE TABLE IF NOT EXISTS `meal_prices` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `month_year` char(7) NOT NULL,
  `breakfast_rate` decimal(10,2) NOT NULL DEFAULT 0.00,
  `lunch_rate` decimal(10,2) NOT NULL DEFAULT 0.00,
  `dinner_rate` decimal(10,2) NOT NULL DEFAULT 0.00,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
CREATE TABLE IF NOT EXISTS `meal_types` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `meal_name` varchar(40) NOT NULL,
  `start_time` time NOT NULL,
  `end_time` time NOT NULL,
  `end_inclusive` tinyint(4) NOT NULL DEFAULT 0,
  `status` tinyint(4) NOT NULL DEFAULT 1,
  `display_order` int(11) NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `meal_name` (`meal_name`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
CREATE TABLE IF NOT EXISTS `qr_tokens` (
  `id` bigint(20) NOT NULL AUTO_INCREMENT,
  `token_hash` char(64) NOT NULL,
  `issued_at` datetime NOT NULL,
  `expires_at` datetime NOT NULL,
  `status` tinyint(4) NOT NULL DEFAULT 1,
  PRIMARY KEY (`id`),
  UNIQUE KEY `token_hash` (`token_hash`),
  KEY `expires_at` (`expires_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
CREATE TABLE IF NOT EXISTS `rate_limits` (
  `bucket_key` char(64) NOT NULL,
  `bucket` bigint(20) NOT NULL,
  `hits` int(11) NOT NULL,
  PRIMARY KEY (`bucket_key`,`bucket`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
CREATE TABLE IF NOT EXISTS `schema_migrations` (
  `version` varchar(80) NOT NULL,
  `applied_at` timestamp NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`version`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
CREATE TABLE IF NOT EXISTS `system_settings` (
  `setting_key` varchar(80) NOT NULL,
  `setting_value` text NOT NULL,
  PRIMARY KEY (`setting_key`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
CREATE TABLE IF NOT EXISTS `users` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `username` varchar(50) NOT NULL,
  `password` varchar(255) NOT NULL,
  `role` varchar(20) NOT NULL DEFAULT 'admin',
  PRIMARY KEY (`id`),
  UNIQUE KEY `username` (`username`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

CREATE TABLE IF NOT EXISTS `sessions` (
  `session_id` varchar(128) NOT NULL,
  `expires` int(10) unsigned NOT NULL,
  `data` mediumtext NOT NULL,
  PRIMARY KEY (`session_id`),
  KEY `expires` (`expires`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Uploaded logo / profile photos when UPLOAD_STORAGE=database (the default on Vercel).
CREATE TABLE IF NOT EXISTS `uploaded_files` (
  `name` varchar(64) NOT NULL,
  `mime` varchar(40) NOT NULL,
  `data` longblob NOT NULL,
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`name`)
) ENGINE=InnoDB;

INSERT IGNORE INTO meal_types(id,meal_name,start_time,end_time,end_inclusive,status,display_order) VALUES (1,'Breakfast','06:00:00','11:00:00',0,1,1),(2,'Lunch','12:00:00','15:00:00',1,1,2),(3,'Dinner','19:00:00','23:30:00',1,1,3);
INSERT IGNORE INTO system_settings VALUES ('company_name','Medico Junction'),('timezone','Asia/Kolkata'),('qr_ttl','60'),('logo','');
INSERT IGNORE INTO schema_migrations(version) VALUES ('medico-v1');
SET FOREIGN_KEY_CHECKS=1;
