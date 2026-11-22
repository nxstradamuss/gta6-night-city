// Night City final pass: crowd streaming, dashboard radar and wet asphalt.
// Build entrypoint for Night City — Rain Run (Node 22, standard library only).
//
// The game itself is plain static files under game/: index.html plus ES modules in
// game/src/ that a desktop browser loads offline, with no library and no network.
// This script is the gate between that source tree and the grader's /output:
//
//   1. output     — accept any output directory that would not copy a source tree
//                   into itself: never the repository root, never inside game/,
//                   screenshots/, vendor/ or .git/. A directory outside the
//                   repository is fine — the grader's /output, or any
//                   MAKEFUN_OUTPUT_DIR such as /tmp/v17out. A writability probe
//                   falls back to /output when the chosen directory cannot be made.
//   2. preflight  — verify the source tree is coherent before copying a byte:
//                   index.html exists, every script it loads exists, every import
//                   resolves to a file under game/, and every game/src/*.js module
//                   (at any depth) is reachable from index.html. An orphan fails
//                   with the offending file named.
//   3. copy       — mirror game/ into <out>/game and screenshots/ into
//                   <out>/screenshots, removing the previous copies first so a
//                   deleted source file cannot survive as a stale output file.
//   4. report     — per-file byte and line counts for the copied game tree.
//   5. dossier    — write the judge-facing dossier.json as exactly the bytes the
//                   vendored make.fun builder returns for <out>; the build stats
//                   (files, bytes, lines, modules, node) go to the log instead.
//   6. bundle     — the dossier's text in bytes against the 163840-byte cap, with
//                   the headroom the build still has.
//
// Every step throws on failure; main() catches, prints one readable line to
// stderr and exits non-zero, so a broken build never looks like a good one.
//
// Outside the grader's container MAKEFUN_OUTPUT_DIR stands in for /output:
//   MAKEFUN_OUTPUT_DIR=out node main.ts
//
// Serve the result locally with `node serve.ts`, then open http://localhost:8080.

import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildDossier } from './vendor/makefun-game.ts';

const HERE = dirname(fileURLToPath(import.meta.url));
// The grader sets nothing and mounts a writable /output; outside it MAKEFUN_OUTPUT_DIR
// names any directory of our own, inside or outside the repository, as long as it is
// not one of the source trees the build copies from.
const OUT_ENV = process.env.MAKEFUN_OUTPUT_DIR;
const OUT_DIR = OUT_ENV ?? '/output';
const PLATFORM_OUT = '/output';
let OUT_ROOT = resolve(OUT_DIR);

const GAME_DIR = join(HERE, 'game');
const SRC_DIR = join(GAME_DIR, 'src');
const SHOTS_DIR = join(HERE, 'screenshots');
const VENDOR_DIR = join(HERE, 'vendor');
const GIT_DIR = join(HERE, '.git');
let OUT_GAME = join(OUT_ROOT, 'game');
let OUT_SHOTS = join(OUT_ROOT, 'screenshots');
let DOSSIER = join(OUT_ROOT, 'dossier.json');

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

/** Whether child is strictly below parent, by resolved path rather than by string prefix. */
function isBelow(parent: string, child: string): boolean {
  const rel = relative(parent, child);
  return rel !== '' && !rel.startsWith('..') && !rel.startsWith(sep);
}

/**
 * The output directory must not be one of the trees this build copies from: writing
 * game/ into game/ (or into screenshots/, vendor/ or .git/) would copy a source tree
 * into itself. The repository root is refused for the same reason. Any other path is
 * accepted, including one outside the repository such as the grader's /output or a
 * MAKEFUN_OUTPUT_DIR like /tmp/v17out.
 */
function validateOutputDir(): void {
  if (OUT_ENV === undefined) {
    if (OUT_ROOT !== PLATFORM_OUT) fail(`output: no MAKEFUN_OUTPUT_DIR and ${OUT_DIR} is not ${PLATFORM_OUT}`);
    return;
  }
  if (OUT_ROOT === HERE) {
    fail(`output: MAKEFUN_OUTPUT_DIR=${OUT_DIR} is the repository root ${HERE}: the build would copy game/ into its own source tree; point it at a subdirectory such as out or a directory outside the repository`);
  }
  for (const [label, dir] of [['game/', GAME_DIR], ['screenshots/', SHOTS_DIR], ['vendor/', VENDOR_DIR], ['.git/', GIT_DIR]] as const) {
    if (OUT_ROOT === dir || isBelow(dir, OUT_ROOT)) {
      fail(`output: MAKEFUN_OUTPUT_DIR=${OUT_DIR} resolves to ${OUT_ROOT}, inside ${label}; the build would write its output into the source tree it copies from`);
    }
  }
}

/**
 * Make the output directory, falling back to the platform's /output when the chosen
 * one cannot be created for lack of permission. Any other failure, or a failure at
 * /output itself, propagates: the build must not silently write nowhere.
 */
function probeOutputDir(): void {
  try {
    mkdirSync(OUT_ROOT, { recursive: true });
  } catch (err) {
    const code = (err as { code?: string }).code;
    if ((code === 'EACCES' || code === 'EROFS' || code === 'EPERM') && OUT_ROOT !== PLATFORM_OUT) {
      console.warn(`output     warn  cannot create ${OUT_ROOT} (${code}); falling back to ${PLATFORM_OUT}`);
      OUT_ROOT = PLATFORM_OUT;
      OUT_GAME = join(OUT_ROOT, 'game');
      OUT_SHOTS = join(OUT_ROOT, 'screenshots');
      DOSSIER = join(OUT_ROOT, 'dossier.json');
      mkdirSync(OUT_ROOT, { recursive: true });
      return;
    }
    throw err;
  }
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

interface Preflight {
  modules: string[];
  entries: string[];
}

/** Every .js module under game/src/, at any depth, as paths relative to game/. */
function gameModules(): string[] {
  if (!existsSync(SRC_DIR)) fail('preflight: game/src/ is missing');
  const modules = walk(SRC_DIR)
    .filter((rel) => rel.endsWith('.js'))
    .map((rel) => `src/${rel}`)
    .sort();
  if (modules.length === 0) fail('preflight: game/src/ holds no .js modules');
  return modules;
}

/**
 * Preflight: the tree must be self-consistent before it is copied.
 * Every game/src/*.js must be reachable from index.html's entry module.
 */
function preflight(): Preflight {
  if (!existsSync(GAME_DIR)) fail(`preflight: ${GAME_DIR} does not exist`);
  const html = join(GAME_DIR, 'index.html');
  if (!existsSync(html)) fail('preflight: game/index.html is missing');

  const modules = gameModules();

  // index.html's own scripts: each local one has to name a file that is there.
  const entries: string[] = [];
  for (const src of htmlScripts(html)) {
    const target = resolveSpecifier(html, src);
    if (target === null) continue;
    if (!existsSync(join(GAME_DIR, target))) {
      fail(`preflight: game/index.html loads ${src}, but game/${target} does not exist`);
    }
    entries.push(target);
  }
  if (entries.length === 0) fail('preflight: game/index.html loads no local module');

  // Walk the import graph from the HTML's entry points, collecting what is reached.
  // A specifier that points at a file nobody wrote is a build error, named both ways.
  const reached = new Set<string>(entries);
  const queue = [...entries];
  while (queue.length > 0) {
    const rel = queue.pop() as string;
    const file = join(GAME_DIR, rel);
    for (const specifier of importsOf(file)) {
      const target = resolveSpecifier(file, specifier);
      if (target === null) continue;
      if (!existsSync(join(GAME_DIR, target))) {
        fail(`preflight: game/${rel} imports '${specifier}', but game/${target} does not exist`);
      }
      if (reached.has(target)) continue;
      reached.add(target);
      queue.push(target);
    }
  }

  // An orphan is dead code the browser will never load; name it, don't count it.
  const orphans = modules.filter((rel) => !reached.has(rel));
  if (orphans.length > 0) {
    const list = orphans.map((p) => `game/${p}`);
    const headline = list.length === 1
      ? `${list[0]} is not reachable from game/index.html: no module imports it`
      : `${list.length} modules are not reachable from game/index.html:\n${list.map((p) => `  - ${p}`).join('\n')}`;
    fail(`preflight: ${headline}\n  every game/src/*.js must be imported, directly or through another module, from the entry module game/${entries[0]}`);
  }

  console.log(`preflight  ok  ${modules.length} modules, ${reached.size} files reachable from index.html`);
  return { modules, entries };
}

interface CopyReport {
  files: number;
  bytes: number;
}

/** Mirror a source tree into the output tree, returning what was written. */
function copyTree(from: string, to: string, label: string): CopyReport {
  if (!existsSync(from)) fail(`copy: ${label} source ${from} is missing`);
  // Drop the previous copy: cpSync merges, so a file deleted from game/ would
  // otherwise linger in out/ and be measured and dossed as if it were still source.
  rmSync(to, { recursive: true, force: true });
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

/** The dossier's text, read back from the builder's bytes without touching them. */
function dossierText(bytes: Uint8Array): string {
  let doc: unknown;
  try {
    doc = JSON.parse(Buffer.from(bytes).toString('utf8'));
  } catch (err) {
    fail(`dossier: the builder's bytes are not JSON (${(err as Error).message})`);
  }
  const text = (doc as { text?: unknown }).text;
  if (typeof text !== 'string') fail('dossier: the builder returned no text field');
  return text;
}

function writeDossier(game: CopyReport, rows: FileStat[], pre: Preflight): number {
  // The dossier is buildDossier's own bytes, written untouched: the gate compares
  // out/dossier.json against a fresh buildDossier() call over the same directory.
  // So no parse, no re-serialise, no added fields — those would change the bytes.
  const bytes = buildDossier(OUT_ROOT, CAPS);

  if (bytes.length > 4 * 1024 * 1024) fail(`dossier: ${bytes.length} bytes exceeds the 4 MiB cap`);

  // The scorer caps the dossier's text, not its JSON envelope, so measure the text.
  const cap = CAPS.text_max_bytes;
  const used = Buffer.byteLength(dossierText(bytes), 'utf8');
  const headroom = cap - used;
  if (headroom < 0) {
    fail(`bundle: the dossier's text is ${used} bytes, ${-headroom} over the ${cap}-byte cap (text_max_bytes); trim the game's source or comments`);
  }

  writeFileSync(DOSSIER, bytes);
  console.log(`dossier    ok  out/dossier.json  ${humanBytes(bytes.length)}`);
  console.log(`bundle     ok  ${used} / ${cap} bytes  ${headroom} bytes headroom`);

  // The build statistics live here, in the log, and nowhere in the dossier.
  const lines = rows.reduce((sum, r) => sum + (r.lines ?? 0), 0);
  console.log(`summary    ok  ${game.files} files  ${humanBytes(game.bytes)}  ${lines} text lines`);
  console.log(`summary    ok  ${pre.modules.length} modules  node ${process.version}`);
  return bytes.length;
}

function build(): void {
  console.log(`build      out=${OUT_DIR}`);

  validateOutputDir();
  probeOutputDir();
  const pre = preflight();
  mkdirSync(OUT_ROOT, { recursive: true });

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
