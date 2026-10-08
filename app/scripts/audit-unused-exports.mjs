#!/usr/bin/env node
// deadcode-pass3.mjs — ACCURATE dead-export detector using the TypeScript
// compiler API as parser (handles multi-line imports, dynamic imports,
// re-exports). Consumers = server/ + src/ + test/ + scripts/ + telegram-bot/.
// A name is "live" only if some consumer imports it (static or dynamic).
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

const files = [
  ...walk(join(APP_ROOT, 'server'), ['.js', '.mjs']),
  ...walk(join(APP_ROOT, 'src'), ['.ts', '.tsx']),
  ...walk(join(APP_ROOT, 'test'), ['.ts', '.tsx']),
  ...walk(join(APP_ROOT, 'scripts'), ['.mjs', '.js']),
  ...walk(join(APP_ROOT, 'telegram-bot'), ['.mjs']),
];

const EXT = ['', '.js', '.ts', '.tsx', '.mjs', '/index.js'];
function resolveImport(fromFile, spec) {
  if (!spec.startsWith('.')) return null;
  let base = resolve(dirname(fromFile), spec);
  for (const ext of EXT) { const c = base + ext; if (existsSync(c) && statSync(c).isFile()) return c; }
  return null;
}

// target -> Set(imported names). '*' = namespace/default/star.
const usedNames = new Map();
function mark(target, name) {
  if (!usedNames.has(target)) usedNames.set(target, new Set());
  usedNames.get(target).add(name);
}
// file -> [{names:Set, spec}] exports of each file
const fileExports = new Map();

for (const f of files) {
  let src = ''; try { src = readFileSync(f, 'utf8'); } catch { continue; }
  const kind = /\.tsx?$/.test(f) ? ts.ScriptKind.TS : ts.ScriptKind.JS;
  const sf = ts.createSourceFile(f, src, ts.ScriptTarget.ES2022, true, kind);
  // imports
  sf.forEachChild(node => {
    if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
      const spec = node.moduleSpecifier.text;
      if (!spec.startsWith('.')) return;
      const t = resolveImport(f, spec);
      if (!t) { mark('__UNRESOLVED__', f + ' -> ' + spec); return; }
      const clause = node.importClause;
      if (!clause) { mark(t, '*'); return; } // side-effect
      if (clause.name) mark(t, '*'); // default import
      if (clause.namedBindings) {
        if (ts.isNamespaceImport(clause.namedBindings)) mark(t, '*');
        else for (const el of clause.namedBindings.elements) {
          mark(t, el.propertyName ? el.propertyName.text : el.name.text);
        }
      }
    }
    if (ts.isExportDeclaration(node) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
      const spec = node.moduleSpecifier.text;
      if (!spec.startsWith('.')) return;
      const t = resolveImport(f, spec);
      if (!t) { mark('__UNRESOLVED__', f + ' -> ' + spec); return; }
      if (!node.exportClause) mark(t, '*'); // export * from
      else if (ts.isNamedExports(node.exportClause)) for (const el of node.exportClause.elements) {
        mark(t, el.propertyName ? el.propertyName.text : el.name.text);
      }
    }
  });
  // dynamic import('...') and require('...')
  const reDyn = /(?:await\s+)?(?:import|require)\s*\(\s*['"`]([^'"`]+)['"`]\s*\)/g;
  let m;
  while ((m = reDyn.exec(src))) {
    if (!m[1].startsWith('.')) continue;
    const t = resolveImport(f, m[1]);
    if (t) mark(t, '*');
  }
  // destructure after dynamic import: const { a, b } = await import('...')
  const reDestr = /(?:const|let|var)\s*\{([^}]*)\}\s*=\s*(?:await\s+)?import\s*\(\s*['"`]([^'"`]+)['"`]\s*\)/g;
  while ((m = reDestr.exec(src))) {
    const spec = m[2];
    if (!spec.startsWith('.')) continue;
    const t = resolveImport(f, spec);
    if (!t) continue;
    for (let part of m[1].split(',')) {
      part = part.trim(); if (!part) continue;
      const orig = part.split(/\s*:\s*/)[0].split(/\s+as\s+/)[0].trim();
      if (orig) mark(t, orig);
    }
  }
  // exports
  const named = new Map(); // name -> kind
  sf.forEachChild(node => {
    if (ts.isFunctionDeclaration(node) && node.name && node.exportKeyword?.
        // eslint hack — do it robustly:
        (node.flags & ts.ModifierFlags.Export)) {}
  });
  // robust export collection
  src.replace(/export\s+(?:async\s+)?function\s+([A-Za-z_$][\w$]*)/g, (_, n) => { named.set(n, 'fn'); return _; });
  src.replace(/export\s+(?:async\s+)?class\s+([A-Za-z_$][\w$]*)/g, (_, n) => { named.set(n, 'class'); return _; });
  src.replace(/export\s+(?:const|let|var)\s+([A-Za-z_$][\w$]*)/g, (_, n) => { named.set(n, 'var'); return _; });
  src.replace(/export\s*\{([^}]*)\}/g, (full, inner) => {
    if (/from/.test(inner)) return full; // re-export handled separately
    for (let part of inner.split(',')) {
      part = part.trim(); if (!part) continue;
      const orig = part.split(/\s+as\s+/)[0].trim();
      if (orig && orig !== 'default') named.set(orig, 'list');
    }
    return full;
  });
  fileExports.set(f, named);
}

const unresolved = usedNames.get('__UNRESOLVED__');
if (unresolved) {
  console.log('### UNRESOLVED relative imports:');
  for (const u of [...unresolved].sort()) console.log('  ', u);
}

const isTestHook = (n) => /^__|ForTest[s]?$|_set[A-Z]|^_reset|^testables/.test(n);
const isServerTarget = (f) => f.startsWith(join(APP_ROOT, 'server'));
const isSrcTarget = (f) => f.startsWith(join(APP_ROOT, 'src'));

console.log('\n### GENUINELY UNUSED EXPORTS (no consumer anywhere):');
let total = 0, serverTotal = 0, srcTotal = 0;
for (const [f, named] of fileExports) {
  if (!isServerTarget(f) && !isSrcTarget(f)) continue;
  const used = usedNames.get(f);
  for (const [name, kind] of named) {
    if (used && (used.has(name) || used.has('*'))) continue;
    if (isTestHook(name)) continue;
    total++;
    if (isServerTarget(f)) serverTotal++; else srcTotal++;
    console.log(`  ${relative(APP_ROOT, f)} :: ${name} (${kind})`);
  }
}
console.log(`\nTOTAL: ${total} (server: ${serverTotal}, src: ${srcTotal})`);
