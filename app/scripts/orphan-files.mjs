#!/usr/bin/env node
// orphan-files.mjs — accurate orphan detection with TS parser.
// Reports: (A) files unreachable from runtime entries,
//          (B) files reachable ONLY via tests (dead at runtime),
//          (C) dead import chains.
import ts from 'typescript';
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, dirname, resolve, relative, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

const APP_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

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

const serverFiles = walk(join(APP_ROOT, 'server'), ['.js', '.mjs']);
const srcFiles = walk(join(APP_ROOT, 'src'), ['.ts', '.tsx']);
const testFiles = walk(join(APP_ROOT, 'test'), ['.ts', '.tsx']);
const allFiles = [...serverFiles, ...srcFiles, ...testFiles];

const EXT = ['', '.js', '.ts', '.tsx', '.mjs', '/index.js', '/index.ts', '/index.tsx'];
function resolveImport(fromFile, spec) {
  if (!spec.startsWith('.')) return null;
  let base = resolve(dirname(fromFile), spec);
  for (const ext of EXT) { const c = base + ext; if (existsSync(c) && statSync(c).isFile()) return c; }
  return null;
}

// build edge list: file -> Set(target)
const edges = new Map();
for (const f of allFiles) {
  let src = ''; try { src = readFileSync(f, 'utf8'); } catch { continue; }
  const targets = new Set();
  const sf = ts.createSourceFile(f, src, ts.ScriptTarget.ES2022, true, /\.tsx?$/.test(f) ? ts.ScriptKind.TS : ts.ScriptKind.JS);
  sf.forEachChild(node => {
    const specNode = (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier;
    if (specNode && ts.isStringLiteral(specNode)) {
      const t = resolveImport(f, specNode.text);
      if (t) targets.add(t);
    }
  });
  // dynamic + require (textual fallback)
  const reDyn = /(?:await\s+)?(?:import|require)\s*\(\s*['"`]([^'"`]+)['"`]\s*\)/g;
  let m;
  while ((m = reDyn.exec(src))) {
    if (!m[1].startsWith('.')) continue;
    const t = resolveImport(f, m[1]);
    if (t) targets.add(t);
  }
  edges.set(f, targets);
}

// reverse map: who imports file X (excluding tests for runtime graph)
const runtimeImporters = new Map(); // target -> Set(file)
const testImporters = new Map();
for (const [f, targets] of edges) {
  for (const t of targets) {
    const bucket = /\/test\//.test(f) ? testImporters : runtimeImporters;
    if (!bucket.has(t)) bucket.set(t, new Set());
    bucket.get(t).add(f);
  }
}

// BFS from runtime entries
const entries = [
  join(APP_ROOT, 'server', 'index.js'),
  join(APP_ROOT, 'server', 'supervisor.js'),
  join(APP_ROOT, 'src', 'main.tsx'),
].filter(existsSync);
const reached = new Set();
const q = [...entries];
while (q.length) {
  const f = q.shift();
  if (reached.has(f)) continue;
  reached.add(f);
  for (const t of edges.get(f) || []) if (!reached.has(t)) q.push(t);
}

console.log('### (A) ORPHAN FILES — unreachable from runtime AND not test-imported:');
for (const f of [...serverFiles, ...srcFiles].sort()) {
  if (reached.has(f)) continue;
  const ti = testImporters.get(f);
  if (!ti || ti.size === 0) console.log('  TOTAL-ORPHAN:', relative(APP_ROOT, f));
}
console.log('\n### (B) TEST-ONLY FILES — unreachable at runtime, imported only by tests:');
for (const f of [...serverFiles, ...srcFiles].sort()) {
  if (reached.has(f)) continue;
  const ti = testImporters.get(f);
  if (ti && ti.size > 0) console.log('  TEST-ONLY:', relative(APP_ROOT, f), '<-', [...ti].map(x => relative(APP_ROOT, x)).join(', '));
}
console.log('\n### (C) Import chains of the orphans (to catch full dead subgraphs):');
for (const f of [...serverFiles, ...srcFiles].sort()) {
  if (reached.has(f)) continue;
  const ti = testImporters.get(f);
  if (ti && ti.size > 0 && !reached.has(f)) {
    // test-only: what does IT import that is also runtime-dead?
    const deadDeps = [...(edges.get(f) || [])].filter(t => !reached.has(t) && (t.startsWith(join(APP_ROOT, 'server')) || t.startsWith(join(APP_ROOT, 'src'))));
    if (deadDeps.length) console.log('  ' + relative(APP_ROOT, f) + ' -> ' + deadDeps.map(d => relative(APP_ROOT, d)).join(', '));
  }
}
