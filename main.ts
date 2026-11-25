/**
 * Token Radar — the entry program.
 *
 * Reads the sealed snapshot, ranks every rankable pre-token protocol by
 * its implied value, and writes the board, the dashboard, the screenshots
 * and the dossier. Node 22 standard library only, no network, no clock,
 * no randomness: two runs write byte-identical trees.
 *
 *   node main.ts --input <snapshot.json|dir>
 *   MAKEFUN_OUTPUT_DIR=<dir> node main.ts --input <snapshot.json|dir>
 *
 * Defaults read /input/snapshot.json and write /output, as the grader does.
 */

import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  BOARD_MIN_TVL,
  buildRow,
  computeComparables,
  isRankable,
  liveTokens,
  medianAgeDays,
  type BoardRow,
  type Snapshot,
  type SnapshotProtocol,
} from './lib/model.ts';
import { buildDossier } from './vendor/makefun-board.ts';

const TEXT_MAX_BYTES = 65536;
const SCREENSHOT_MAX = 4;
const SCREENSHOT_MAX_BYTES = 524288;
const DASHBOARD_MAX_FILES = 400;
const DASHBOARD_MAX_BYTES = 4194304;
const MIN_SCREENSHOTS = 3;
const SHOT_NAME = /^[A-Za-z0-9_][A-Za-z0-9._-]{0,127}$/;
const PNG_MAGIC = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const JPEG_MAGIC = [0xff, 0xd8, 0xff];

function fail(message: string): never {
  process.stderr.write(`token-radar: refusing to write: ${message}\n`);
  process.exit(1);
}

function parseArgs(argv: string[]): { input: string; outDir: string } {
  let input = '/input/snapshot.json';
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--input' && i + 1 < argv.length) {
      input = argv[++i]!;
    } else if (argv[i]!.startsWith('--input=')) {
      input = argv[i]!.slice('--input='.length);
    } else {
      fail(`unknown argument: ${argv[i]}`);
    }
  }
  const outDir = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';
  return { input, outDir };
}

function readSnapshot(inputPath: string): Snapshot {
  let file = inputPath;
  if (existsSync(file) && statSync(file).isDirectory()) file = join(file, 'snapshot.json');
  let text: string;
  try {
    text = readFileSync(file, 'utf8');
  } catch {
    fail(`cannot read the snapshot at ${file}`);
  }
  let snapshot: unknown;
  try {
    snapshot = JSON.parse(text!);
  } catch {
    fail(`the snapshot at ${file} is not valid JSON`);
  }
  const s = snapshot as Snapshot;
  if (!Array.isArray(s.protocols) || !Array.isArray(s.watchlist) || typeof s.as_of !== 'string') {
    fail(`the snapshot at ${file} is missing protocols, watchlist or as_of`);
  }
  return s;
}

/** The board: every rankable protocol at or above $5M TVL, most valuable first, slug as tie-break. */
function buildBoard(snapshot: Snapshot): { rows: BoardRow[]; comparablesTable: ReturnType<typeof computeComparables>['table']; globalMedian: number; globalN: number; medianAge: number } {
  const comparables = computeComparables(snapshot.protocols);
  const watchlist = new Set(snapshot.watchlist);
  const rankable = snapshot.protocols.filter((p) => isRankable(p) && p.tvl_usd >= BOARD_MIN_TVL);
  const medianAge = medianAgeDays(rankable, snapshot.as_of);
  const rows = rankable.map((p) => buildRow(p, comparables, medianAge, snapshot.as_of, watchlist.has(p.slug)));
  rows.sort((a, b) => b.implied_value_usd - a.implied_value_usd || (a.slug < b.slug ? -1 : 1));
  rows.forEach((row, i) => {
    row.rank = i + 1;
  });
  return { rows, comparablesTable: comparables.table, globalMedian: comparables.globalMedian, globalN: comparables.globalN, medianAge };
}

/** The checks the gate will run, run here first so a bad board is never written. */
function selfCheck(rows: BoardRow[], watchlist: string[], screenshotsDir: string): void {
  if (rows.length < 100) fail(`the board holds ${rows.length} rows, below the 100-row floor`);
  const covered = new Set(rows.map((r) => r.slug));
  const missing = watchlist.filter((slug) => !covered.has(slug));
  if (missing.length > 0) fail(`watchlist coverage ${watchlist.length - missing.length}/${watchlist.length}: missing ${missing.join(', ')}`);
  const ranks = new Set<number>();
  for (const row of rows) {
    if (!Number.isInteger(row.rank) || row.rank < 1 || row.rank > rows.length) fail(`row ${row.slug} has rank ${row.rank}`);
    if (ranks.has(row.rank)) fail(`rank ${row.rank} appears twice`);
    ranks.add(row.rank);
  }
  for (let i = 0; i < rows.length; i++) {
    const v = rows[i]!.implied_value_usd;
    if (!Number.isInteger(v) || v <= 0 || v > 100_000_000_000_000) fail(`row ${rows[i]!.slug} has implied value ${v}`);
    if (i > 0 && v > rows[i - 1]!.implied_value_usd) fail(`implied value rises from rank ${i} to rank ${i + 1}`);
  }
  if (new Set(rows.map((r) => r.implied_value_usd)).size < 2) fail('every row has the same implied value: this is not a ranking');
  for (const row of rows) {
    if (!Array.isArray(row.farm_steps) || row.farm_steps.length < 3 || row.farm_steps.length > 12) {
      fail(`row ${row.slug} has ${row.farm_steps.length} farm steps, outside 3–12`);
    }
    for (const step of row.farm_steps) {
      const len = step.trim().length;
      if (len < 20 || len > 600) fail(`row ${row.slug} has a farm step of ${len} characters, outside 20–600`);
    }
  }
  checkScreenshots(screenshotsDir);
}

function checkScreenshots(dir: string): void {
  let names: string[];
  try {
    names = readdirSync(dir, { withFileTypes: true })
      .filter((e) => e.isFile() && !e.name.startsWith('.'))
      .map((e) => e.name)
      .sort();
  } catch {
    fail(`no screenshots/ directory at ${dir}: capture the three dashboard views first`);
  }
  if (names!.length < MIN_SCREENSHOTS) {
    fail(`screenshots/ holds ${names!.length} images, below the ${MIN_SCREENSHOTS} required`);
  }
  if (names!.length > SCREENSHOT_MAX) fail(`screenshots/ holds ${names!.length} images, over the ${SCREENSHOT_MAX} allowed`);
  for (const name of names!) {
    if (!SHOT_NAME.test(name)) fail(`screenshot name ${name} is not letters, digits and . _ -`);
    if (!/\.(png|jpg|jpeg)$/i.test(name)) fail(`screenshot ${name} is not a PNG or JPEG`);
    const bytes = readFileSync(join(dir, name));
    const isPng = PNG_MAGIC.every((b, i) => bytes[i] === b);
    const isJpeg = JPEG_MAGIC.every((b, i) => bytes[i] === b);
    if (!isPng && !isJpeg) fail(`screenshot ${name} is not a whole PNG or JPEG`);
    if (bytes.length > SCREENSHOT_MAX_BYTES) fail(`screenshot ${name} is ${bytes.length} bytes, over the ${SCREENSHOT_MAX_BYTES} cap`);
  }
}

function main(): void {
  const { input, outDir } = parseArgs(process.argv.slice(2));
  const repoRoot = dirname(fileURLToPath(import.meta.url));
  const snapshot = readSnapshot(input);
  const { rows, comparablesTable, globalMedian, globalN, medianAge } = buildBoard(snapshot);
  const watchlistCovered = rows.filter((r) => r.watchlist).length;
  const earlyCount = rows.length - watchlistCovered;
  selfCheck(rows, snapshot.watchlist, join(repoRoot, 'screenshots'));

  const live = liveTokens(snapshot.protocols, 24);
  const radar = {
    as_of: snapshot.as_of,
    rows,
    live_tokens: live,
    comparables: { global_median: globalMedian, global_n: globalN, table: comparablesTable },
    coverage: {
      watchlist_total: snapshot.watchlist.length,
      watchlist_covered: watchlistCovered,
      early_count: earlyCount,
      board_rows: rows.length,
      median_age_days: medianAge,
    },
  };

  mkdirSync(outDir, { recursive: true });
  // Start from a clean tree so a removed dashboard file or screenshot
  // can never linger in the output of a later run.
  rmSync(join(outDir, 'dashboard'), { recursive: true, force: true });
  rmSync(join(outDir, 'screenshots'), { recursive: true, force: true });
  mkdirSync(join(outDir, 'dashboard'), { recursive: true });
  mkdirSync(join(outDir, 'screenshots'), { recursive: true });

  cpSync(join(repoRoot, 'dashboard'), join(outDir, 'dashboard'), { recursive: true });
  writeFileSync(join(outDir, 'dashboard', 'zz-data.js'), `window.RADAR=${JSON.stringify(radar)};\n`, 'utf8');
  cpSync(join(repoRoot, 'screenshots'), join(outDir, 'screenshots'), { recursive: true });
  writeFileSync(join(outDir, 'board.json'), `${JSON.stringify({ rows }, null, 2)}\n`, 'utf8');
  const dossier = buildDossier(outDir, {
    text_max_bytes: TEXT_MAX_BYTES,
    screenshots: { max: SCREENSHOT_MAX, max_bytes: SCREENSHOT_MAX_BYTES },
    dashboard: { max_files: DASHBOARD_MAX_FILES, max_bytes: DASHBOARD_MAX_BYTES },
  });
  writeFileSync(join(outDir, 'dossier.json'), dossier);

  const top = rows.slice(0, 5).map((r) => `#${r.rank} ${r.slug} ${r.implied_value_usd.toLocaleString('en-US')}`);
  process.stdout.write(
    [
      `token-radar: wrote ${outDir}`,
      `  board: ${rows.length} rows, ${watchlistCovered}/${snapshot.watchlist.length} watchlist covered, ${earlyCount} early candidates`,
      `  top 5: ${top.join(' | ')}`,
      `  dossier: ${dossier.length.toLocaleString('en-US')} bytes`,
      '',
    ].join('\n'),
  );
}

main();
