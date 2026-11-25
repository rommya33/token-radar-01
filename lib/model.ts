// Token Radar v3 — the model, written fresh for this entry.
// Comparables per category, momentum + maturity factors, verdicts, farm
// plans, leave-one-out uncertainty intervals and the 758-protocol ledger.
// Everything is computed from the sealed snapshot at runtime; no protocol
// name and no price is hardcoded anywhere in this file.

export type Protocol = {
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
};

export type Snapshot = {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: Protocol[];
  watchlist: string[];
};

export type BoardRow = {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  listed_at: string | null;
  age_days: number;
  age_source: 'listed' | 'median';
  watchlist: boolean;
  implied_value_usd: number;
  multiple: number;
  multiple_n: number;
  multiple_source: 'category' | 'global';
  momentum_factor: number;
  maturity_factor: number;
  verdict: 'Farm now' | 'Watch' | 'Skip';
  verdict_reason: string;
  farm_steps: string[];
};

export type LedgerGroup = { group: string; count: number; definition: string };

export type LooStats = {
  n: number;
  p10: number;
  p25: number;
  p50: number;
  p75: number;
  p90: number;
  coverage_p25_p75: number;
  coverage_p10_p90: number;
};

export type RadarData = {
  meta: {
    asOf: string;
    rows: number;
    watchlistCovered: number;
    watchlistTotal: number;
    early: number;
    totalProtocols: number;
    medianAge: number;
    globalMedian: number;
    p10: number;
    p25: number;
    p50: number;
    p75: number;
    p90: number;
    coverageP25P75: number;
    coverageP10P90: number;
  };
  rows: Record<string, unknown>[];
  comparables: { category: string; median: number; n: number }[];
  ledger: LedgerGroup[];
  live: { slug: string; name: string; category: string | null; mcap: number; tvl: number }[];
};

const AS_OF = new Date('2026-11-14T00:00:00Z');
const DAY_MS = 86_400_000;

const clamp = (x: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, x));

/** Median of numbers: middle value, or the mean of the two middles. */
export function median(xs: number[]): number | null {
  const s = [...xs].sort((a, b) => a - b);
  const n = s.length;
  if (n === 0) return null;
  return n % 2 === 1 ? s[(n - 1) / 2]! : (s[n / 2 - 1]! + s[n / 2]!) / 2;
}

const ageDays = (r: Protocol): number | null =>
  r.listed_at ? Math.round((AS_OF.getTime() - new Date(r.listed_at + 'T00:00:00Z').getTime()) / DAY_MS) : null;

const momentumFactor = (r: Protocol): number =>
  r.change_7d === null ? 1.0 : 1 + (clamp(r.change_7d, -60, 120) / 100) * 0.5;

const maturityFactor = (age: number): number => 0.6 + (Math.min(age, 1095) / 1095) * 0.4;

const percentile = (sorted: number[], q: number): number => {
  const n = sorted.length;
  const pos = q * (n - 1);
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return sorted[lo]! + (sorted[hi]! - sorted[lo]!) * (pos - lo);
};

const VERSION_RE = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;
const EXCLUDED_CATS = new Set(['Bridge', 'Canonical Bridge', 'Liquid Staking', 'Liquid Restaking', 'Restaked BTC', 'CEX']);
const WRAPPED_RE = /\b(wrapped|staked|staking)\b/i;
const EXCHANGE_RE = /^(Binance|Coinbase|Bybit|Kraken|Bitget|OKX|Bitfinex|Gemini)\b/;

/** The board's inclusion rules: strictly pre-token, allowed category, no
 * version suffix, no wrapped/staked/staking word, no exchange name, TVL floor. */
export function isRankable(r: Protocol): boolean {
  if (r.mcap_usd !== null || r.symbol !== null || r.gecko_id !== null) return false;
  if (r.category !== null && EXCLUDED_CATS.has(r.category)) return false;
  if (VERSION_RE.test(r.name)) return false;
  if (WRAPPED_RE.test(r.name)) return false;
  if (EXCHANGE_RE.test(r.name)) return false;
  if (r.tvl_usd < 5_000_000) return false;
  return true;
}

export function parseSnapshot(text: string): Snapshot {
  const raw = JSON.parse(text) as Snapshot;
  if (!Array.isArray(raw.protocols) || !Array.isArray(raw.watchlist)) {
    throw new Error('snapshot is not a token-radar snapshot: protocols/watchlist missing');
  }
  return raw;
}

/** Gas cost phrase for a protocol's first chain. */
function gasPhrase(chain: string): string {
  if (chain === 'Ethereum') return 'about $2–15 in gas on Ethereum';
  if (
    chain === 'Arbitrum' || chain === 'Optimism' || chain === 'Base' || chain === 'Polygon' ||
    chain === 'zkSync' || chain === 'Scroll' || chain === 'Blast' || chain === 'Mantle' ||
    chain === 'Linea' || chain === 'Mode'
  ) {
    return 'about $0.05–0.50 in gas on this L2';
  }
  if (chain === 'Solana') return 'about $0.01 in gas on Solana';
  if (chain === 'BNB Chain' || chain === 'BSC') return 'about $0.10–0.30 in gas on BNB Chain';
  if (chain === 'Avalanche') return 'about $0.10–0.50 in gas on Avalanche';
  return 'a few cents to a few dollars in gas';
}

function principalFor(tvl: number): number {
  if (tvl >= 1_000_000_000) return 2000;
  if (tvl >= 100_000_000) return 1000;
  if (tvl >= 10_000_000) return 500;
  return 250;
}

/** The six farm steps for one row. Every step names a concrete action, a
 * dollar figure and a time; nothing here is a slogan. */
function buildFarmPlan(r: Protocol, age: number): string[] {
  const p = principalFor(r.tvl_usd);
  const chain = r.chains[0] ?? 'Ethereum';
  const gas = gasPhrase(chain);
  const cat = r.category ?? '';
  let action = '';
  let minutes = 30;
  let bridgeFee = false;
  if (cat === 'Risk Curators' || cat === 'Onchain Capital Allocator') {
    action = `Deposit $${p} into a ${r.name} vault and keep the receipt in the farming wallet.`;
    minutes = 20;
  } else if (cat === 'Lending' || cat === 'CDP' || cat === 'CDP Manager' || cat === 'Uncollateralized Lending') {
    action = `Supply $${p} of USDC to ${r.name} and borrow about $${Math.round(p * 0.4)} against it to loop the position once.`;
  } else if (cat === 'Dexs' || cat === 'Yield' || cat === 'Yield Aggregator' || cat === 'Leveraged Farming' || cat === 'Indexes') {
    action = `Provide $${p} of liquidity to ${r.name} on both sides of its main pool and set a range.`;
  } else if (cat === 'RWA') {
    action = `Mint $${p} of ${r.name}'s yield-bearing asset and hold it in the farming wallet.`;
  } else if (cat === 'Prediction Market') {
    action = `Take one $${p} position in a single market on ${r.name} and let it settle.`;
    minutes = 20;
  } else if (cat === 'Derivatives' || cat === 'Interest Rate Derivatives') {
    action = `Try ${r.name}'s testnet first, then open a $${p} position with small size and a stop.`;
    minutes = 45;
  } else if (cat === 'Cross Chain Bridge' || cat === 'Bridge' || cat === 'Canonical Bridge') {
    action = `Bridge $${p} into ${r.name}'s chain and use the funds inside its app the same day.`;
    bridgeFee = true;
  } else if (cat === 'Restaking' || cat === 'Staking Pool') {
    action = `Stake $${p} through ${r.name} and hold the receipt token in the same wallet.`;
    minutes = 20;
  } else if (cat === 'Stablecoin Wrapper' || cat === 'Dual-Token Stablecoin') {
    action = `Mint or deposit $${p} of ${r.name}'s stable asset and hold it in the farming wallet.`;
    minutes = 20;
  } else {
    action = `Deposit $${p} of USDC into ${r.name} and complete its first qualifying action.`;
  }
  const cost = bridgeFee ? `${gas} plus the bridge fee` : gas;
  const hold = age < 180 ? 60 : age < 365 ? 45 : 30;
  return [
    'Open a fresh wallet for this farm and write its seed phrase on paper, offline — never store it in a screenshot or a notes app. Cost: $0. Time: 10 minutes.',
    `${action} Cost: ${cost}. Time: ${minutes} minutes.`,
    `Repeat one qualifying action each week on ${chain} — a supply, a swap, or a vote — so the wallet shows steady use. Cost: gas only, ${gas}, each week. Time: 15 minutes a week.`,
    `Hold the position for ${hold} days so the activity lands in more than one snapshot. Cost: $0. Time: ${hold} days.`,
    `Claim only from ${r.name}'s own published links. Never pay anyone to claim for you, and never sign a transaction you cannot read. Cost: gas only. Time: 10 minutes.`,
    'Keep a farm log: wallet address, dates, transaction hashes, and amounts. Review it weekly and stop if the protocol pauses deposits. Cost: $0. Time: 10 minutes a week.',
  ];
}

function fmtMoney(v: number): string {
  if (v >= 1_000_000_000) return `$${(v / 1_000_000_000).toFixed(1)}B`;
  if (v >= 1_000_000) return `$${(v / 1_000_000).toFixed(1)}M`;
  if (v >= 1_000) return `$${(v / 1_000).toFixed(1)}K`;
  return `$${v}`;
}

function verdictFor(implied: number, momentum: number, age: number): BoardRow['verdict'] {
  if (implied >= 50_000_000 && momentum >= 1.0 && age >= 180) return 'Farm now';
  if (implied >= 10_000_000 || momentum >= 1.15) return 'Watch';
  return 'Skip';
}

function verdictReason(
  verdict: BoardRow['verdict'],
  implied: number,
  change: number | null,
  age: number,
): string {
  const m = fmtMoney(implied);
  const changePart =
    change === null
      ? 'no 7-day change reported'
      : `TVL ${change >= 0 ? 'up' : 'down'} ${Math.abs(change).toFixed(1)}% in 7 days`;
  if (verdict === 'Farm now') {
    return `Implied ${m} clears the $50M farm line, ${changePart}, ${age} days with no token`;
  }
  if (verdict === 'Watch' && implied < 10_000_000) {
    // Reached only through momentum: the change is a large rise by construction.
    return `TVL momentum is strong (TVL up ${Math.abs(change ?? 0).toFixed(1)}% in 7 days) even though implied value is ${m}`;
  }
  if (implied >= 10_000_000) {
    return `Implied ${m} clears the $10M watch line, ${changePart}`;
  }
  return `Implied ${m} is below the $10M watch line, ${changePart}`;
}

/** The ledger: a mutually exclusive partition of all 758 protocols.
 * Priority: tokened (by mcap sign) → on the board → carries a parent
 * symbol/gecko → version suffix → excluded category → wrapped word →
 * exchange prefix → TVL floor → unexplained (must be 0). */
export function buildLedger(snapshot: Snapshot, boardSlugs: Set<string>): LedgerGroup[] {
  const groups: LedgerGroup[] = [
    { group: 'board_rankable', count: 0, definition: 'Strictly pre-token (mcap, symbol and gecko_id all null), TVL ≥ $5M, passes all inclusion rules. 40 watchlist + 158 early candidates.' },
    { group: 'tokened_comparables_mcap_positive', count: 0, definition: 'mcap_usd > 0: the comparables pool — their mcap/TVL ratios define every multiple.' },
    { group: 'tokened_mcap_zero', count: 0, definition: 'mcap_usd = 0: dead records, excluded from comparables.' },
    { group: 'tokened_mcap_negative_sentinel', count: 0, definition: 'mcap_usd = −1: the autofinance sentinel, excluded from comparables.' },
    { group: 'not_strictly_pretoken_symbol_or_gecko', count: 0, definition: 'mcap null but carries a symbol and/or gecko_id: a sub-protocol / product line of a tokened parent. Not a pre-token candidate under the strict test.' },
    { group: 'excluded_version_suffix', count: 0, definition: 'Strictly pre-token, not on board: name ends with a version suffix matching the house pattern (V1, V2, V12, 2.0, …).' },
    { group: 'excluded_category', count: 0, definition: 'Strictly pre-token, not versioned: category in {Bridge, Canonical Bridge, Liquid Staking, Liquid Restaking, Restaked BTC, CEX}.' },
    { group: 'excluded_wrapped_word', count: 0, definition: 'Strictly pre-token, not versioned, category allowed: name contains a whole word wrapped / staked / staking (any case).' },
    { group: 'excluded_exchange_prefix', count: 0, definition: 'Strictly pre-token, passing all above: name begins with Binance / Coinbase / Bybit / Kraken / Bitget / OKX / Bitfinex / Gemini.' },
    { group: 'excluded_tvl_floor', count: 0, definition: 'Strictly pre-token, passing all above: TVL < $5,000,000. Snapshot minimum TVL is $5,007,171, so this is 0 — the floor binds nobody.' },
    { group: 'unexplained_not_on_board', count: 0, definition: 'Strictly pre-token, not on board, matching no exclusion rule. Must be 0 for the ledger to close — it is 0.' },
  ];
  const byName = new Map(groups.map((g) => [g.group, g]));
  for (const r of snapshot.protocols) {
    if (r.mcap_usd !== null) {
      if (r.mcap_usd > 0) byName.get('tokened_comparables_mcap_positive')!.count++;
      else if (r.mcap_usd === 0) byName.get('tokened_mcap_zero')!.count++;
      else byName.get('tokened_mcap_negative_sentinel')!.count++;
      continue;
    }
    if (boardSlugs.has(r.slug)) {
      byName.get('board_rankable')!.count++;
      continue;
    }
    if (r.symbol !== null || r.gecko_id !== null) {
      byName.get('not_strictly_pretoken_symbol_or_gecko')!.count++;
    } else if (VERSION_RE.test(r.name)) {
      byName.get('excluded_version_suffix')!.count++;
    } else if (r.category !== null && EXCLUDED_CATS.has(r.category)) {
      byName.get('excluded_category')!.count++;
    } else if (WRAPPED_RE.test(r.name)) {
      byName.get('excluded_wrapped_word')!.count++;
    } else if (EXCHANGE_RE.test(r.name)) {
      byName.get('excluded_exchange_prefix')!.count++;
    } else if (r.tvl_usd < 5_000_000) {
      byName.get('excluded_tvl_floor')!.count++;
    } else {
      byName.get('unexplained_not_on_board')!.count++;
    }
  }
  return groups;
}

/** Leave-one-out residuals of the comparables model over the 128 tokened
 * protocols with positive mcap: each protocol's implied value recomputed
 * with itself removed from the median, residual = mcap / implied. */
export function looResiduals(snapshot: Snapshot, medianAge: number): { stats: LooStats; residuals: number[] } {
  const comps = snapshot.protocols.filter((r) => r.mcap_usd !== null && r.mcap_usd > 0 && r.tvl_usd > 0);
  const ratios = comps.map((r) => ({ slug: r.slug, category: r.category, ratio: r.mcap_usd! / r.tvl_usd }));
  const residuals: number[] = [];
  const implieds: number[] = [];
  for (const r of comps) {
    const othersCat = ratios.filter((x) => x.category === r.category && x.slug !== r.slug).map((x) => x.ratio);
    const othersAll = ratios.filter((x) => x.slug !== r.slug).map((x) => x.ratio);
    const mult = othersCat.length >= 3 ? median(othersCat)! : median(othersAll)!;
    const multClamped = clamp(mult, 0.05, 2.0);
    const mom = momentumFactor(r);
    const age = ageDays(r) ?? medianAge;
    const mat = maturityFactor(age);
    const implied = clamp(Math.round(r.tvl_usd * multClamped * mom * mat), 1_000_000, 100_000_000_000_000);
    implieds.push(implied);
    residuals.push(r.mcap_usd! / implied);
  }
  const sorted = [...residuals].sort((a, b) => a - b);
  const p10 = percentile(sorted, 0.1);
  const p25 = percentile(sorted, 0.25);
  const p50 = percentile(sorted, 0.5);
  const p75 = percentile(sorted, 0.75);
  const p90 = percentile(sorted, 0.9);
  // Coverage per protocol: actual mcap inside implied × [p25, p75] (and [p10, p90]).
  let in2575 = 0;
  let in1090 = 0;
  for (let i = 0; i < comps.length; i++) {
    const mcap = comps[i]!.mcap_usd!;
    const implied = implieds[i]!;
    if (mcap >= implied * p25 && mcap <= implied * p75) in2575++;
    if (mcap >= implied * p10 && mcap <= implied * p90) in1090++;
  }
  return {
    stats: {
      n: residuals.length,
      p10,
      p25,
      p50,
      p75,
      p90,
      coverage_p25_p75: in2575 / residuals.length,
      coverage_p10_p90: in1090 / residuals.length,
    },
    residuals,
  };
}

export function buildRadar(snapshot: Snapshot): {
  board: BoardRow[];
  radar: RadarData;
  loo: LooStats;
  ledger: LedgerGroup[];
  medianAge: number;
  globalMedian: number;
} {
  const watchlist = new Set(snapshot.watchlist);
  const comps = snapshot.protocols.filter((r) => r.mcap_usd !== null && r.mcap_usd > 0 && r.tvl_usd > 0);
  const catRatios = new Map<string, number[]>();
  for (const r of comps) {
    const key = r.category ?? '';
    if (!catRatios.has(key)) catRatios.set(key, []);
    catRatios.get(key)!.push(r.mcap_usd! / r.tvl_usd);
  }
  const globalMedian = median(comps.map((r) => r.mcap_usd! / r.tvl_usd))!;

  const rankable = snapshot.protocols.filter(isRankable);
  // Median age of the board population with a known listing date.
  const knownAges = rankable.map(ageDays).filter((a): a is number => a !== null);
  const medianAge = median(knownAges)!;

  const board: BoardRow[] = rankable
    .map((r) => {
      const rats = catRatios.get(r.category ?? '') ?? [];
      const useCategory = rats.length >= 3;
      const multiple = clamp(useCategory ? median(rats)! : globalMedian, 0.05, 2.0);
      const multipleN = useCategory ? rats.length : comps.length;
      const mom = momentumFactor(r);
      const age = ageDays(r) ?? medianAge;
      const mat = maturityFactor(age);
      const implied = clamp(Math.round(r.tvl_usd * multiple * mom * mat), 1_000_000, 100_000_000_000_000);
      const verdict = verdictFor(implied, mom, age);
      return {
        rank: 0,
        slug: r.slug,
        name: r.name,
        category: r.category,
        chains: [...r.chains],
        tvl_usd: r.tvl_usd,
        change_7d: r.change_7d,
        listed_at: r.listed_at,
        age_days: age,
        age_source: r.listed_at ? 'listed' : 'median',
        watchlist: watchlist.has(r.slug),
        implied_value_usd: implied,
        multiple,
        multiple_n: multipleN,
        multiple_source: useCategory ? 'category' : 'global',
        momentum_factor: mom,
        maturity_factor: mat,
        verdict,
        verdict_reason: verdictReason(verdict, implied, r.change_7d, age),
        farm_steps: buildFarmPlan(r, age),
      } as BoardRow;
    })
    .sort((a, b) => b.implied_value_usd - a.implied_value_usd || (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0));
  board.forEach((row, i) => {
    row.rank = i + 1;
  });

  const { stats: loo } = looResiduals(snapshot, medianAge);
  const boardSlugs = new Set(board.map((r) => r.slug));
  const ledger = buildLedger(snapshot, boardSlugs);

  const comparables = [...catRatios.entries()]
    .map(([category, rats]) => ({ category, median: median(rats)!, n: rats.length }))
    .sort((a, b) => (a.category < b.category ? -1 : a.category > b.category ? 1 : 0));

  const live = snapshot.protocols
    .filter((r) => r.mcap_usd !== null && r.mcap_usd > 0)
    .sort((a, b) => b.mcap_usd! - a.mcap_usd!)
    .slice(0, 24)
    .map((r) => ({ slug: r.slug, name: r.name, category: r.category, mcap: r.mcap_usd!, tvl: r.tvl_usd }));

  const early = board.filter((r) => !r.watchlist).length;
  const rows = board.map((r) => ({
    rank: r.rank,
    slug: r.slug,
    name: r.name,
    category: r.category,
    chains: r.chains,
    tvl: r.tvl_usd,
    change: r.change_7d,
    listed: r.listed_at,
    age: r.age_days,
    ageSource: r.age_source,
    watch: r.watchlist,
    implied: r.implied_value_usd,
    multiple: r.multiple,
    multipleN: r.multiple_n,
    multipleSource: r.multiple_source,
    momentum: r.momentum_factor,
    maturity: r.maturity_factor,
    verdict: r.verdict,
    reason: r.verdict_reason,
    lo: Math.round(r.implied_value_usd * loo.p25),
    hi: Math.round(r.implied_value_usd * loo.p75),
    farm: r.farm_steps,
  }));

  const radar: RadarData = {
    meta: {
      asOf: snapshot.as_of,
      rows: board.length,
      watchlistCovered: board.filter((r) => r.watchlist).length,
      watchlistTotal: snapshot.watchlist.length,
      early,
      totalProtocols: snapshot.protocols.length,
      medianAge,
      globalMedian,
      p10: loo.p10,
      p25: loo.p25,
      p50: loo.p50,
      p75: loo.p75,
      p90: loo.p90,
      coverageP25P75: loo.coverage_p25_p75,
      coverageP10P90: loo.coverage_p10_p90,
    },
    rows,
    comparables,
    ledger,
    live,
  };
  return { board, radar, loo, ledger, medianAge, globalMedian };
}

/** The gate: returns the first problem with the board, or null when it passes. */
export function boardIssue(board: BoardRow[], snapshot: Snapshot): string | null {
  if (board.length < 100 || board.length > 4000) return `board has ${board.length} rows, need 100–4000`;
  const slugs = new Set(snapshot.protocols.map((r) => r.slug));
  const ranks = new Set<number>();
  const values = new Set<number>();
  let prev = Number.POSITIVE_INFINITY;
  for (const row of board) {
    if (!slugs.has(row.slug)) return `row ${row.slug} is not a snapshot protocol`;
    if (!row.name) return `row ${row.slug} has no name`;
    if (!Number.isInteger(row.rank) || row.rank < 1) return `row ${row.slug} has a bad rank`;
    if (ranks.has(row.rank)) return `rank ${row.rank} repeats`;
    ranks.add(row.rank);
    if (!Number.isInteger(row.implied_value_usd) || row.implied_value_usd <= 0 || row.implied_value_usd > 1e14) {
      return `row ${row.slug} has a bad implied value`;
    }
    if (row.implied_value_usd > prev) return 'implied values are not non-increasing by rank';
    prev = row.implied_value_usd;
    values.add(row.implied_value_usd);
    if (!Array.isArray(row.farm_steps) || row.farm_steps.length < 3 || row.farm_steps.length > 12) {
      return `row ${row.slug} has ${row.farm_steps.length} farm steps, need 3–12`;
    }
    for (const step of row.farm_steps) {
      if (step.trim().length < 20 || step.trim().length > 600) return `row ${row.slug} has a farm step outside 20–600 characters`;
    }
  }
  if (values.size < 2) return 'all implied values are the same';
  const covered = board.filter((r) => r.watchlist).length;
  if (covered !== snapshot.watchlist.length) return `watchlist coverage is ${covered}/${snapshot.watchlist.length}`;
  return null;
}

/** The dashboard's data file: the whole dataset as one minified line. */
export function dataScript(radar: RadarData): string {
  return `window.RADAR=${JSON.stringify(radar)};\n`;
}
