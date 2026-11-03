# Medico Junction — Meal Attendance

Employee meal attendance with a rotating counter QR code, manual corrections with an audit
trail, monthly meal rates, reports and CSV exports.

The application runs on **Node.js + Express + MySQL**. The pages, styling and scripts are the
same as the original PHP version; addresses no longer end in `.php` — see [MIGRATION.md](MIGRATION.md) for how each PHP
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
| `BASE_PATH` | URL prefix. Empty serves at `/`; set `/mess_management` to keep the old prefix |
| `QR_SECRET` | Optional QR signing key (64 hex chars). If empty, `storage/qr.key` is used |
| `TRUST_PROXY` | Set to `1` when running behind a reverse proxy that terminates HTTPS |
| `COOKIE_SECURE` | Secure cookies; defaults to `true` in production |
| `DB_SSL`, `DB_SSL_CA` | TLS for hosted MySQL; `DB_SSL_CA` is the CA certificate text or a `.pem` file path |
| `UPLOAD_STORAGE` | `disk` (default) or `database` (default on Vercel) |

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

## Deploy to Vercel

The repository is ready for Vercel: `vercel.json` runs the Express app as one serverless
function (`api/index.js`), and the build step (`npm run vercel-build`) copies `assets/` to
`public/assets` so Vercel's CDN serves the CSS, JavaScript and images.

### 1. A MySQL database on the internet

Vercel cannot reach the MySQL on your own computer (XAMPP). Create a hosted MySQL database,
for example the free MySQL plan on [Aiven](https://aiven.io/free-mysql-database) (choose a
region close to India if offered). Note its host, port, user, password and database name,
and download its **CA certificate** (`ca.pem`).

Copy your existing data into it from your computer:

1. Export the database from phpMyAdmin (XAMPP → `mess_management` → Export → SQL) as
   `mess_management.sql`.
2. Create `.env.vercel` next to `.env` (it is git-ignored) with the hosted database:
   ```ini
   DB_HOST=<host>
   DB_PORT=<port>
   DB_NAME=<database, e.g. defaultdb>
   DB_USER=<user>
   DB_PASSWORD=<password>
   DB_SSL=true
   DB_SSL_CA=ca.pem
   ```
3. Run:
   ```bash
   node --env-file=.env.vercel scripts/import-sql.js mess_management.sql
   node --env-file=.env.vercel scripts/migrate.js
   ```

### 2. The Vercel project

1. On [vercel.com](https://vercel.com) choose **Add New → Project**, import this GitHub
   repository and keep the detected settings (they come from `vercel.json`).
2. Under **Environment Variables** add:

   | Name | Value |
   |---|---|
   | `DB_HOST`, `DB_PORT`, `DB_NAME`, `DB_USER`, `DB_PASSWORD` | the hosted database |
   | `DB_SSL` | `true` |
   | `DB_SSL_CA` | the full text of `ca.pem` (from `-----BEGIN CERTIFICATE-----` to the end) |
   | `SESSION_SECRET` | a long random string (see [Environment](#environment)) |
   | `QR_SECRET` | 64 random hex characters: `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"` |

   Leave `BASE_PATH` unset.
3. **Deploy.** Open the `https://<project>.vercel.app` address — it is HTTPS, so phone
   cameras can scan the counter QR.

If a page shows *Configuration error: …*, add or fix the variable it names and redeploy.

### How it differs from running on your own server

* **Uploads** (logo, profile photos) are stored in the database table `uploaded_files`
  because Vercel's disk is read-only. They are scaled to at most 1200 × 1200 px.
  (Set `UPLOAD_STORAGE=database` to use the same storage on any server.)
* **Login rate limits** are counted per function instance.
* Functions run in Mumbai (`bom1`, set in `vercel.json`); keep the database nearby for speed.

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
api/index.js       Vercel entry point (vercel.json)
scripts/           migrate, create-admin, set-employee-password, import-sql, vercel-build
src/
  config/          environment and MySQL pool
  middleware/      security headers, sessions, CSRF, auth, rate limits, uploads, errors
  services/        business rules (meals, QR, attendance, employees, reports, settings…)
  controllers/     request handlers per area
  routes/          URL map (old .php addresses redirect here)
  views/           EJS templates reproducing the original pages
  app.js, server.js
storage/           qr.key (generated, git-ignored)
test/              unit and integration tests
```

## Main URLs

| Area | URL |
|---|---|
| Login / logout | `/login`, `POST /logout` |
| Admin | `/admin/dashboard`, `attendance`, `employees`, `employee-view`, `reports`, `meal-qr`, `meal-settings`, `meal_prices`, `settings`, `audit`, `export_report`, `export_employees` |
| Employee | `/employee/dashboard`, `scan`, `history`, `profile` |
| API (JSON) | `POST /api/qr-token` (admin), `POST /api/scan-meal` (employee), `GET /api/dashboard-stats`, `GET /api/reports` (admin) |

Old addresses from the PHP version (for example `/employee/dashboard.php`) redirect
permanently to the new ones, so existing bookmarks keep working.

API responses use `{ "success", "code", "message", "data" }`; state-changing calls need the
`X-CSRF-Token` header from the page's `csrf-token` meta tag.
