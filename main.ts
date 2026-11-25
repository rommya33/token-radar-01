// Token Radar v3 — the program (Node 22, standard library only).
//
// Reads the sealed snapshot from /input/snapshot.json (or --input
// <file|dir>), scores every pre-token protocol with the model in
// lib/model.ts, writes the ranked board to /output/board.json, and copies
// this repository's dashboard/ and screenshots/ to /output. The dashboard's
// data file dashboard/zz-data.js is generated from the same run, and
// /output/dossier.json is written with the vendored make.fun library.
//
// Outside the grader's container, MAKEFUN_OUTPUT_DIR stands in for /output:
//   mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input ../input/snapshot.json
//
// The program refuses to write anything when its own checks fail: the
// board must pass the gate, the leave-one-out interval must reproduce the
// verified P25/P75, and the 758-protocol ledger must close exactly.

import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { boardIssue, buildRadar, dataScript, parseSnapshot } from './lib/model.ts';
import { buildDossier } from './vendor/makefun-board.ts';

const here = fileURLToPath(new URL('.', import.meta.url));

/** The scorer's own caps: the text cap shapes the bytes, the rest refuse. */
const TEXT_MAX_BYTES = 65_536;
const SCREENSHOT_CAPS = { max: 4, max_bytes: 524_288 };
const IMAGE_NAME = /^[A-Za-z0-9_][A-Za-z0-9._-]{0,127}$/;

/** The ledger the runtime computation must reproduce, group by group. */
const EXPECTED_LEDGER: Record<string, number> = {
  board_rankable: 198,
  tokened_comparables_mcap_positive: 128,
  tokened_mcap_zero: 15,
  tokened_mcap_negative_sentinel: 1,
  not_strictly_pretoken_symbol_or_gecko: 272,
  excluded_version_suffix: 11,
  excluded_category: 128,
  excluded_wrapped_word: 5,
  excluded_exchange_prefix: 0,
  excluded_tvl_floor: 0,
  unexplained_not_on_board: 0,
};

/** --name <value> out of the arguments, or the fallback. */
function arg(name: string, fallback: string): string {
  const at = process.argv.indexOf(`--${name}`);
  if (at >= 0 && at + 1 < process.argv.length) return process.argv[at + 1]!;
  const withEquals = process.argv.find((a) => a.startsWith(`--${name}=`));
  return withEquals === undefined ? fallback : withEquals.slice(name.length + 3);
}

function fail(message: string): never {
  process.stderr.write(`token radar: ${message}\n`);
  process.exit(1);
}

const inputArg = arg('input', '/input');
const inputFile = inputArg.endsWith('.json') ? inputArg : join(inputArg, 'snapshot.json');
if (!existsSync(inputFile)) {
  fail(`no snapshot at ${inputFile}: pass --input <snapshot.json|directory> or mount the sealed /input`);
}
const out = arg('output', process.env.MAKEFUN_OUTPUT_DIR ?? '/output');

const snapshot = parseSnapshot(readFileSync(inputFile, 'utf8'));
const { board, radar, loo, ledger, medianAge, globalMedian } = buildRadar(snapshot);

// ---- self-checks: refuse to write a board the gate would not accept ----
const issue = boardIssue(board, snapshot);
if (issue !== null) fail(`the model wrote a board the gate refuses: ${issue}`);
if (medianAge !== 418) fail(`median age came out ${medianAge}, expected 418`);
if (Math.abs(loo.p25 - 0.28) > 0.02 || Math.abs(loo.p75 - 5.57) > 0.02) {
  fail(`leave-one-out interval came out P25=${loo.p25.toFixed(4)} P75=${loo.p75.toFixed(4)}, expected ≈0.28 / ≈5.57`);
}
const ledgerTotal = ledger.reduce((sum, g) => sum + g.count, 0);
if (ledgerTotal !== 758) fail(`ledger sums to ${ledgerTotal}, expected 758`);
for (const g of ledger) {
  if (EXPECTED_LEDGER[g.group] !== g.count) {
    fail(`ledger group ${g.group} is ${g.count}, expected ${EXPECTED_LEDGER[g.group]}`);
  }
}
const unexplained = ledger.find((g) => g.group === 'unexplained_not_on_board')!.count;
if (unexplained !== 0) fail(`ledger leaves ${unexplained} protocols unexplained`);

mkdirSync(out, { recursive: true });
writeFileSync(join(out, 'board.json'), `${JSON.stringify({ rows: board }, null, 2)}\n`);

/** Copy one directory's regular files into `to`, skipping names that start with a dot. */
function copyFiles(from: string, to: string): string[] {
  if (!existsSync(from)) return [];
  mkdirSync(to, { recursive: true });
  const copied: string[] = [];
  for (const name of readdirSync(from)) {
    if (name.startsWith('.')) continue;
    const path = join(from, name);
    if (!statSync(path).isFile()) continue;
    copyFileSync(path, join(to, name));
    copied.push(name);
  }
  return copied;
}

copyFiles(join(here, 'dashboard'), join(out, 'dashboard'));
writeFileSync(join(out, 'dashboard', 'zz-data.js'), dataScript(radar));
const shots = copyFiles(join(here, 'screenshots'), join(out, 'screenshots'));
if (shots.length < 3) {
  fail(`screenshots/ holds ${shots.length} image${shots.length === 1 ? '' : 's'}: hand in 3, the board, a detail view and a filtered view`);
}
for (const name of shots) {
  if (!IMAGE_NAME.test(name)) {
    fail(`screenshots/${name}: a name is letters, digits and . _ -, 1 to 128 characters`);
  }
}

// The dossier is written last: the scorer rebuilds it from this /output and compares bytes.
writeFileSync(
  join(out, 'dossier.json'),
  buildDossier(out, { text_max_bytes: TEXT_MAX_BYTES, screenshots: SCREENSHOT_CAPS, dashboard: { max_files: 400, max_bytes: 4_194_304 } }),
);

process.stdout.write(
  `token radar: ${snapshot.protocols.length} protocols, ${snapshot.watchlist.length} on the watchlist, ${board.length} rows scored (${radar.meta.early} early, ${radar.live.length} live set aside)\n` +
    `token radar: median age ${medianAge} days, global multiple ${globalMedian.toFixed(3)}, LOO P25 ${loo.p25.toFixed(3)} P75 ${loo.p75.toFixed(3)} (covers ${(loo.coverage_p25_p75 * 100).toFixed(1)}%), ledger ${ledgerTotal} with ${unexplained} unexplained\n` +
    `token radar: wrote ${join(out, 'board.json')}, ${join(out, 'dashboard')} (4 files), ${join(out, 'screenshots')} (${shots.length} images) and ${join(out, 'dossier.json')}\n`,
);
