'use strict';
// Vercel build step: Vercel serves static files only from public/ (express.static is not used
// there), so copy the frontend assets to public/assets. Uploaded files are not copied —
// on Vercel they live in the database (table uploaded_files).
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const out = path.join(ROOT, 'public');
const src = path.join(ROOT, 'assets');

fs.rmSync(out, { recursive: true, force: true });
fs.cpSync(src, path.join(out, 'assets'), {
  recursive: true,
  filter: (p) => {
    const rel = path.relative(src, p);
    if (rel === '') return true;
    if (rel.split(path.sep).some((part) => part.startsWith('.'))) return false; // .htaccess, .gitkeep
    if (/\.(php[0-9]?|phtml|phar)$/i.test(p)) return false;
    return !(rel === 'uploads' || rel.startsWith(`uploads${path.sep}`));
  },
});
let count = 0;
(function walk(d) { for (const e of fs.readdirSync(d, { withFileTypes: true })) e.isDirectory() ? walk(path.join(d, e.name)) : count++; })(out);
console.log(`Copied ${count} static files to public/assets.`);
