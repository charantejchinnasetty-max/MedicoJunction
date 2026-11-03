# Medico Junction — Meal Attendance

Employee meal attendance with a rotating counter QR code, manual corrections with an audit
trail, monthly meal rates, reports and CSV exports.

The application runs on **Node.js + Express + MySQL**. The pages, styling, scripts and URLs
are the same as the original PHP version — see [MIGRATION.md](MIGRATION.md) for how each PHP
file maps to the Node.js code.

## Requirements

| | Version |
|---|---|
| Node.js | 20.19+ (an active LTS release: 20, 22 or 24) |
| npm | 10+ (ships with Node.js) |
| MySQL / MariaDB | MySQL 5.7+ / 8.x, or MariaDB 10.4+ (InnoDB) |

PHP is **not** required.

## Installation

```bash
git clone https://github.com/charantejchinnasetty-max/MedicoJunction.git
cd MedicoJunction
npm install
```

## Environment

```bash
cp .env.example .env
```

Edit `.env`:

| Variable | Purpose |
|---|---|
| `NODE_ENV` | `development` or `production` |
| `PORT` | HTTP port (default 3000) |
| `DB_HOST`, `DB_PORT`, `DB_NAME`, `DB_USER`, `DB_PASSWORD` | MySQL connection. The PHP app used the database `mess_management`. |
| `SESSION_SECRET` | **Required in production.** Long random string: `node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"` |
| `BASE_URL` | Public address, used in start-up logs |
| `BASE_PATH` | URL prefix. Empty serves at `/`; set `/mess_management` to keep the exact PHP URLs |
| `QR_SECRET` | Optional QR signing key (64 hex chars). If empty, `storage/qr.key` is used |
| `TRUST_PROXY` | Set to `1` when running behind a reverse proxy that terminates HTTPS |
| `COOKIE_SECURE` | Secure cookies; defaults to `true` in production |

`.env` is git-ignored. Never commit it.

## Database setup

### Existing installation (moving from the PHP version)

Keep your current database — no data is changed or removed.

```bash
npm run migrate
```

This is the Node.js version of `scripts/migrate.php`. It is additive and safe to run more
than once: it applies `database/upgrade.sql` if needed, creates the `sessions` table, and
creates `storage/qr.key` if no `QR_SECRET` is set. If your database was already migrated by
the PHP script it just prints `Already migrated.`

Existing admin and employee passwords keep working (PHP `$2y$` bcrypt hashes are verified
as-is).

### New installation

```bash
mysql -e "CREATE DATABASE mess_management CHARACTER SET utf8mb4"
mysql mess_management < database/schema.sql
npm run create-admin -- --username admin --name "Mess Manager"
npm run set-employee-password
npm run migrate
```

### Account helpers

* `npm run create-admin -- --username <name>` — create an administrator, or reset an
  existing administrator's password (this signs them out everywhere).
* `npm run set-employee-password` — set the common employee password. New employees get it
  automatically; existing employees get it when an admin ticks
  *Reset to common employee password* on their profile.

## Development

```bash
npm run dev      # restarts on changes to src/
```

Open <http://localhost:3000>.

## Production

```bash
NODE_ENV=production npm start
```

Deployment checklist:

1. **HTTPS is required.** Phones only allow camera access (QR scanning) on secure pages.
   Put the app behind Nginx/Apache/Caddy with a TLS certificate and set `TRUST_PROXY=1`.
2. Set a real `SESSION_SECRET` (the app refuses to start in production without one).
3. Run the app under a process manager (systemd, PM2, Docker) so it restarts on failure.
4. Keep `assets/uploads/` (logo and employee photos) and `storage/` (QR key) on persistent
   storage and include them in backups along with the database.
5. Make sure the server clock is correct; meal windows always use Indian Standard Time
   (Asia/Kolkata) regardless of the server's own time zone.
6. Run `npm run migrate` after every deployment.

Example Nginx location:

```nginx
location / {
    proxy_pass http://127.0.0.1:3000;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    client_max_body_size 3m;
}
```

## Testing and linting

```bash
npm run lint
TEST_DB_USER=root TEST_DB_PASSWORD=secret npm test
```

The integration tests create and **drop** a database named by `TEST_DB_NAME`
(default `medico_junction_test`; the name must contain "test"). Never point it at real data.

## Project structure

```
assets/            Frontend: CSS, JS, images, vendor libraries, uploads (unchanged)
database/          schema.sql (new installs), upgrade.sql (migration)
scripts/           migrate, create-admin, set-employee-password
src/
  config/          environment and MySQL pool
  middleware/      security headers, sessions, CSRF, auth, rate limits, uploads, errors
  services/        business rules (meals, QR, attendance, employees, reports, settings…)
  controllers/     request handlers per area
  routes/          URL map (same .php URLs as before)
  views/           EJS templates reproducing the original pages
  app.js, server.js
storage/           qr.key (generated, git-ignored)
test/              unit and integration tests
```

## Main URLs

| Area | URL |
|---|---|
| Login / logout | `/login.php`, `POST /logout.php` |
| Admin | `/admin/dashboard.php`, `attendance.php`, `employees.php`, `employee-view.php`, `reports.php`, `meal-qr.php`, `meal-settings.php`, `meal_prices.php`, `settings.php`, `audit.php`, `export_report.php`, `export_employees.php` |
| Employee | `/employee/dashboard.php`, `scan.php`, `history.php`, `profile.php` |
| API (JSON) | `POST /api/qr-token.php` (admin), `POST /api/scan-meal.php` (employee), `GET /api/dashboard-stats.php`, `GET /api/reports.php` (admin) |

API responses use `{ "success", "code", "message", "data" }`; state-changing calls need the
`X-CSRF-Token` header from the page's `csrf-token` meta tag.
