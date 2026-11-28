// Token Radar v5 — entrypoint.
//
// Reads the sealed snapshot, fits the value model from it, scores the board,
// and writes the dashboard + dossier. Node 22 stdlib only.
//
//   MAKEFUN_OUTPUT_DIR=out node main.ts --input ../input/snapshot.json
//
// The value model is a one-term fitted regression: log(market cap) on
// log(TVL), fitted by OLS on the 128 tokened protocols with a positive
// market cap. See lib/model.ts for the validation: the fitted slope (0.52)
// beats the v3 category-median model in leave-one-out testing by a wide
// margin (median |log error| 1.22 vs 1.63, 32% vs 19% within 2x).
import { readFileSync, writeFileSync, mkdirSync, cpSync, readdirSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { buildRadar, type Snapshot } from "./lib/model.ts";
import { buildDossier } from "./vendor/makefun-board.ts";

const ROOT = dirname(fileURLToPath(import.meta.url));

function arg(name: string): string | undefined {
  const at = process.argv.indexOf(`--${name}`);
  if (at >= 0 && at + 1 < process.argv.length) return process.argv[at + 1];
  const withEquals = process.argv.find((a) => a.startsWith(`--${name}=`));
  return withEquals ? withEquals.slice(name.length + 3) : undefined;
}

const inputArg = arg("input") ?? "/input/snapshot.json";
const inputFile = inputArg.endsWith(".json") ? inputArg : join(inputArg, "snapshot.json");
const out = arg("output") ?? process.env.MAKEFUN_OUTPUT_DIR ?? "/output";

if (!existsSync(inputFile)) {
  process.stderr.write(
    `token radar: no snapshot at ${inputFile}: pass --input <snapshot.json|directory> or mount the sealed /input\n`,
  );
  process.exit(1);
}

const snapshot = JSON.parse(readFileSync(inputFile, "utf8")) as Snapshot;
const radar = buildRadar(snapshot);
const rows = radar.rows;

// --- self-checks: refuse to write a bad board ---
const fail = (msg: string): never => {
  process.stderr.write(`token radar: refusing to write: ${msg}\n`);
  process.exit(1);
};
const watchlist = new Set(snapshot.watchlist);
const covered = rows.filter((r) => r.watchlist).length;
if (covered !== watchlist.size) fail(`watchlist coverage ${covered}/${watchlist.size}`);
if (rows.length < 100 || rows.length > 4000) fail(`board has ${rows.length} rows, need 100-4000`);
const ranks = new Set(rows.map((r) => r.rank));
if (ranks.size !== rows.length || Math.min(...ranks) !== 1 || Math.max(...ranks) !== rows.length) {
  fail("ranks are not 1..N unique");
}
for (let i = 0; i < rows.length; i++) {
  const v = rows[i]!.implied_value_usd;
  if (!Number.isInteger(v) || v <= 0 || v > 1e14) fail(`row ${i} has a bad implied value ${v}`);
  if (i > 0 && v > rows[i - 1]!.implied_value_usd) fail("implied values are not non-increasing by rank");
  if (rows[i]!.farm_steps.length < 3 || rows[i]!.farm_steps.length > 12) fail(`row ${i} has ${rows[i]!.farm_steps.length} farm steps`);
  for (const s of rows[i]!.farm_steps) if (s.length < 20 || s.length > 600) fail(`row ${i} has a farm step of ${s.length} chars`);
}
if (new Set(rows.map((r) => r.implied_value_usd)).size < 2) fail("fewer than 2 distinct implied values");
const ledgerTotal = radar.ledger.reduce((s, b) => s + b.count, 0);
if (ledgerTotal !== snapshot.protocols.length) {
  fail(`ledger accounts for ${ledgerTotal} of ${snapshot.protocols.length} protocols`);
}
const shots = readdirSync(join(ROOT, "screenshots")).filter((f) => /\.(jpe?g|png)$/i.test(f));
if (shots.length < 3) fail(`only ${shots.length} screenshots, need at least 3`);

// --- write the outputs ---
mkdirSync(join(out, "dashboard"), { recursive: true });
mkdirSync(join(out, "screenshots"), { recursive: true });
writeFileSync(join(out, "board.json"), JSON.stringify({ rows }, null, 2) + "\n");
for (const f of ["index.html", "app.css", "app.js"]) {
  cpSync(join(ROOT, "dashboard", f), join(out, "dashboard", f));
}
writeFileSync(join(out, "dashboard", "zz-data.js"), "window.RADAR=" + JSON.stringify(radar) + ";\n");
for (const f of shots) cpSync(join(ROOT, "screenshots", f), join(out, "screenshots", f));
const dossier = buildDossier(out, {
  text_max_bytes: 65536,
  screenshots: { max: 4, max_bytes: 524288 },
  dashboard: { max_files: 400, max_bytes: 4194304 },
});
if (Buffer.byteLength(dossier, "utf8") > 1_500_000) {
  fail(`dossier is ${Buffer.byteLength(dossier, "utf8")} bytes, over the 1.5 MB cap`);
}
writeFileSync(join(out, "dossier.json"), dossier);

process.stderr.write(
  `token radar: ${snapshot.protocols.length} protocols, ${snapshot.watchlist.length} on the watchlist, ` +
    `${rows.length} rows scored (${rows.filter((r) => r.watchlist).length} watchlist, ` +
    `${rows.length - rows.filter((r) => r.watchlist).length} early)\n` +
    `token radar: fitted log(mcap) = ${radar.fit.intercept.toFixed(3)} + ${radar.fit.slope.toFixed(3)} * log(TVL) ` +
    `(n=${radar.fit.n}); LOO med|log err| ${radar.loo.medAbsLog.toFixed(3)}, within 2x ${(radar.loo.in2 * 100).toFixed(1)}%\n` +
    `token radar: dossier ${Buffer.byteLength(dossier, "utf8")} bytes\n`,
);
