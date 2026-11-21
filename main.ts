// Build entrypoint for Night City — Rain Run (Node 22, standard library only).
//
// The game itself is plain static files under game/: index.html plus ES modules in
// game/src/ that a desktop browser loads offline, with no library and no network.
// This script is the gate between that source tree and the grader's /output:
//
//   1. preflight  — verify the source tree is coherent before copying a byte:
//                   index.html exists, and every game/src/*.js module is imported
//                   by something (index.html or another module). Orphans fail.
//   2. copy       — mirror game/ into <out>/game and screenshots/ into
//                   <out>/screenshots, then report what moved.
//   3. report     — per-file byte and line counts for the copied game tree.
//   4. dossier    — build the judge-facing dossier.json with the vendored
//                   make.fun builder, then fold the build stats into it.
//
// Every step throws on failure; main() catches, prints one readable line to
// stderr and exits non-zero, so a broken build never looks like a good one.
//
// Outside the grader's container MAKEFUN_OUTPUT_DIR stands in for /output:
//   MAKEFUN_OUTPUT_DIR=out node main.ts
//
// Serve the result locally with `node serve.ts`, then open http://localhost:8080.

import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildDossier } from './vendor/makefun-game.ts';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';

const GAME_DIR = join(HERE, 'game');
const SRC_DIR = join(GAME_DIR, 'src');
const SHOTS_DIR = join(HERE, 'screenshots');
const OUT_GAME = join(OUT_DIR, 'game');
const OUT_SHOTS = join(OUT_DIR, 'screenshots');
const DOSSIER = join(OUT_DIR, 'dossier.json');

// The scorer's caps (reference/gate.json). text_max_bytes is the one that shapes
// the dossier's bytes; the rest make the builder refuse an entry the scorer would.
const CAPS = {
  text_max_bytes: 163840,
  screenshots: { max: 4, max_bytes: 262144 },
  game_max_files: 993,
  game_max_bytes: 50331648,
  game_path_max_bytes: 1000,
} as const;

class BuildError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BuildError';
  }
}

/** Throw a BuildError; typed never so callers can narrow after calling it. */
function fail(message: string): never {
  throw new BuildError(message);
}

function humanBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KiB`;
  return `${(n / (1024 * 1024)).toFixed(2)} MiB`;
}

function countLines(file: string): number {
  const body = readFileSync(file, 'utf8');
  if (body.length === 0) return 0;
  let lines = 1;
  for (let i = 0; i < body.length; i++) if (body.charCodeAt(i) === 10) lines++;
  // A trailing newline terminates the last line rather than opening a new one.
  return body.charCodeAt(body.length - 1) === 10 ? lines - 1 : lines;
}

/** Every regular file below dir, as paths relative to it, in a stable order. */
function walk(dir: string, prefix = ''): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))) {
    const rel = prefix === '' ? entry.name : `${prefix}/${entry.name}`;
    if (entry.isDirectory()) found.push(...walk(join(dir, entry.name), rel));
    else if (entry.isFile()) found.push(rel);
  }
  return found;
}

/** Module specifiers a file pulls in: static imports, re-exports and dynamic import(). */
function importsOf(file: string): string[] {
  const body = readFileSync(file, 'utf8');
  const specifiers: string[] = [];
  const patterns = [
    /\bfrom\s*['"]([^'"]+)['"]/g,          // import ... from '...' / export ... from '...'
    /\bimport\s*\(\s*['"]([^'"]+)['"]/g,    // import('...')
  ];
  for (const re of patterns) {
    for (let m = re.exec(body); m !== null; m = re.exec(body)) specifiers.push(m[1]);
  }
  return specifiers;
}

/** src="..." of every <script> in index.html, which is how the browser enters the graph. */
function htmlScripts(file: string): string[] {
  const body = readFileSync(file, 'utf8');
  const specifiers: string[] = [];
  const re = /<script\b[^>]*\bsrc\s*=\s*['"]([^'"]+)['"]/gi;
  for (let m = re.exec(body); m !== null; m = re.exec(body)) specifiers.push(m[1]);
  return specifiers;
}

/** Resolve a relative specifier against the file that mentions it; null if it escapes game/. */
function resolveSpecifier(fromFile: string, specifier: string): string | null {
  if (!specifier.startsWith('.')) return null; // bare or URL import: not a local file
  const target = resolve(dirname(fromFile), specifier.split('?')[0].split('#')[0]);
  const rel = relative(GAME_DIR, target);
  if (rel === '' || rel.startsWith('..') || rel.split(sep).includes('..')) return null;
  return rel.split(sep).join('/');
}

/**
 * The build's timestamp, and the only clock reading in the build.
 *
 * A build must be a pure function of the repository's own files: two runs over the same
 * tree have to write the same bytes. So there is no `new Date()` here. The value comes
 * from SOURCE_DATE_EPOCH (the reproducible-builds convention, whole seconds since the
 * Unix epoch) when it holds a plain integer, and is otherwise the fixed epoch literal, so
 * an absent or malformed variable leaves the bytes constant rather than varying per run.
 */
const FALLBACK_TIMESTAMP = '1970-01-01T00:00:00.000Z';

function buildTimestamp(): string {
  const raw = process.env.SOURCE_DATE_EPOCH?.trim();
  if (raw === undefined || !/^\d+$/.test(raw)) return FALLBACK_TIMESTAMP;
  const date = new Date(Number(raw) * 1000);
  return Number.isNaN(date.getTime()) ? FALLBACK_TIMESTAMP : date.toISOString();
}

/**
 * The output directory as a run-independent label, for the dossier's build block.
 *
 * The absolute path differs whenever the output directory differs, so it cannot be
 * written: the grader builds twice into different directories and diffs the results. The
 * label is instead the path relative to this repository (the layout's own name, `out`,
 * when the build writes inside the tree), and a fixed marker when the directory lies
 * outside the repository, where no stable name exists.
 */
function outputLabel(outDir: string): string {
  const rel = relative(HERE, resolve(outDir)).split(sep).join('/');
  if (rel === '') return '.';
  if (rel === '..' || rel.startsWith('../')) return '(outside the repository)';
  return rel;
}

interface Preflight {
  modules: string[];
  entries: string[];
}

/**
 * Preflight: the tree must be self-consistent before it is copied.
 * Every game/src/*.js must be reachable from index.html's entry module.
 */
function preflight(): Preflight {
  if (!existsSync(GAME_DIR)) fail(`preflight: ${GAME_DIR} does not exist`);
  if (!existsSync(join(GAME_DIR, 'index.html'))) fail('preflight: game/index.html is missing');
  if (!existsSync(SRC_DIR)) fail('preflight: game/src/ is missing');

  const modules = readdirSync(SRC_DIR)
    .filter((name) => name.endsWith('.js'))
    .sort();
  if (modules.length === 0) fail('preflight: game/src/ holds no .js modules');

  const html = join(GAME_DIR, 'index.html');
  const entries = htmlScripts(html)
    .map((s) => resolveSpecifier(html, s))
    .filter((p): p is string => p !== null);
  if (entries.length === 0) fail('preflight: game/index.html loads no local module');

  // Walk the import graph from the HTML's entry points, collecting what is reached.
  const reached = new Set<string>(entries);
  const queue = [...entries];
  while (queue.length > 0) {
    const rel = queue.pop() as string;
    const file = join(GAME_DIR, rel);
    if (!existsSync(file)) fail(`preflight: ${rel} is imported but does not exist`);
    for (const specifier of importsOf(file)) {
      const target = resolveSpecifier(file, specifier);
      if (target === null || reached.has(target)) continue;
      reached.add(target);
      queue.push(target);
    }
  }

  const orphans = modules
    .map((name) => `src/${name}`)
    .filter((rel) => !reached.has(rel));
  if (orphans.length > 0) {
    const list = orphans.map((p) => `  - game/${p}`).join('\n');
    fail(`preflight: ${orphans.length} orphan module(s) never imported:\n${list}\nEvery game/src/*.js must be reachable from game/index.html.`);
  }

  console.log(`preflight  ok  ${modules.length} modules, ${reached.size} files reachable from index.html`);
  return { modules: modules.map((n) => `src/${n}`), entries };
}

interface CopyReport {
  files: number;
  bytes: number;
}

/** Mirror a source tree into the output tree, returning what was written. */
function copyTree(from: string, to: string, label: string): CopyReport {
  if (!existsSync(from)) fail(`copy: ${label} source ${from} is missing`);
  mkdirSync(to, { recursive: true });
  cpSync(from, to, { recursive: true });

  let files = 0;
  let bytes = 0;
  for (const rel of walk(to)) {
    files++;
    bytes += statSync(join(to, rel)).size;
  }
  if (files === 0) fail(`copy: ${label} produced no files in ${to}`);
  console.log(`copy       ok  ${label.padEnd(12)} ${String(files).padStart(3)} files  ${humanBytes(bytes).padStart(9)}`);
  return { files, bytes };
}

interface FileStat {
  path: string;
  bytes: number;
  lines: number | null;
}

/** Size (and, for text, line count) of every file in the copied game tree. */
function measureGame(): FileStat[] {
  const rows: FileStat[] = [];
  for (const rel of walk(OUT_GAME)) {
    const file = join(OUT_GAME, rel);
    const bytes = statSync(file).size;
    const textual = /\.(?:js|html|css|json|svg|txt|md)$/i.test(rel);
    rows.push({ path: rel, bytes, lines: textual ? countLines(file) : null });
  }
  rows.sort((a, b) => b.bytes - a.bytes || (a.path < b.path ? -1 : 1));
  return rows;
}

function printReport(rows: FileStat[]): void {
  const totalBytes = rows.reduce((sum, r) => sum + r.bytes, 0);
  const totalLines = rows.reduce((sum, r) => sum + (r.lines ?? 0), 0);
  const width = Math.max(4, ...rows.map((r) => r.path.length));

  console.log('');
  console.log(`report     ${rows.length} files in out/game, ${humanBytes(totalBytes)}, ${totalLines} text lines`);
  console.log(`           ${'file'.padEnd(width)}  ${'bytes'.padStart(10)}  ${'lines'.padStart(6)}`);
  for (const row of rows) {
    const lines = row.lines === null ? 'binary' : String(row.lines);
    console.log(`           ${row.path.padEnd(width)}  ${humanBytes(row.bytes).padStart(10)}  ${lines.padStart(6)}`);
  }
}

interface BuildStats {
  files: number;
  bytes: number;
  lines: number;
  modules: number;
  node: string;
  builtAt: string;
  outputDir: string;
}

function writeDossier(game: CopyReport, rows: FileStat[], pre: Preflight): number {
  const stats: BuildStats = {
    files: game.files,
    bytes: game.bytes,
    lines: rows.reduce((sum, r) => sum + (r.lines ?? 0), 0),
    modules: pre.modules.length,
    node: process.version,
    builtAt: buildTimestamp(),
    outputDir: outputLabel(OUT_DIR),
  };

  // buildDossier reads the copied tree and returns canonical JSON bytes. Parse it,
  // add the build block beside the fields the judge already reads, and re-emit.
  const base = JSON.parse(Buffer.from(buildDossier(OUT_DIR, CAPS)).toString('utf8')) as Record<string, unknown>;
  const doc = { ...base, build: stats };
  const bytes = Buffer.from(JSON.stringify(doc, null, 2) + '\n', 'utf8');

  if (bytes.length > 4 * 1024 * 1024) fail(`dossier: ${bytes.length} bytes exceeds the 4 MiB cap`);
  writeFileSync(DOSSIER, bytes);
  console.log(`dossier    ok  out/dossier.json  ${humanBytes(bytes.length)}  node ${stats.node}`);
  return bytes.length;
}

function build(): void {
  console.log(`build      out=${OUT_DIR}`);

  const pre = preflight();
  mkdirSync(OUT_DIR, { recursive: true });

  const game = copyTree(GAME_DIR, OUT_GAME, 'game/');
  if (existsSync(SHOTS_DIR)) copyTree(SHOTS_DIR, OUT_SHOTS, 'screenshots/');
  else console.log('copy       ok  screenshots/ (none)');

  const rows = measureGame();
  if (rows.length === 0) fail('report: out/game is empty after the copy');
  printReport(rows);
  writeDossier(game, rows, pre);

  console.log(`build      done`);
}

try {
  build();
} catch (err) {
  const message = err instanceof Error ? err.message : String(err);
  console.error(`build      FAILED: ${message}`);
  process.exitCode = 1;
}
