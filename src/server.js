'use strict';
let env;
try {
  env = require('./config/env'); // sets TZ=Asia/Kolkata first
} catch (err) {
  console.error(`Configuration error: ${err.message}`);
  process.exit(1);
}
const { pool } = require('./config/database');
const { store } = require('./middleware/session');
const { createApp } = require('./app');

async function start() {
  // Fail fast with a clear message if the database is unreachable.
  await pool.query('SELECT 1');
  await store.init();
  const app = createApp();
  const server = app.listen(env.port, () => {
    console.log(`Medico Junction running on port ${env.port} (${env.nodeEnv}) — ${env.baseUrl}${env.basePath}/`);
  });
  const shutdown = () => {
    server.close(() => pool.end().finally(() => process.exit(0)));
    setTimeout(() => process.exit(1), 10000).unref();
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

start().catch((err) => {
  console.error('Failed to start:', err.message);
  process.exit(1);
});
