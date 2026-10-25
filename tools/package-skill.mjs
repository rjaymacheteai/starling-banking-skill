#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const version = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8')).version;
const files = ['SKILL.md', 'config.json.example', 'scripts', 'references', 'endpoints', 'LICENSE', 'THIRD_PARTY_NOTICES.md'];
execFileSync('git', ['diff', '--exit-code', 'HEAD', '--', ...files], { cwd: root, stdio: 'pipe' });
const dir = path.join(root, 'dist');
mkdirSync(dir, { recursive: true });
const name = `starling-banking-v${version}.tar.gz`;
const archive = path.join(dir, name);
execFileSync('git', ['archive', '--format=tar.gz', '--prefix=starling-banking/', `--output=${archive}`, 'HEAD', '--', ...files], { cwd: root });
const digest = createHash('sha256').update(readFileSync(archive)).digest('hex');
writeFileSync(path.join(dir, 'SHA256SUMS'), `${digest}  ${name}\n`);
console.log(archive);
console.log(`SHA256 ${digest}`);
