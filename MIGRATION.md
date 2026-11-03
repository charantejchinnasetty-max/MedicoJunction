# MedicoJunction — PHP → Node.js migration notes

This document records what the PHP application did (Stage 1–2 analysis) and where each
piece of behaviour now lives in the Node.js/Express application.

## 1. Architecture of the PHP application (as found on `main`)

* **Front controllers.** Every page in `admin/*.php`, `employee/*.php` and `api/*.php` was a
  4-line stub that `require`d `app/bootstrap.php` plus one of `app/admin-pages.php`,
  `app/employee-pages.php` or `app/api.php`. Those files switched on
  `basename($_SERVER['SCRIPT_NAME'])` to decide what to render or do.
* **Rendering.** HTML was produced by PHP string-building helpers in `app/layout.php`
  (`pageStart`, `pageEnd`, `heading`, `filterForm`, `cards`, `attendanceTable`, `icon`, `logo`)
  styled by `assets/css/medico.css` and driven by `assets/js/medico.js`, `counter.js`,
  `dashboard-medico.js`, `scanner.js` plus vendored Chart.js / html5-qrcode / qrcodejs.
* **Dead code.** `includes/*.php` (old Bootstrap header/sidebar/topbar/footer), `config/db.php`
  (mysqli with hard-coded credentials), `assets/css/{style,dashboard,employee,attendance,report}.css`
  and `assets/js/{app,attendance,charts,dashboard}.js` were not referenced by any live page.
  `database/mess_management.sql` and `assets/uploads/employees.php` were empty files.
* **Database.** PDO (`config/database.php`, env `MJ_DB_*`), `SET time_zone='+05:30'`,
  native prepared statements. Helpers `query/rows/one`.
* **Sessions.** Native PHP sessions, cookie `MJSESSION`, `httponly`, `samesite=Lax`,
  `secure` on HTTPS, browser-session lifetime, strict mode, 8 h idle timeout,
  `session_regenerate_id(true)` on login, per-account `session_version` invalidation.
* **CSRF.** One token per session, sent as hidden `csrf` field or `X-CSRF-Token` header,
  compared with `hash_equals`, POST-only.
* **Rate limiting.** `rate_limits` table, fixed windows: login 40/15 min per IP and
  10/15 min per role+username, scan 12/min per employee, QR refresh 10/min per admin.
* **Headers.** `X-Content-Type-Options`, `X-Frame-Options: SAMEORIGIN`,
  `Referrer-Policy: same-origin`, `Cache-Control: no-store`, strict CSP (`script-src 'self'`).
* **Base path.** All URLs were prefixed with the constant `BASE='/mess_management'`.

### Database schema in use

`database/upgrade.sql` + `scripts/migrate.php` (additive migration "medico-v1") on top of the
original tables. Tables used by the live code:

| Table | Purpose |
|---|---|
| `admins` | admin accounts (`password_hash`, `status`, `session_version`) |
| `employees` | employee profiles; login by `mobile_login` with `password_hash`; soft delete via `deleted_at` |
| `departments` | department lookup (`employees.department_id`; `employees.department` text is kept in sync) |
| `meal_types` | Breakfast/Lunch/Dinner windows, `end_inclusive`, `status`, `display_order` |
| `meal_attendance` | one row per employee/date/meal (unique key), `status` valid/void, `source` scan/manual/legacy |
| `qr_tokens` | SHA-256 of every issued counter QR token with expiry |
| `meal_prices` | monthly rates (insert-only history; latest row per `month_year` wins) |
| `system_settings` | `company_name`, `logo`, `qr_ttl`, `timezone`, `employee_default_password_hash` |
| `audit_logs` | admin actions with JSON before/after, reason, IP |
| `rate_limits`, `schema_migrations` | infrastructure |
| `users`, `attendance` | original legacy tables, retained untouched by the migration |

## 2. Migration map

| PHP file / function | Node.js replacement |
|---|---|
| `app/bootstrap.php` `db/query/rows/one` | `src/config/database.js` (mysql2/promise pool, `query/rows/one/withTransaction`) |
| `config/database.php`, `config/db.php` | `src/config/env.js` + `.env` (no credentials in source) |
| bootstrap security headers | `src/middleware/security.js` (Helmet with the identical CSP) |
| bootstrap `session_*` | `src/middleware/session.js` (express-session + MySQL store, cookie `MJSESSION`) |
| `csrf()` / `checkCsrf()` | `src/middleware/csrf.js` |
| `auth($role)` | `src/middleware/auth.js` (`requireAdmin`, `requireEmployee`) |
| `rateLimit()` | `src/middleware/rateLimits.js` (express-rate-limit, same keys & windows) |
| `audit()` | `src/services/audit.js` |
| `setting()` | `src/services/settings.js` |
| `normalizeMobile`, `cleanText`, `validDate` | `src/utils/validation.js` |
| `employeePasswordHash()`, `password_verify` | `src/services/passwords.js` (bcrypt, `$2y$` compatible) |
| `app/meals.php` `activeMeal/serviceStatus/validateWindows` | `src/services/meals.js` |
| `app/meals.php` `issueToken/validateToken/qrSecret` | `src/services/qr.js` |
| `app/meals.php` `recordMeal/duplicateResult` | `src/services/attendance.js` |
| `app/reports.php` `filters/whereAttendance/attendanceRows/totals/summaryRows/dashboardData` | `src/services/reports.js` |
| `app/reports.php` `exportCsv` + employee CSV | `src/services/csv.js`, `src/controllers/exportController.js` |
| `app/actions.php` `uploadImage` | `src/middleware/upload.js` (multer) + `src/services/images.js` (sharp re-encode) |
| `app/actions.php` `saveEmployee/changeEmployeeDeletion` | `src/services/employees.js` |
| `app/actions.php` `correctAttendance` | `src/services/attendance.js` |
| `app/actions.php` `saveMealSettings/saveSettings/saveRates` | `src/services/meals.js`, `settings.js`, `prices.js` |
| `app/layout.php` helpers | `src/views/partials/*.ejs` |
| `app/login-page.php`, `login.php`, `logout.php`, `index.php` | `src/controllers/authController.js`, `src/views/login.ejs` |
| `app/admin-pages.php` (all admin pages) | `src/controllers/adminController.js`, `src/views/admin/*.ejs` |
| `app/employee-pages.php` | `src/controllers/employeeController.js`, `src/views/employee/*.ejs` |
| `app/api.php` + `api/*.php` | `src/controllers/apiController.js`, `src/routes/api.js` |
| retired stubs (`admin/attendance_load.php`, `delete_employee.php`, …) | `src/routes/admin.js` (same 410 / redirect behaviour) |
| `scripts/migrate.php` | `scripts/migrate.js` (`npm run migrate`) |
| `.htaccess` deny rules | only `assets/` is served; uploads restricted to image extensions |

### URL compatibility

Every public URL is unchanged (`/admin/employees.php`, `/api/scan-meal.php`, …) so bookmarks,
the vendored JS (which calls `/api/*.php`) and the counter-screen QR flow keep working.
The `/mess_management` prefix is now configurable with `BASE_PATH`.

## 3. Behaviour preserved deliberately

* Date-range presets, 3-year range limit, 25-row pagination, sort keys, CSV formula-injection
  escaping, UTF-8 BOM on report CSV, employee CSV columns.
* QR token format `base64url(payload).hex(HMAC-SHA256)`, 30–60 s TTL, server-side token
  registry, exact error codes/messages (`INVALID_QR`, `QR_EXPIRED`, `MEAL_CLOSED`,
  `ALREADY_RECORDED`, `ADMIN_REVIEW`, …), 409 on failure.
* Duplicate prevention by the `employee_day_meal` unique key, row locks inside transactions,
  voided meals can only be restored by an admin.
* Uploads re-encoded to PNG with random names (polyglot files cannot survive), ≤2 MB, ≤3000×3000.
* Soft delete disables login and keeps attendance; restore returns the employee as inactive.
* Audit entries for every action the PHP code audited, with password fields removed.

## 4. Database changes made by the Node version

* `sessions` table (created automatically by `express-mysql-session`) for server-side sessions.
* `scripts/migrate.js` performs the same additive "medico-v1" migration as `migrate.php`; it also
  adds `employees.mobile_login`/`deleted_at` only if an older database lacks them.
* No existing table, column or row is altered or removed.

## 5. Verification performed

* **Side-by-side parity test.** The original PHP app (PHP 8.3, MariaDB 10.11) and the Node app
  were run against identical copies of the same migrated database. Every admin and employee
  page, every validation-error page, both CSV exports and all four JSON APIs were fetched from
  both and compared byte-for-byte (only per-session CSRF tokens and equivalent HTML entity
  spellings normalised): **identical**. The same sequence of 46 write actions (employee
  create/edit/reset/deactivate/delete/restore, attendance add/correct/void/restore, meal
  timings, settings, rates, QR issue + scans, logout) was then run against both, and the
  resulting rows in `employees`, `departments`, `meal_attendance`, `meal_types`,
  `meal_prices`, `system_settings` and all `audit_logs` before/after JSON were compared:
  **identical**.
* **Uploads.** Valid PNG/JPG, 3001 px image, >2 MB file, GIF, PHP file renamed `.png`,
  truncated JPEG and PNG+PHP polyglot produce the same outcome as PHP; stored files are clean
  re-encoded PNGs.
* **Automated suite.** `npm test`: 46 unit + integration tests.

## 6. Intentional differences from the PHP version

| Area | PHP | Node.js | Why |
|---|---|---|---|
| Voiding with no record selected | inserted a new attendance row and logged it as `attendance_void` | rejected: "Choose an existing attendance record to void." | confirmed bug |
| Unknown attendance `action` value | treated as an edit, logged as `attendance_<value>` | rejected | arbitrary text reached the audit action |
| Common employee password not configured | 500 "Temporarily unavailable" | clear message naming `npm run set-employee-password` | admins could not diagnose it |
| Admin / employee password setup | none (manual SQL) | `npm run create-admin`, `npm run set-employee-password` | no UI existed |
| Login rate-limit page | HTTP 200 | HTTP 429 (same page and message) | correct status |
| Unknown `/api/*.php` path | web server's HTML 404 | JSON `NOT_FOUND` 404 | consistent API |
| Rate-limit windows | fixed clock buckets in `rate_limits` | per-key windows in memory (same limits) | see unresolved issues |
| QR signing key | `storage/qr.key` committed to git | git-ignored; generated by `npm run migrate` or `QR_SECRET` | the committed key was public |
| Page addresses | `/employee/dashboard.php` | `/employee/dashboard` (old `.php` addresses redirect with 301; old API paths still answer) | requested: clean URLs |
| Session storage | PHP files | `sessions` table | survives restarts, works with several servers |
| Audit IP | `REMOTE_ADDR` | client IP (honours `TRUST_PROXY`), IPv4-mapped prefix removed | |

## 7. Unresolved issues / follow-ups

* **Rotate the QR key on existing servers.** The old `storage/qr.key` was public in git
  history. Delete it and run `npm run migrate` (or set `QR_SECRET`). QR codes live ≤60 s, so
  this is invisible to users.
* **`config/db.php` had a hard-coded MySQL root login** (empty password) in git history. If
  that account is used anywhere, give it a password.
* **Rate limits are per process.** If you run several Node processes, each keeps its own
  counters (effective limit = limit × processes). A shared store can be added to
  `express-rate-limit` if needed.
* **Original base schema was not in the repository** (`mess_management.sql` was empty). The
  legacy tables in `database/schema.sql` were reconstructed from the queries the PHP code ran;
  existing databases are unaffected because they keep their own tables.
* **Unused frontend files kept** as requested: `assets/css/{style,dashboard,employee,attendance,report}.css`,
  `assets/js/{app,attendance,charts,dashboard}.js` and `assets/images/*` are not referenced
  by any page (they were already unused in the PHP version) and can be deleted later.
* **Meal costs map rates by meal id** (1 = breakfast, 2 = lunch, 3 = dinner), exactly as the
  PHP report did. Adding a fourth meal type would need a rate column for it.
