'use strict';
const db = require('../config/database');
const time = require('../utils/time');

const SENSITIVE = ['password', 'password_hash'];

/** Remove credential fields from anything written to the audit trail. */
function scrub(value) {
  if (Array.isArray(value)) return value.map(scrub);
  if (value && typeof value === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(value)) if (!SENSITIVE.includes(k)) out[k] = scrub(v);
    return out;
  }
  return value;
}

/**
 * PHP audit(): actor (admin id when an admin is signed in), action, JSON before/after,
 * reason, IP address, IST timestamp. Pass `conn` to write inside the caller's transaction.
 */
async function audit(req, action, oldValue = null, newValue = null, reason = '', conn) {
  const identity = req.session && req.session.identity;
  await db.query(
    'INSERT INTO audit_logs(admin_id,action,old_value,new_value,reason,ip_address,created_at) VALUES(?,?,?,?,?,?,?)',
    [
      identity && identity.role === 'admin' ? identity.id : null,
      action,
      JSON.stringify(scrub(oldValue)),
      JSON.stringify(scrub(newValue)),
      reason,
      String(req.ip || 'CLI').replace(/^::ffff:/, '').slice(0, 45),
      time.ymdhis(time.now()),
    ],
    conn,
  );
}

async function listAudit(page) {
  const offset = (page - 1) * 50;
  return db.rows(`SELECT l.*,a.name admin_name FROM audit_logs l LEFT JOIN admins a ON a.id=l.admin_id ORDER BY l.id DESC LIMIT 50 OFFSET ${offset}`);
}

module.exports = { audit, listAudit, scrub };
