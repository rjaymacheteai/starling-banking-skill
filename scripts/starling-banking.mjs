#!/usr/bin/env node
// Unofficial Starling Bank command-line tool used by the starling-banking agent skill.
// Zero dependencies: needs only Node.js 18 or newer.
const major = Number(process.versions.node.split('.')[0]);
if (major < 18) {
  console.log(JSON.stringify({ status: 'error', error: { code: 'NODE_TOO_OLD', message: `Node.js ${process.versions.node} is too old.`, hint: 'Install Node.js 18 or newer from https://nodejs.org, then try again.' } }, null, 2));
  process.exit(1);
}

const { main } = await import('./lib/cli.mjs');
const { stdout, exitCode } = await main(process.argv.slice(2));
process.stdout.write(stdout + '\n', () => process.exit(exitCode));
