// Pre-Token Radar v4: read the sealed snapshot, rank every pre-token
// protocol by what its launch would be worth, and write the board, the
// static dashboard, the screenshots and the dossier.
//
//   node main.ts [--input <snapshot file or dir>]
//   MAKEFUN_INPUT_DIR / MAKEFUN_OUTPUT_DIR override the defaults.
//
// The program is deterministic: no clock, no randomness, no network.
// Two runs write byte-identical trees. It refuses to write anything
// when a self-check fails, and says why on stderr.
//
// Model (lib/model.ts): implied = TVL x comparable multiple x momentum
// x maturity. The multiple is the median market-cap-over-TVL of the
// tokened protocols in the same category (at least 3 comparables, else
// the global median). Every figure on the page is computed from the
// snapshot at runtime, including the leave-one-out validation in the
// Methodology: the model was kept because no tested variant beat it.

import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  copyFileSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { buildDossier } from "./vendor/makefun-board.ts";
import {
  ageDays,
  buildFarmPlan,
  buildLedger,
  clamp,
  computeComparables,
  impliedValue,
  isRankable,
  looResiduals,
  maturityFactor,
  median,
  momentumFactor,
  multipleFor,
  summarizeResiduals,
  verdictFor,
  verdictReason,
} from "./lib/model.ts";

const ROOT = dirname(fileURLToPath(import.meta.url));
const TEXT_MAX_BYTES = 65536;
const DOSSIER_MAX_BYTES = 1_500_000;

function fail(message) {
  console.error(`Pre-Token Radar v4: ${message}`);
  process.exit(1);
}

function parseArgs(argv) {
  const out = { input: null, output: null };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--input" && i + 1 < argv.length) out.input = argv[++i];
    else if (argv[i] === "--output" && i + 1 < argv.length)
      out.output = argv[++i];
    else if (argv[i].startsWith("--input=")) out.input = argv[i].slice(8);
    else if (argv[i].startsWith("--output=")) out.output = argv[i].slice(9);
  }
  return out;
}

function readSnapshot(inputArg) {
  const candidates = [];
  if (inputArg) candidates.push(inputArg);
  if (process.env.MAKEFUN_INPUT_DIR)
    candidates.push(process.env.MAKEFUN_INPUT_DIR);
  candidates.push("/input");
  for (const base of candidates) {
    const asFile = base.endsWith(".json") ? base : join(base, "snapshot.json");
    if (existsSync(asFile)) {
      return JSON.parse(readFileSync(asFile, "utf8"));
    }
  }
  fail(`snapshot.json not found (tried ${candidates.join(", ")})`);
}

function money(n) {
  return "$" + Math.round(n).toLocaleString("en-US");
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const outDir =
    args.output || process.env.MAKEFUN_OUTPUT_DIR || "/output";
  const snapshot = readSnapshot(args.input);
  const asOf = new Date(snapshot.as_of + "T00:00:00Z");
  const watchlist = new Set(snapshot.watchlist);

  // The comparables pool: tokened protocols with a positive market cap.
  const pool = snapshot.protocols.filter((p) => p.mcap_usd > 0);
  const comparables = computeComparables(pool);

  // The board: every rankable protocol at or above the $5M floor.
  const board = snapshot.protocols.filter(isRankable);

  // The median age of the board population with a known listing date.
  // Protocols whose listing date is not reported use this age.
  const knownAges = board
    .map((p) => ageDays(p.listed_at, asOf))
    .filter((a) => a !== null);
  const medianAge = median(knownAges);

  // Leave-one-out validation of the model, on the tokened pool. The
  // base model and seven variants, so the Methodology can state which
  // model was kept and why: no variant beats the base by more than noise.
  const variants = [
    { name: "Base model (category median, momentum 0.5, maturity on)", opts: {} },
    { name: "Shrinkage k=3 toward the global median", opts: { shrinkK: 3 } },
    { name: "Shrinkage k=5 toward the global median", opts: { shrinkK: 5 } },
    { name: "Shrinkage k=10 toward the global median", opts: { shrinkK: 10 } },
    { name: "No momentum factor", opts: { momSlope: 0 } },
    { name: "Momentum slope 1.0", opts: { momSlope: 1.0 } },
    { name: "No maturity factor", opts: { matOff: true } },
    { name: "Shrinkage k=3 with momentum slope 1.0", opts: { shrinkK: 3, momSlope: 1.0 } },
  ];
  const looBase = summarizeResiduals(
    looResiduals(pool, comparables, medianAge, asOf, {}),
  );
  const looVariants = variants.map((v) => {
    const s = summarizeResiduals(
      looResiduals(pool, comparables, medianAge, asOf, v.opts),
    );
    return {
      name: v.name,
      medianAbsLogResidual: s.medianAbsLogResidual,
      within2x: s.within2x,
    };
  });

  // The honest interval: the middle half of the leave-one-out residuals.
  // A new protocol's real market cap lands inside [implied x p25,
  // implied x p75] half the time, by the model's own record.
  const p25 = looBase.p25;
  const p75 = looBase.p75;

  const rows = board
    .map((p) => {
      const age = ageDays(p.listed_at, asOf);
      const ageUsed = age === null ? medianAge : age;
      const mult = multipleFor(p.category, comparables);
      const mom = momentumFactor(p.change_7d);
      const mat = maturityFactor(age, medianAge);
      const implied = impliedValue(p, comparables, medianAge, asOf);
      const plan = buildFarmPlan(p, ageUsed);
      const globalImplied = clamp(
        Math.round(
          p.tvl_usd * comparables.globalMedian * mom * mat,
        ),
        1_000_000,
        100_000_000_000_000,
      );
      return {
        slug: p.slug,
        name: p.name,
        rank: 0,
        implied_value_usd: implied,
        tvl_usd: p.tvl_usd,
        category: p.category,
        chains: p.chains,
        change_7d: p.change_7d,
        listed_at: p.listed_at,
        age_days: ageUsed,
        age_source:
          age === null
            ? "listed_at not reported — median age used"
            : `listed ${p.listed_at}`,
        multiple: +mult.multiple.toFixed(4),
        multiple_n: mult.n,
        multiple_source: mult.source,
        momentum_factor: +mom.toFixed(3),
        maturity_factor: +mat.toFixed(3),
        verdict: verdictFor(implied, mom, ageUsed),
        verdict_reason: verdictReason(p, implied, mom, ageUsed),
        watchlist: watchlist.has(p.slug),
        farm_steps: plan.steps,
        interval_lo: Math.round(implied * p25),
        interval_hi: Math.round(implied * p75),
        plan_total: plan.totals,
        why_now: plan.whyNow,
        global_counterfactual_usd: globalImplied,
      };
    })
    .sort((a, b) => {
      if (b.implied_value_usd !== a.implied_value_usd)
        return b.implied_value_usd - a.implied_value_usd;
      return a.slug < b.slug ? -1 : 1;
    });
  rows.forEach((r, i) => (r.rank = i + 1));

  // The live-token view: the top 24 tokened protocols by market cap, the
  // market's own values only. Tokened protocols were used as comparables
  // and are never ranked as launch candidates.
  const liveTokens = [...pool]
    .sort((a, b) => b.mcap_usd - a.mcap_usd)
    .slice(0, 24)
    .map((p) => ({
      slug: p.slug,
      name: p.name,
      category: p.category,
      mcap_usd: p.mcap_usd,
      tvl_usd: p.tvl_usd,
      ratio: +(p.mcap_usd / p.tvl_usd).toFixed(3),
      change_7d: p.change_7d,
    }));

  const ledger = buildLedger(snapshot);

  // ---- self-checks: refuse with a clear message instead of writing ----
  const covered = rows.filter((r) => r.watchlist).length;
  if (covered !== snapshot.watchlist.length)
    fail(
      `watchlist coverage ${covered}/${snapshot.watchlist.length} — the board must cover every watchlist protocol`,
    );
  if (rows.length < 100 || rows.length > 4000)
    fail(`board has ${rows.length} rows, needs 100 to 4000`);
  const ranks = new Set(rows.map((r) => r.rank));
  if (ranks.size !== rows.length)
    fail("ranks are not unique 1..N");
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    if (
      !Number.isInteger(r.implied_value_usd) ||
      r.implied_value_usd <= 0 ||
      r.implied_value_usd > 100_000_000_000_000
    )
      fail(`row ${r.slug} has an invalid implied value`);
    if (i > 0 && rows[i - 1].implied_value_usd < r.implied_value_usd)
      fail("rows are not sorted by implied value descending");
    if (
      !Array.isArray(r.farm_steps) ||
      r.farm_steps.length < 3 ||
      r.farm_steps.length > 12
    )
      fail(`row ${r.slug} has ${r.farm_steps.length} farm steps, needs 3 to 12`);
    for (const s of r.farm_steps) {
      const t = s.trim();
      if (t.length < 20 || t.length > 600)
        fail(`row ${r.slug} has a farm step of ${t.length} chars, needs 20 to 600`);
    }
  }
  if (new Set(rows.map((r) => r.implied_value_usd)).size < 2)
    fail("all implied values are the same — not a ranking");
  if (ledger.groups.unexplained !== 0)
    fail(`ledger does not close: ${ledger.groups.unexplained} unexplained protocols`);
  if (ledger.groups.board_rankable !== rows.length)
    fail("ledger board count does not match the board");

  // ---- write the board and the dashboard ----
  // The screenshot check comes after this write: the screenshots are
  // rendered from this dashboard, so the first run writes the board and
  // the dashboard, then refuses at the dossier until the screenshots
  // exist. A run that reaches the dossier has passed every check.
  mkdirSync(join(outDir, "dashboard"), { recursive: true });
  mkdirSync(join(outDir, "screenshots"), { recursive: true });
  writeFileSync(
    join(outDir, "board.json"),
    JSON.stringify({ rows }, null, 2) + "\n",
  );

  const data = {
    meta: {
      as_of: snapshot.as_of,
      source: snapshot.source,
      floor_usd: snapshot.floor_usd,
      board_rows: rows.length,
      watchlist_total: snapshot.watchlist.length,
      watchlist_covered: covered,
      global_median: +comparables.globalMedian.toFixed(4),
      global_n: comparables.globalN,
      median_age_days: medianAge,
      interval_p25: p25,
      interval_p75: p75,
      snapshot_protocols: snapshot.protocols.length,
    },
    rows,
    liveTokens,
    comparables: comparables.table,
    ledger: ledger.groups,
    loo: looBase,
    looVariants,
  };
  writeFileSync(
    join(outDir, "dashboard", "zz-data.js"),
    "window.RADAR=" + JSON.stringify(data) + ";\n",
  );
  for (const f of ["index.html", "app.css", "app.js"]) {
    copyFileSync(join(ROOT, "dashboard", f), join(outDir, "dashboard", f));
  }

  const shotDir = join(ROOT, "screenshots");
  const shots = existsSync(shotDir)
    ? readdirSync(shotDir).filter((f) => !f.startsWith("."))
    : [];
  if (shots.length < 3)
    fail(
      `only ${shots.length} screenshots present, need at least 3 — render them from ${join(outDir, "dashboard")} and run again`,
    );
  for (const f of shots) {
    copyFileSync(join(shotDir, f), join(outDir, "screenshots", f));
  }

  const dossier = buildDossier(outDir, {
    text_max_bytes: TEXT_MAX_BYTES,
    screenshots: { max: 4, max_bytes: 524288 },
    dashboard: { max_files: 400, max_bytes: 4194304 },
  });
  if (dossier.length > DOSSIER_MAX_BYTES)
    fail(`dossier is ${dossier.length} bytes, over the 1.5 MB cap`);
  writeFileSync(join(outDir, "dossier.json"), dossier);

  const top = rows[0];
  console.log(
    `Pre-Token Radar v4: ${rows.length} rows, ${covered}/${snapshot.watchlist.length} watchlist, ` +
      `top ${top.slug} ${money(top.implied_value_usd)}, ` +
      `global median ${comparables.globalMedian.toFixed(3)} (n=${comparables.globalN}), ` +
      `median age ${medianAge}d, dossier ${dossier.length} bytes`,
  );
}

main();
