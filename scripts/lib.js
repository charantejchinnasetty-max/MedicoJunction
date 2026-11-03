'use strict';
// Shared helpers for CLI scripts.
const readline = require('readline');

/** Ask a question on the terminal; `hidden` masks typed characters (passwords). */
function ask(question, { hidden = false } = {}) {
  if (!process.stdin.isTTY && process.env.MJ_PASSWORD !== undefined && hidden) return Promise.resolve(process.env.MJ_PASSWORD);
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    if (hidden) {
      rl._writeToOutput = (s) => { if (s.includes(question)) rl.output.write(s); else rl.output.write('*'); };
    }
    rl.question(question, (answer) => {
      rl.close();
      if (hidden) process.stdout.write('\n');
      resolve(answer);
    });
  });
}

/** --name value style arguments. */
function args() {
  const out = {};
  const list = process.argv.slice(2);
  for (let i = 0; i < list.length; i++) {
    if (list[i].startsWith('--')) {
      const key = list[i].slice(2);
      out[key] = list[i + 1] && !list[i + 1].startsWith('--') ? list[++i] : true;
    }
  }
  return out;
}

module.exports = { ask, args };
