'use strict';
// Vercel entry point. Vercel runs the Express app as one serverless function; vercel.json
// sends every request that is not a static file in public/ here.
// Local development and normal servers keep using src/server.js (npm run dev / npm start).
let handler;
try {
  const { createApp } = require('../src/app');
  handler = createApp();
} catch (err) {
  // Missing or wrong environment variables: show which one instead of a blank crash page.
  console.error(`Configuration error: ${err.message}`);
  handler = (req, res) => {
    res.statusCode = 500;
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.end(`Configuration error: ${err.message}\nFix the environment variables in Vercel → Project → Settings → Environment Variables, then redeploy.`);
  };
}
module.exports = handler;
