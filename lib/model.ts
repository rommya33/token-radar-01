// The token-radar value model, farm plans, ledger and leave-one-out
// validation. Every number here is computed from the sealed snapshot at
// runtime. No protocol name and no price is hardcoded anywhere.
//
// The model, in one line per protocol:
//   implied = TVL x comparable multiple x momentum x maturity
// The multiple is the median market-cap-over-TVL of the tokened protocols
// in the same category (at least 3 comparables, else the global median).
// Momentum follows the 7-day TVL change. Maturity follows how long the
// protocol has run with no token. Both factors are bounded and the
// multiple and the implied value are clamped, so no single input can
// dominate the board.

export const TVL_FLOOR_USD = 5_000_000;
export const IMPLIED_MIN_USD = 1_000_000;
export const IMPLIED_MAX_USD = 100_000_000_000_000;
export const MULTIPLE_MIN = 0.05;
export const MULTIPLE_MAX = 2.0;
export const MATURITY_CAP_DAYS = 1095;

const VERSION_SUFFIX = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;
const EXCLUDED_CATEGORIES = new Set([
  "Bridge",
  "Canonical Bridge",
  "Liquid Staking",
  "Liquid Restaking",
  "Restaked BTC",
  "CEX",
]);
const WRAPPED_WORD = /\b(wrapped|staked|staking)\b/i;
const EXCHANGE_PREFIX =
  /^(Binance|Coinbase|Bybit|Kraken|Bitget|OKX|Bitfinex|Gemini)/;

export function clamp(x, lo, hi) {
  return Math.min(hi, Math.max(lo, x));
}

export function median(values) {
  const s = [...values].sort((a, b) => a - b);
  const n = s.length;
  if (n === 0) return null;
  return n % 2 === 1 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2;
}

export function ageDays(listedAt, asOf) {
  if (!listedAt) return null;
  const ms = asOf - new Date(listedAt + "T00:00:00Z").getTime();
  return Math.max(0, Math.round(ms / 86400000));
}

// Strictly pre-token: the record carries no token at all, not even a
// parent token's symbol or CoinGecko id. A protocol whose record names a
// symbol is a product line of a tokened parent, not a launch candidate.
export function recordsNoToken(p) {
  return p.mcap_usd === null && p.gecko_id === null && p.symbol === null;
}

export function isRankable(p) {
  if (!recordsNoToken(p)) return false;
  if (p.tvl_usd < TVL_FLOOR_USD) return false;
  if (VERSION_SUFFIX.test(p.name)) return false;
  if (p.category !== null && EXCLUDED_CATEGORIES.has(p.category)) return false;
  if (WRAPPED_WORD.test(p.name)) return false;
  if (EXCHANGE_PREFIX.test(p.name)) return false;
  return true;
}

// The first exclusion rule that removes a protocol, in the priority order
// the ledger uses. Returns null for a protocol on the board.
export function exclusionReason(p) {
  if (p.mcap_usd !== null) {
    if (p.mcap_usd > 0) return "tokened_mcap_positive";
    if (p.mcap_usd === 0) return "tokened_mcap_zero";
    return "tokened_mcap_negative";
  }
  if (!recordsNoToken(p)) return "not_strictly_pretoken";
  if (VERSION_SUFFIX.test(p.name)) return "version_suffix";
  if (p.category !== null && EXCLUDED_CATEGORIES.has(p.category))
    return "excluded_category";
  if (WRAPPED_WORD.test(p.name)) return "wrapped_word";
  if (EXCHANGE_PREFIX.test(p.name)) return "exchange_prefix";
  if (p.tvl_usd < TVL_FLOOR_USD) return "tvl_floor";
  return null;
}

// Comparables: every tokened protocol with a positive market cap. The
// pool defines every multiple on the board.
export function computeComparables(pool) {
  const byCategory = new Map();
  for (const p of pool) {
    const r = p.mcap_usd / p.tvl_usd;
    if (!byCategory.has(p.category)) byCategory.set(p.category, []);
    byCategory.get(p.category).push(r);
  }
  const table = [];
  for (const [category, ratios] of [...byCategory.entries()].sort((a, b) =>
    String(a[0]).localeCompare(String(b[0]), "en-US"),
  )) {
    table.push({ category, median: median(ratios), n: ratios.length });
  }
  const globalMedian = median(pool.map((p) => p.mcap_usd / p.tvl_usd));
  return { table, globalMedian, globalN: pool.length };
}

// The multiple for one category: the category median when at least 3
// tokened protocols back it, else the global median. The clamp is the
// second rail against a wild single-category median.
export function multipleFor(category, comparables) {
  const row = comparables.table.find((r) => r.category === category);
  const raw =
    row && row.n >= 3 ? row.median : comparables.globalMedian;
  return {
    multiple: clamp(raw, MULTIPLE_MIN, MULTIPLE_MAX),
    n: row && row.n >= 3 ? row.n : comparables.globalN,
    source:
      row && row.n >= 3
        ? `category median (${category}, n=${row.n})`
        : `global median (n=${comparables.globalN})`,
  };
}

export function momentumFactor(change7d) {
  if (change7d === null || change7d === undefined) return 1.0;
  return 1 + (clamp(change7d, -60, 120) / 100) * 0.5;
}

export function maturityFactor(age, medianAge) {
  const a = age === null || age === undefined ? medianAge : age;
  return 0.6 + (Math.min(a, MATURITY_CAP_DAYS) / MATURITY_CAP_DAYS) * 0.4;
}

export function impliedValue(p, comparables, medianAge, asOf) {
  const { multiple } = multipleFor(p.category, comparables);
  const mom = momentumFactor(p.change_7d);
  const mat = maturityFactor(ageDays(p.listed_at, asOf), medianAge);
  const raw = p.tvl_usd * multiple * mom * mat;
  return clamp(Math.round(raw), IMPLIED_MIN_USD, IMPLIED_MAX_USD);
}

// One line per row, derived from the model, and the reason must never
// contradict the numbers it cites.
export function verdictFor(implied, mom, age) {
  if (implied >= 50_000_000 && mom >= 1.0 && age >= 180) return "Farm now";
  if (implied >= 10_000_000 || mom >= 1.15) return "Watch";
  return "Skip";
}

export function verdictReason(p, implied, mom, age) {
  const v = verdictFor(implied, mom, age);
  const money = "$" + Math.round(implied / 1_000_000) + "M";
  const chg =
    p.change_7d === null
      ? "no 7-day change reported"
      : `TVL ${p.change_7d >= 0 ? "up" : "down"} ${Math.abs(p.change_7d).toFixed(1)}% in 7 days`;
  if (v === "Farm now")
    return `Implied ${money} clears the $50M farm line, ${chg}, ${age} days with no token`;
  if (v === "Watch") {
    if (implied >= 10_000_000)
      return `Implied ${money} clears the $10M watch line, ${chg}`;
    return `TVL up sharply in 7 days, ${age} days with no token`;
  }
  return `Implied ${money} is below the $10M watch line, ${chg}`;
}

// Gas profile from the protocol's first chain. Ranges, not promises.
const L2_CHAINS = new Set([
  "Arbitrum",
  "Optimism",
  "Base",
  "Polygon",
  "zkSync",
  "Scroll",
  "Blast",
  "Mantle",
  "Linea",
  "Mode",
]);
export function gasProfile(chain) {
  if (chain === "Ethereum") return { label: "L1 gas", lo: 2, hi: 15 };
  if (L2_CHAINS.has(chain)) return { label: "L2 gas", lo: 0.05, hi: 0.5 };
  if (chain === "Solana") return { label: "Solana fee", lo: 0.01, hi: 0.01 };
  if (chain === "BNB Chain" || chain === "BSC")
    return { label: "BNB gas", lo: 0.1, hi: 0.3 };
  if (chain === "Avalanche") return { label: "Avalanche gas", lo: 0.1, hi: 0.5 };
  return { label: "gas", lo: 0.05, hi: 2 };
}

export function principalFor(tvl) {
  if (tvl >= 1_000_000_000) return 2000;
  if (tvl >= 100_000_000) return 1000;
  if (tvl >= 10_000_000) return 500;
  return 250;
}

export function holdDaysFor(age) {
  if (age < 180) return 60;
  if (age < 365) return 45;
  return 30;
}

function categoryAction(category) {
  switch (category) {
    case "Lending":
    case "CDP":
      return "supply the asset, then borrow a small amount against it and repay it";
    case "Dexs":
    case "Yield":
    case "Leveraged Farming":
      return "add liquidity on both sides of the main pool and hold the position";
    case "Perpetuals":
    case "Derivatives":
      return "try the testnet first, then open one small position with size you can lose";
    case "Bridge":
      return "bridge a small amount and use the funds inside the app";
    case "Staking":
    case "Restaking":
      return "stake and hold the receipt token";
    case "RWA":
      return "mint the yield-bearing asset and hold it";
    case "Prediction Market":
      return "take one position in a market you follow";
    case "Risk Curators":
    case "Onchain Capital Allocator":
      return "deposit into a vault and leave it alone";
    case "Stablecoin":
      return "mint or deposit the stable asset and hold it";
    default:
      return "deposit USDC into the protocol and hold the position";
  }
}

function money(n) {
  return "$" + n.toLocaleString("en-US");
}

// Six concrete steps. Every step names an action, a dollar figure and a
// time. The plan totals are computed from the same figures, so the totals
// and the steps can never disagree.
export function buildFarmPlan(p, age) {
  const principal = principalFor(p.tvl_usd);
  const firstChain = p.chains && p.chains.length > 0 ? p.chains[0] : "Ethereum";
  const gas = gasProfile(firstChain);
  const hold = holdDaysFor(age);
  const weeks = Math.max(1, Math.ceil(hold / 7));
  const action = categoryAction(p.category);
  const gasRange = `$${gas.lo}–$${gas.hi}`;
  const steps = [
    `Open a fresh wallet for this farm and write its seed phrase on paper, offline — never store it in a screenshot or a notes app. Cost: $0. Time: 10 minutes.`,
    `Put ${money(principal)} to work in ${p.name}: ${action}. Keep the receipt in the farming wallet. Cost: about ${gasRange} in gas on ${firstChain}. Time: 20 minutes.`,
    `Repeat one qualifying action each week on ${firstChain} — a supply, a swap, or a vote — so the wallet shows steady use. Cost: gas only, about ${gasRange} in gas on ${firstChain}, each week. Time: 15 minutes a week.`,
    `Hold the position for ${hold} days so the activity lands in more than one snapshot. Cost: $0. Time: ${hold} days.`,
    `Claim only from ${p.name}'s own published links. Never pay anyone to claim for you, and never sign a transaction you cannot read. Cost: gas only. Time: 10 minutes.`,
    `Keep a farm log: wallet address, dates, transaction hashes, and amounts. Review it weekly and stop if the protocol pauses deposits. Cost: $0. Time: 10 minutes a week.`,
  ];
  const gasActions = 1 + weeks + 1;
  const totals = {
    gasLo: +(gas.lo * gasActions).toFixed(2),
    gasHi: +(gas.hi * gasActions).toFixed(2),
    principal,
    activeMinutes: 10 + 20 + 15 * weeks + 10 + 10 * weeks,
    holdDays: hold,
    chain: firstChain,
  };
  const whyNow =
    p.change_7d !== null && p.change_7d > 0
      ? `TVL is up ${p.change_7d.toFixed(1)}% in 7 days — activity now is more likely to land before a launch than activity later.`
      : age < 180
        ? `Only ${age} days with no token — an early farmer has the longest runway before any launch.`
        : `${age} days with no token and still no launch — the position has survived long enough to be worth a small, patient farm.`;
  return { steps, totals, whyNow };
}

// Leave-one-out validation of the model on the tokened pool. For each
// tokened protocol the implied value is recomputed with that protocol
// left out of its own median, so the residual measures what the model
// would have predicted for a protocol it had never seen.
export function looResiduals(pool, comparables, medianAge, asOf, opts) {
  const out = [];
  for (const p of pool) {
    const rest = pool.filter((q) => q.slug !== p.slug);
    const comps = computeComparables(rest);
    let multiple;
    if (opts && opts.shrinkK > 0) {
      const row = comps.table.find((r) => r.category === p.category);
      multiple =
        row && row.n >= 3
          ? (row.n * row.median + opts.shrinkK * comps.globalMedian) /
            (row.n + opts.shrinkK)
          : comps.globalMedian;
    } else if (opts && opts.globalOnly) {
      multiple = comps.globalMedian;
    } else {
      multiple = multipleFor(p.category, comps).multiple;
    }
    multiple = clamp(multiple, MULTIPLE_MIN, MULTIPLE_MAX);
    const momSlope = opts && opts.momSlope !== undefined ? opts.momSlope : 0.5;
    const mom =
      momSlope === 0
        ? 1
        : 1 + (clamp(p.change_7d ?? 0, -60, 120) / 100) * momSlope;
    const mat =
      opts && opts.matOff
        ? 1
        : maturityFactor(ageDays(p.listed_at, asOf), medianAge);
    const implied = clamp(
      Math.round(p.tvl_usd * multiple * mom * mat),
      IMPLIED_MIN_USD,
      IMPLIED_MAX_USD,
    );
    out.push({ slug: p.slug, residual: p.mcap_usd / implied });
  }
  return out;
}

export function summarizeResiduals(residuals) {
  const rs = residuals.map((r) => r.residual).sort((a, b) => a - b);
  const n = rs.length;
  // Type-7 quantiles (linear interpolation): the 50th percentile is the
  // median, so the interval endpoints and the median cannot disagree.
  const q = (f) => {
    const idx = f * (n - 1);
    const lo = Math.floor(idx);
    const hi = Math.ceil(idx);
    return rs[lo] + (rs[hi] - rs[lo]) * (idx - lo);
  };
  const inRange = (lo, hi) =>
    rs.filter((r) => r >= lo && r <= hi).length / n;
  const logAbs = rs
    .map((r) => Math.abs(Math.log(r)))
    .sort((a, b) => a - b);
  return {
    n,
    p10: +q(0.1).toFixed(4),
    p25: +q(0.25).toFixed(4),
    p50: +q(0.5).toFixed(4),
    p75: +q(0.75).toFixed(4),
    p90: +q(0.9).toFixed(4),
    medianAbsLogResidual: +median(logAbs).toFixed(3),
    coverage50: +(inRange(q(0.25), q(0.75)) * 100).toFixed(1),
    coverage80: +(inRange(q(0.1), q(0.9)) * 100).toFixed(1),
    within2x: +(inRange(0.5, 2) * 100).toFixed(1),
    within3x: +(inRange(1 / 3, 3) * 100).toFixed(1),
  };
}

// The whole snapshot accounted for, in mutually exclusive groups. The
// groups sum to the snapshot total and the unexplained group must be 0.
export function buildLedger(snapshot) {
  const groups = {
    board_rankable: 0,
    tokened_mcap_positive: 0,
    tokened_mcap_zero: 0,
    tokened_mcap_negative: 0,
    not_strictly_pretoken: 0,
    version_suffix: 0,
    excluded_category: 0,
    wrapped_word: 0,
    exchange_prefix: 0,
    tvl_floor: 0,
    unexplained: 0,
  };
  for (const p of snapshot.protocols) {
    if (isRankable(p)) {
      groups.board_rankable += 1;
      continue;
    }
    const reason = exclusionReason(p);
    if (reason && reason in groups) groups[reason] += 1;
    else groups.unexplained += 1;
  }
  return { groups, total: snapshot.protocols.length };
}
