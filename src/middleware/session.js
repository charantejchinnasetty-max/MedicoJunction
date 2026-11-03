'use strict';
const session = require('express-session');
const env = require('../config/env');
const { pool } = require('../config/database');

const IDLE_SECONDS = 8 * 60 * 60; // PHP: 28800 s idle timeout

/** Server-side session store in the application's MySQL database (table `sessions`). */
class MySQLSessionStore extends session.Store {
  constructor() {
    super();
    this.ready = null;
    if (!env.isTest) {
      this.cleanup = setInterval(() => this.prune().catch(() => {}), 15 * 60 * 1000);
      this.cleanup.unref();
    }
  }
  init() {
    this.ready ??= pool.query(
      'CREATE TABLE IF NOT EXISTS sessions (session_id VARCHAR(128) NOT NULL PRIMARY KEY, expires INT UNSIGNED NOT NULL, data MEDIUMTEXT NOT NULL, INDEX(expires)) ENGINE=InnoDB',
    );
    return this.ready;
  }
  expiry() { return Math.floor(Date.now() / 1000) + IDLE_SECONDS; }
  get(sid, cb) {
    this.init()
      .then(() => pool.execute('SELECT data FROM sessions WHERE session_id=? AND expires>?', [sid, Math.floor(Date.now() / 1000)]))
      .then(([r]) => cb(null, r[0] ? JSON.parse(r[0].data) : null), cb);
  }
  set(sid, sess, cb) {
    this.init()
      .then(() => pool.execute('INSERT INTO sessions(session_id,expires,data) VALUES(?,?,?) ON DUPLICATE KEY UPDATE expires=VALUES(expires),data=VALUES(data)', [sid, this.expiry(), JSON.stringify(sess)]))
      .then(() => cb && cb(null), (e) => cb && cb(e));
  }
  touch(sid, sess, cb) {
    this.init()
      .then(() => pool.execute('UPDATE sessions SET expires=? WHERE session_id=?', [this.expiry(), sid]))
      .then(() => cb && cb(null), (e) => cb && cb(e));
  }
  destroy(sid, cb) {
    this.init()
      .then(() => pool.execute('DELETE FROM sessions WHERE session_id=?', [sid]))
      .then(() => cb && cb(null), (e) => cb && cb(e));
  }
  async prune() {
    await this.init();
    await pool.execute('DELETE FROM sessions WHERE expires<?', [Math.floor(Date.now() / 1000)]);
  }
}

const store = new MySQLSessionStore();

const sessionMiddleware = session({
  name: 'MJSESSION',
  secret: env.sessionSecret,
  store,
  resave: false,
  saveUninitialized: false,
  rolling: false,
  cookie: {
    path: env.basePath || '/',
    httpOnly: true,
    sameSite: 'lax',
    secure: env.cookieSecure,
    maxAge: null, // browser-session cookie, as in PHP (lifetime 0)
  },
});

module.exports = { sessionMiddleware, store, IDLE_SECONDS };
