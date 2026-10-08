#!/usr/bin/env node
// alive-check.mjs — for given file, list exports WITH external mention counts
// (external = any file except the defining file itself).
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, dirname, resolve, relative, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

const APP_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const targets = process.argv.slice(2); // file paths relative to app root

function walk(dir, exts, out = []) {
  if (!existsSync(dir)) return out;
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    const st = statSync(p);
    if (st.isDirectory()) { if (['node_modules', 'dist', '.git'].includes(e)) continue; walk(p, exts, out); }
    else if (exts.includes(extname(e))) out.push(p);
  }
  return out;
}
const searchSpace = [
  ...walk(join(APP_ROOT, 'src'), ['.ts', '.tsx']),
  ...walk(join(APP_ROOT, 'test'), ['.ts', '.tsx']),
  ...walk(join(APP_ROOT, 'server'), ['.js']),
  ...walk(join(APP_ROOT, 'scripts'), ['.mjs']),
  join(APP_ROOT, 'index.html'),
].filter(existsSync);

for (const t of targets) {
  const file = resolve(APP_ROOT, t);
  const src = readFileSync(file, 'utf8');
  const names = new Set();
  let m;
  const patterns = [
    /export\s+(?:async\s+)?function\s+([A-Za-z_$][\w$]*)/g,
    /export\s+(?:const|let|var)\s+([A-Za-z_$][\w$]*)/g,
    /export\s+(?:interface|type|class|enum)\s+([A-Za-z_$][\w$]*)/g,
  ];
  for (const re of patterns) while ((m = re.exec(src))) names.add(m[1]);
  const reList = /export\s*\{([^}]*)\}/g;
  while ((m = reList.exec(src))) {
    if (/from/.test(m[1])) continue;
    for (let part of m[1].split(',')) {
      part = part.trim(); if (!part) continue;
      const orig = part.split(/\s+as\s+/)[0].trim();
      if (orig && orig !== 'default') names.add(orig);
    }
  }
  console.log(`\n===== ${t} (${names.size} exports) =====`);
  for (const n of [...names].sort()) {
    let mentions = 0;
    const files = [];
    for (const f of searchSpace) {
      if (f === file) continue;
      let s = ''; try { s = readFileSync(f, 'utf8'); } catch { continue; }
      const re = new RegExp(`\\b${n}\\b`);
      if (re.test(s)) { mentions++; files.push(relative(APP_ROOT, f)); }
    }
    const status = mentions === 0 ? 'DEAD' : 'USED';
    console.log(`  ${status}  ${n}  (${mentions}${mentions <= 3 && mentions > 0 ? ': ' + files.join(', ') : ''})`);
  }
}
