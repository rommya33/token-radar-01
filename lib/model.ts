// Token Radar v5 — the value model, fitted, not assumed.
//
// v3/v4 priced every protocol as TVL x a category median, i.e. they fixed the
// TVL elasticity at 1: a protocol with 100x the TVL was assumed to be worth
// 100x as much. The snapshot says otherwise. On the 128 tokened protocols
// with a positive market cap, log(market cap) regressed on log(TVL) has a
// slope of 0.52: market cap grows like the SQUARE ROOT of TVL, not linearly.
// The leave-one-out error of the fitted slope model is 1.223 (median |log
// error|, 32.0% of real caps within 2x) against 1.634 (18.8%) for the
// category-median model. Every extra term we tested — category dummies,
// age, 7-day change, chain count, a launch-odds logit — made the LOO error
// WORSE, so v5 ships the one-term fitted model and says so in Methodology.
//
// Everything here is computed at runtime from the sealed snapshot. No
// hardcoded protocol names, no hardcoded prices, no hardcoded coefficients:
// the intercept and slope are fitted from the snapshot on every run.

export interface SnapshotProtocol {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
}

export interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: SnapshotProtocol[];
  watchlist: string[];
}

export interface ValueFit {
  intercept: number;
  slope: number;
  n: number;
}

export interface LooStats {
  medAbsLog: number;
  in2: number;
  in3: number;
  p25: number;
  p50: number;
  p75: number;
}

export interface LooVariant {
  name: string;
  medAbsLog: number;
  in2: number;
}

export interface PlanTotal {
  gasLo: number;
  gasHi: number;
  principal: number;
  activeMinutes: number;
  holdDays: number;
  chain: string;
}

export interface BoardRow {
  slug: string;
  name: string;
  rank: number;
  implied_value_usd: number;
  tvl_usd: number;
  category: string;
  chains: string[];
  change_7d: number | null;
  listed_at: string | null;
  age_days: number;
  age_source: string;
  multiple: number;
  multiple_source: string;
  momentum_factor: number;
  maturity_factor: number;
  verdict: string;
  verdict_reason: string;
  watchlist: boolean;
  farm_steps: string[];
  interval_lo: number;
  interval_hi: number;
  global_counterfactual_usd: number;
  v3_counterfactual_usd: number;
  plan_total: PlanTotal;
  why_now: string;
}

export interface LedgerBucket {
  label: string;
  count: number;
}

export interface RadarResult {
  asOf: string;
  fit: ValueFit;
  loo: LooStats;
  looTable: LooVariant[];
  oddsAuc: number;
  globalMedian: number;
  medAge: number;
  ledger: LedgerBucket[];
  rows: BoardRow[];
  live: { name: string; mcap: number; tvl: number; category: string; ratio: number }[];
}

export function clamp(x: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, x));
}

export function median(a: number[]): number {
  const s = [...a].sort((x, y) => x - y);
  const n = s.length;
  if (n === 0) return NaN;
  return n % 2 ? s[(n - 1) / 2]! : (s[n / 2 - 1]! + s[n / 2]!) / 2;
}

export function quantile(a: number[], p: number): number {
  const s = [...a].sort((x, y) => x - y);
  const i = (s.length - 1) * p;
  const lo = Math.floor(i);
  const hi = Math.min(lo + 1, s.length - 1);
  const f = i - lo;
  return s[lo]! * (1 - f) + s[hi]! * f;
}

export function ageDays(p: SnapshotProtocol, asOf: Date): number | null {
  if (!p.listed_at) return null;
  const d = new Date(p.listed_at + "T00:00:00Z");
  return Math.max(0, Math.round((asOf.getTime() - d.getTime()) / 86400000));
}

// The fitting pool: tokened protocols with a positive market cap. The
// snapshot carries 15 zero-mcap records and one -1 sentinel; both are dead
// records and are excluded, exactly as the v3 comparables did.
export function fittingPool(snapshot: Snapshot): SnapshotProtocol[] {
  return snapshot.protocols.filter((p) => p.mcap_usd !== null && p.mcap_usd > 0);
}

// Ordinary least squares for log(mcap) ~ 1 + log(TVL), solved through the
// 2x2 normal equations. Two parameters, 128 points: the fit is exact and
// deterministic, no iterative solver, no dependencies.
export function fitValueModel(pool: SnapshotProtocol[]): ValueFit {
  let n = 0;
  let sx = 0;
  let sy = 0;
  let sxx = 0;
  let sxy = 0;
  for (const p of pool) {
    const x = Math.log(p.tvl_usd);
    const y = Math.log(p.mcap_usd!);
    n += 1;
    sx += x;
    sy += y;
    sxx += x * x;
    sxy += x * y;
  }
  const denom = n * sxx - sx * sx;
  const slope = (n * sxy - sx * sy) / denom;
  const intercept = (sy - slope * sx) / n;
  return { intercept, slope, n };
}

export function predictValue(tvl: number, fit: ValueFit): number {
  return clamp(Math.round(Math.exp(fit.intercept + fit.slope * Math.log(tvl))), 1_000_000, 1e14);
}

// Leave-one-out validation of the fitted model: refit without each protocol
// in turn, predict it, and score the residual actual/predicted. This is the
// honest error of the model on protocols it never saw.
export function looValidation(pool: SnapshotProtocol[]): LooStats {
  const ratios: number[] = [];
  for (let i = 0; i < pool.length; i++) {
    const rest = pool.filter((_, j) => j !== i);
    const fit = fitValueModel(rest);
    const pred = predictValue(pool[i]!.tvl_usd, fit);
    ratios.push(pool[i]!.mcap_usd! / pred);
  }
  const absLog = ratios.map((r) => Math.abs(Math.log(r))).sort((a, b) => a - b);
  return {
    medAbsLog: median(absLog),
    in2: ratios.filter((r) => r >= 0.5 && r <= 2).length / ratios.length,
    in3: ratios.filter((r) => r >= 1 / 3 && r <= 3).length / ratios.length,
    p25: quantile(ratios, 0.25),
    p50: quantile(ratios, 0.5),
    p75: quantile(ratios, 0.75),
  };
}

// --- The v3 model, kept ONLY as a counterfactual and as a row of the LOO
// table. It is the model v5 replaces: TVL x category median x momentum x
// maturity, with the multiple clamped to [0.05, 2.0]. ---

export function computeComparables(pool: SnapshotProtocol[]): {
  byCategory: Map<string, { median: number; n: number }>;
  global: number;
} {
  const byCategory = new Map<string, { median: number; n: number }>();
  const cats = new Map<string, number[]>();
  for (const p of pool) {
    const c = p.category ?? "Unknown";
    if (!cats.has(c)) cats.set(c, []);
    cats.get(c)!.push(p.mcap_usd! / p.tvl_usd);
  }
  for (const [c, rs] of cats) byCategory.set(c, { median: median(rs), n: rs.length });
  return { byCategory, global: median(pool.map((p) => p.mcap_usd! / p.tvl_usd)) };
}

export function momentumFactor(change7d: number | null): number {
  if (change7d === null || change7d === undefined) return 1.0;
  return 1 + (clamp(change7d, -60, 120) / 100) * 0.5;
}

export function maturityFactor(age: number): number {
  return 0.6 + (Math.min(age, 1095) / 1095) * 0.4;
}

export function v3Implied(
  p: SnapshotProtocol,
  comp: { byCategory: Map<string, { median: number; n: number }>; global: number },
  medAge: number,
  asOf: Date,
): number {
  const c = comp.byCategory.get(p.category ?? "Unknown");
  const mult = c && c.n >= 3 ? c.median : comp.global;
  const clamped = clamp(mult, 0.05, 2.0);
  const age = ageDays(p, asOf) ?? medAge;
  const implied = p.tvl_usd * clamped * momentumFactor(p.change_7d) * maturityFactor(age);
  return clamp(Math.round(implied), 1_000_000, 1e14);
}

// LOO table for Methodology: the old model and its variants against the new
// fitted model, all scored the same way on the same 128 protocols.
export function looTable(
  pool: SnapshotProtocol[],
  comp: { byCategory: Map<string, { median: number; n: number }>; global: number },
  medAge: number,
  asOf: Date,
): LooVariant[] {
  const out: LooVariant[] = [];
  const score = (preds: number[]): LooVariant => {
    const absLog = pool.map((p, i) => Math.abs(Math.log(p.mcap_usd! / preds[i]!))).sort((a, b) => a - b);
    const in2 = pool.filter((p, i) => {
      const r = p.mcap_usd! / preds[i]!;
      return r >= 0.5 && r <= 2;
    }).length / pool.length;
    return { name: "", medAbsLog: median(absLog), in2 };
  };
  // v3 base, leave-one-out of the median
  const v3preds = pool.map((p) => {
    const rest = pool.filter((q) => q.slug !== p.slug);
    const rc = computeComparables(rest);
    return v3Implied(p, rc, medAge, asOf);
  });
  out.push({ ...score(v3preds), name: "v3 median model (slope fixed at 1.00)" });
  // v3 with shrinkage k=10 toward the global median
  const shrinkPreds = pool.map((p) => {
    const rest = pool.filter((q) => q.slug !== p.slug);
    const rc = computeComparables(rest);
    const c = rc.byCategory.get(p.category ?? "Unknown");
    let mult = rc.global;
    if (c && c.n >= 3) mult = (c.n * c.median + 10 * rc.global) / (c.n + 10);
    const age = ageDays(p, asOf) ?? medAge;
    return clamp(
      Math.round(p.tvl_usd * clamp(mult, 0.05, 2.0) * momentumFactor(p.change_7d) * maturityFactor(age)),
      1_000_000,
      1e14,
    );
  });
  out.push({ ...score(shrinkPreds), name: "v3 + shrinkage k=10 to global median" });
  // OLS with category dummies (the overfit direction)
  const cats = [...new Set(pool.map((p) => p.category ?? "Unknown"))].filter(
    (c) => pool.filter((p) => (p.category ?? "Unknown") === c).length >= 3,
  );
  const olsCatPreds = pool.map((p, i) => {
    const rest = pool.filter((_, j) => j !== i);
    const y = rest.map((q) => Math.log(q.mcap_usd!));
    const X = rest.map((q) => {
      const row = [1, Math.log(q.tvl_usd)];
      for (const c of cats) row.push((q.category ?? "Unknown") === c ? 1 : 0);
      row.push(cats.includes(q.category ?? "Unknown") ? 0 : 1);
      return row;
    });
    const beta = solveLeastSquares(X, y);
    const xi = [1, Math.log(p.tvl_usd)];
    for (const c of cats) xi.push((p.category ?? "Unknown") === c ? 1 : 0);
    xi.push(cats.includes(p.category ?? "Unknown") ? 0 : 1);
    return clamp(Math.round(Math.exp(dot(xi, beta))), 1_000_000, 1e14);
  });
  out.push({ ...score(olsCatPreds), name: "OLS + category dummies (overfits)" });
  // OLS-A, the v5 model
  const loo = looValidation(pool);
  out.push({ name: "v5 fitted slope model (OLS, this entry)", medAbsLog: loo.medAbsLog, in2: loo.in2 });
  return out;
}

export function dot(a: number[], b: number[]): number {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i]! * b[i]!;
  return s;
}

// Small dense least-squares solver (normal equations + Gaussian elimination)
// for the LOO table's category-dummy variant. Only used for validation, never
// for the shipped value model.
export function solveLeastSquares(X: number[][], y: number[]): number[] {
  const k = X[0]!.length;
  const A: number[][] = Array.from({ length: k }, () => new Array<number>(k).fill(0));
  const b: number[] = new Array<number>(k).fill(0);
  for (let r = 0; r < X.length; r++) {
    for (let i = 0; i < k; i++) {
      b[i]! += X[r]![i]! * y[r]!;
      for (let j = 0; j < k; j++) A[i]![j]! += X[r]![i]! * X[r]![j]!;
    }
  }
  for (let i = 0; i < k; i++) A[i]![i]! += 1e-8;
  for (let col = 0; col < k; col++) {
    let piv = col;
    for (let r = col + 1; r < k; r++) if (Math.abs(A[r]![col]!) > Math.abs(A[piv]![col]!)) piv = r;
    [A[col], A[piv]] = [A[piv]!, A[col]!];
    [b[col], b[piv]] = [b[piv]!, b[col]!];
    for (let r = col + 1; r < k; r++) {
      const f = A[r]![col]! / A[col]![col]!;
      for (let c = col; c < k; c++) A[r]![c]! -= f * A[col]![c]!;
      b[r]! -= f * b[col]!;
    }
  }
  const x = new Array<number>(k).fill(0);
  for (let i = k - 1; i >= 0; i--) {
    let s = b[i]!;
    for (let j = i + 1; j < k; j++) s -= A[i]![j]! * x[j]!;
    x[i] = s / A[i]![i]!;
  }
  return x;
}

// --- Launch odds, tested and NOT used in the ranking. ---
// A logistic model for P(has a token) fitted on all 758 protocols. Its
// 5-fold AUC is 0.67: real signal, but adding its logit to the value model
// made the LOO value error WORSE (1.326 vs 1.223), so the ranking uses the
// value model alone. The AUC is reported in Methodology as a tested variant.

export function fitLaunchOdds(snapshot: Snapshot, medAgePool: number): { beta: number[]; auc: number } {
  const feats = (p: SnapshotProtocol): number[] => {
    const a = ageDays(p, new Date(snapshot.as_of + "T00:00:00Z"));
    return [
      1,
      Math.log(p.tvl_usd),
      (a ?? medAgePool) / 365,
      a === null ? 1 : 0,
      Math.log(1 + p.chains.length),
      clamp(p.change_7d ?? 0, -60, 120) / 100,
    ];
  };
  const fitLogit = (rows: SnapshotProtocol[]): number[] => {
    const X = rows.map(feats);
    const yv = rows.map((p) => (p.mcap_usd !== null && p.mcap_usd > 0 ? 1 : 0));
    const k = X[0]!.length;
    let beta = new Array<number>(k).fill(0);
    for (let it = 0; it < 60; it++) {
      const g = new Array<number>(k).fill(0);
      const H: number[][] = Array.from({ length: k }, () => new Array<number>(k).fill(0));
      for (let r = 0; r < X.length; r++) {
        const z = clamp(dot(X[r]!, beta), -30, 30);
        const pr = 1 / (1 + Math.exp(-z));
        const w = pr * (1 - pr) + 1e-9;
        for (let i = 0; i < k; i++) {
          g[i]! += X[r]![i]! * (yv[r]! - pr);
          for (let j = 0; j < k; j++) H[i]![j]! += w * X[r]![i]! * X[r]![j]!;
        }
      }
      for (let i = 0; i < k; i++) H[i]![i]! += 1e-6;
      const step = solveLinear(H, g);
      let mx = 0;
      for (let i = 0; i < k; i++) {
        beta[i]! += step[i]!;
        mx = Math.max(mx, Math.abs(step[i]!));
      }
      if (mx < 1e-9) break;
    }
    return beta;
  };
  // 5-fold AUC, deterministic folds by slug order.
  const all = [...snapshot.protocols].sort((a, b) => (a.slug < b.slug ? -1 : 1));
  const probs = new Array<number>(all.length).fill(0);
  for (let f = 0; f < 5; f++) {
    const test = all.filter((_, i) => i % 5 === f);
    const train = all.filter((_, i) => i % 5 !== f);
    const beta = fitLogit(train);
    for (const p of test) {
      const idx = all.indexOf(p);
      const z = clamp(dot(feats(p), beta), -30, 30);
      probs[idx] = 1 / (1 + Math.exp(-z));
    }
  }
  const yv = all.map((p) => (p.mcap_usd !== null && p.mcap_usd > 0 ? 1 : 0));
  const pos = probs.filter((_, i) => yv[i] === 1);
  const neg = probs.filter((_, i) => yv[i] === 0);
  let wins = 0;
  for (const a of pos) for (const b of neg) wins += a > b ? 1 : a === b ? 0.5 : 0;
  const auc = wins / (pos.length * neg.length);
  return { beta: fitLogit(all), auc };
}

export function solveLinear(A: number[][], b: number[]): number[] {
  const n = b.length;
  const M = A.map((row, i) => [...row, b[i]!]);
  for (let col = 0; col < n; col++) {
    let piv = col;
    for (let r = col + 1; r < n; r++) if (Math.abs(M[r]![col]!) > Math.abs(M[piv]![col]!)) piv = r;
    [M[col], M[piv]] = [M[piv]!, M[col]!];
    for (let r = col + 1; r < n; r++) {
      const f = M[r]![col]! / M[col]![col]!;
      for (let c = col; c <= n; c++) M[r]![c]! -= f * M[col]![c]!;
    }
  }
  const x = new Array<number>(n).fill(0);
  for (let i = n - 1; i >= 0; i--) {
    let s = M[i]![n]!;
    for (let j = i + 1; j < n; j++) s -= M[i]![j]! * x[j]!;
    x[i] = s / M[i]![i]!;
  }
  return x;
}

// --- Board scope (design.md, unchanged from v3/v4) ---

const EXCLUDED_CATEGORIES = new Set([
  "Bridge",
  "Canonical Bridge",
  "Liquid Staking",
  "Liquid Restaking",
  "Restaked BTC",
  "CEX",
]);
const VERSION_RE = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;
const WRAPPED_RE = /\bwrapped\b|\bstaked\b|\bstaking\b/i;
const EXCHANGE_PREFIXES = ["Binance", "Coinbase", "Bybit", "Kraken", "Bitget", "OKX", "Bitfinex", "Gemini"];

export function isRankable(p: SnapshotProtocol): boolean {
  if (!(p.mcap_usd === null && p.gecko_id === null && p.symbol === null)) return false;
  if (p.tvl_usd < 5_000_000) return false;
  if (EXCLUDED_CATEGORIES.has(p.category ?? "")) return false;
  if (VERSION_RE.test(p.name)) return false;
  if (WRAPPED_RE.test(p.name)) return false;
  if (EXCHANGE_PREFIXES.some((x) => p.name.startsWith(x))) return false;
  return true;
}

export function exclusionReason(p: SnapshotProtocol): string {
  if (p.mcap_usd !== null) return p.mcap_usd > 0 ? "tokened" : p.mcap_usd === 0 ? "tokened, mcap 0" : "tokened, mcap -1";
  if (p.gecko_id !== null || p.symbol !== null) return "listed, no market cap recorded";
  if (p.tvl_usd < 5_000_000) return "TVL below $5M";
  if (EXCLUDED_CATEGORIES.has(p.category ?? "")) return "excluded category";
  if (VERSION_RE.test(p.name)) return "version suffix";
  if (WRAPPED_RE.test(p.name)) return "wrapped / staked name";
  if (EXCHANGE_PREFIXES.some((x) => p.name.startsWith(x))) return "exchange prefix";
  return "rankable";
}

// --- Farm plans (design.md templates, unchanged in shape) ---

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

export function chainGas(chain: string): { label: string; lo: number; hi: number } {
  if (chain === "Ethereum") return { label: "$2–$15 in gas on Ethereum", lo: 2, hi: 15 };
  if (L2_CHAINS.has(chain)) return { label: "$0.05–$0.50 in gas on " + chain, lo: 0.05, hi: 0.5 };
  if (chain === "Solana") return { label: "$0.01 in gas on Solana", lo: 0.01, hi: 0.01 };
  if (chain === "BSC" || chain === "Binance" || chain === "BNB Chain") return { label: "$0.10–$0.30 in gas on BNB Chain", lo: 0.1, hi: 0.3 };
  if (chain === "Avalanche") return { label: "$0.10–$0.50 in gas on Avalanche", lo: 0.1, hi: 0.5 };
  return { label: "a few cents to a few dollars in gas", lo: 0.05, hi: 3 };
}

export function principalFor(tvl: number): number {
  if (tvl >= 1_000_000_000) return 2000;
  if (tvl >= 100_000_000) return 1000;
  if (tvl >= 10_000_000) return 500;
  return 250;
}

export function categoryAction(category: string, name: string, chain: string, principal: number): string {
  const p = "$" + principal.toLocaleString("en-US");
  switch (category) {
    case "Lending":
    case "CDP":
      return `Supply ${p} of stablecoins to ${name} on ${chain}, then borrow a small amount against it to show both sides of the book.`;
    case "Dexs":
    case "Yield":
    case "Leveraged Farming":
      return `Add ${p} of liquidity to the main pool of ${name} on ${chain}, both sides, and hold the position.`;
    case "Perpetuals":
    case "Derivatives":
    case "Options":
      return `Paper-trade ${name} on ${chain} first, then open a small ${p} position with tight limits.`;
    case "Bridge":
      return `Bridge ${p} through ${name} to ${chain} and use the funds inside an app there.`;
    case "Liquid Staking":
    case "Liquid Restaking":
    case "Restaking":
    case "Staking Pool":
      return `Stake ${p} through ${name} on ${chain} and hold the receipt token.`;
    case "RWA":
      return `Mint ${p} of the yield-bearing asset on ${name} on ${chain} and hold it.`;
    case "Prediction Market":
      return `Take one ${p} position on a high-volume market on ${name}.`;
    case "Risk Curators":
    case "Onchain Capital Allocator":
      return `Deposit ${p} into a vault curated by ${name} on ${chain}.`;
    case "Stablecoin":
    case "Dual-Token Stablecoin":
      return `Mint or deposit ${p} of the stable asset on ${name} on ${chain}.`;
    default:
      return `Deposit ${p} of USDC into ${name} on ${chain} and use its core feature once.`;
  }
}

export function buildFarmPlan(p: SnapshotProtocol, age: number): { steps: string[]; total: PlanTotal } {
  const principal = principalFor(p.tvl_usd);
  const chain = p.chains[0] ?? "Ethereum";
  const gas = chainGas(chain);
  const holdDays = age < 180 ? 60 : age < 365 ? 45 : 30;
  const gasTxt = `Cost: ${gas.label}. Time: 20 minutes.`;
  const steps = [
    `Open a fresh wallet for this farm and write its seed phrase on paper, offline — never store it in a screenshot or a notes app. Cost: $0. Time: 10 minutes.`,
    `${categoryAction(p.category ?? "", p.name, chain, principal)} Keep the receipt in the farming wallet. Cost: ${gas.label}. Time: 20 minutes.`,
    `Repeat one qualifying action each week on ${chain} — a supply, a swap, or a vote — so the wallet shows steady use. Cost: gas only, ${gas.label}, each week. Time: 15 minutes a week.`,
    `Hold the position for ${holdDays} days so the activity lands in more than one snapshot. Cost: $0. Time: ${holdDays} days.`,
    `Claim only from ${p.name}'s own published links. Never pay anyone to claim for you, and never sign a transaction you cannot read. Cost: gas only. Time: 10 minutes.`,
    `Keep a farm log: wallet address, dates, transaction hashes, and amounts. Review it weekly and stop if the protocol pauses deposits. Cost: $0. Time: 10 minutes a week.`,
  ];
  const total: PlanTotal = {
    gasLo: +(gas.lo * 3).toFixed(2),
    gasHi: +(gas.hi * 3).toFixed(2),
    principal,
    activeMinutes: 10 + 20 + 15 + 10 + 10,
    holdDays,
    chain,
  };
  return { steps, total };
}

export function fmtUsd(v: number): string {
  if (v >= 1e9) return "$" + (v / 1e9).toFixed(1) + "B";
  if (v >= 1e6) return "$" + (v / 1e6).toFixed(1) + "M";
  return "$" + Math.round(v).toLocaleString("en-US");
}

export function fmtPct(x: number | null): string {
  if (x === null || x === undefined) return "n/a";
  return (x >= 0 ? "+" : "") + x.toFixed(1) + "%";
}

// --- The board ---

export function buildRadar(snapshot: Snapshot): RadarResult {
  const asOf = new Date(snapshot.as_of + "T00:00:00Z");
  const pool = fittingPool(snapshot);
  const fit = fitValueModel(pool);
  const loo = looValidation(pool);
  const comp = computeComparables(pool);

  const rankable = snapshot.protocols.filter(isRankable);
  const ages = rankable.map((p) => ageDays(p, asOf)).filter((a): a is number => a !== null);
  const medAge = median(ages);
  const table = looTable(pool, comp, medAge, asOf);
  const poolAges = pool.map((p) => ageDays(p, asOf)).filter((a): a is number => a !== null);
  const odds = fitLaunchOdds(snapshot, median(poolAges));

  const watchlist = new Set(snapshot.watchlist);
  const rows: BoardRow[] = rankable
    .map((p) => {
      const implied = predictValue(p.tvl_usd, fit);
      const age = ageDays(p, asOf);
      const ageUsed = age ?? medAge;
      const ageSource = age === null ? `listed_at not reported — median age ${medAge}d used` : `listed ${p.listed_at}`;
      const v3 = v3Implied(p, comp, medAge, asOf);
      const { steps, total } = buildFarmPlan(p, ageUsed);
      const chg = p.change_7d;
      let verdict = "Skip";
      let reason = "";
      if (implied >= 30_000_000 && ageUsed >= 180) {
        verdict = "Farm now";
        reason = `Implied ${fmtUsd(implied)} with ${ageUsed} days and no token`;
      } else if (implied >= 10_000_000) {
        verdict = "Watch";
        reason = `Implied ${fmtUsd(implied)} is above the $10M watch line`;
      } else if (chg !== null && chg >= 15) {
        verdict = "Watch";
        reason = `TVL up ${chg.toFixed(1)}% in 7 days`;
      } else {
        reason =
          implied < 10_000_000
            ? `Implied ${fmtUsd(implied)} is below the $10M watch line`
            : `Implied ${fmtUsd(implied)} but only ${ageUsed} days with no token`;
      }
      const whyNow =
        chg !== null && chg > 0
          ? `TVL is up ${chg.toFixed(1)}% in 7 days — activity now is more likely to land before a launch than activity later.`
          : chg !== null
            ? `TVL is down ${Math.abs(chg).toFixed(1)}% in 7 days — a quiet entry now costs less attention than a crowded one later.`
            : `No 7-day change reported — the position is judged on size and age alone.`;
      return {
        slug: p.slug,
        name: p.name,
        rank: 0,
        implied_value_usd: implied,
        tvl_usd: p.tvl_usd,
        category: p.category ?? "Unknown",
        chains: p.chains,
        change_7d: chg,
        listed_at: p.listed_at,
        age_days: ageUsed,
        age_source: ageSource,
        multiple: +(implied / p.tvl_usd).toFixed(4),
        multiple_source: `effective ratio at this TVL (fitted elasticity ${fit.slope.toFixed(3)}, OLS, n=${fit.n})`,
        momentum_factor: 1,
        maturity_factor: 1,
        verdict,
        verdict_reason: reason,
        watchlist: watchlist.has(p.slug),
        farm_steps: steps,
        interval_lo: Math.round(implied * loo.p25),
        interval_hi: Math.round(implied * loo.p75),
        global_counterfactual_usd: Math.round(p.tvl_usd * comp.global),
        v3_counterfactual_usd: v3,
        plan_total: total,
        why_now: whyNow,
      };
    })
    .sort((a, b) => b.implied_value_usd - a.implied_value_usd || (a.slug < b.slug ? -1 : 1));
  rows.forEach((r, i) => {
    r.rank = i + 1;
  });

  // Ledger: every one of the 758 protocols accounted for, in priority order.
  const ledger: LedgerBucket[] = [];
  const count = (label: string, pred: (p: SnapshotProtocol) => boolean) => {
    ledger.push({ label, count: snapshot.protocols.filter(pred).length });
  };
  count("On the board", (p) => isRankable(p));
  count("Tokened comparables", (p) => p.mcap_usd !== null && p.mcap_usd > 0);
  count("Tokened, mcap 0", (p) => p.mcap_usd === 0);
  count("Tokened, mcap -1", (p) => p.mcap_usd !== null && p.mcap_usd < 0);
  count("Listed, no market cap recorded", (p) => p.mcap_usd === null && (p.gecko_id !== null || p.symbol !== null));
  count("Version suffix", (p) => p.mcap_usd === null && p.gecko_id === null && p.symbol === null && VERSION_RE.test(p.name));
  count("Excluded category", (p) => p.mcap_usd === null && p.gecko_id === null && p.symbol === null && !VERSION_RE.test(p.name) && EXCLUDED_CATEGORIES.has(p.category ?? ""));
  count("Wrapped / staked name", (p) => p.mcap_usd === null && p.gecko_id === null && p.symbol === null && !VERSION_RE.test(p.name) && !EXCLUDED_CATEGORIES.has(p.category ?? "") && WRAPPED_RE.test(p.name));
  count("Exchange prefix", (p) => p.mcap_usd === null && p.gecko_id === null && p.symbol === null && !VERSION_RE.test(p.name) && !EXCLUDED_CATEGORIES.has(p.category ?? "") && !WRAPPED_RE.test(p.name) && EXCHANGE_PREFIXES.some((x) => p.name.startsWith(x)));
  count("TVL below $5M", (p) => p.mcap_usd === null && p.gecko_id === null && p.symbol === null && !VERSION_RE.test(p.name) && !EXCLUDED_CATEGORIES.has(p.category ?? "") && !WRAPPED_RE.test(p.name) && !EXCHANGE_PREFIXES.some((x) => p.name.startsWith(x)) && p.tvl_usd < 5_000_000);

  const live = pool
    .slice()
    .sort((a, b) => b.mcap_usd! - a.mcap_usd!)
    .slice(0, 24)
    .map((p) => ({
      name: p.name,
      mcap: p.mcap_usd!,
      tvl: p.tvl_usd,
      category: p.category ?? "Unknown",
      ratio: p.mcap_usd! / p.tvl_usd,
    }));

  return {
    asOf: snapshot.as_of,
    fit,
    loo,
    looTable: table,
    oddsAuc: odds.auc,
    globalMedian: comp.global,
    medAge,
    ledger,
    rows,
    live,
  };
}
