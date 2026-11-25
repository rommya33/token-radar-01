/**
 * Token Radar — the value model.
 *
 * Every figure in the board is derived from the sealed snapshot alone:
 * a protocol's TVL, the median market-cap/TVL of tokened protocols in its
 * own category (its comparables), its seven-day TVL change, and how long
 * it has run with no token recorded. No protocol name and no price is
 * hardcoded anywhere in this file.
 */

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

/** One category's comparables: the median mcap/TVL the model uses, and how many tokened protocols back it. */
export interface ComparableRow {
  category: string;
  median: number;
  n: number;
  source: 'category' | 'global';
}

export interface Comparables {
  globalMedian: number;
  globalN: number;
  byCategory: Map<string, ComparableRow>;
  /** Every category with at least one tokened comparable, most comparables first, name as tie-break. */
  table: ComparableRow[];
}

/** The bounds the model never leaves. */
export const MULTIPLE_MIN = 0.05;
export const MULTIPLE_MAX = 2.0;
export const IMPLIED_MIN = 1_000_000;
export const IMPLIED_MAX = 100_000_000_000_000;
export const MOMENTUM_CLAMP_LOW = -60;
export const MOMENTUM_CLAMP_HIGH = 120;
export const MATURITY_CAP_DAYS = 1095;
export const BOARD_MIN_TVL = 5_000_000;
export const FARM_LINE_USD = 50_000_000;
export const WATCH_LINE_USD = 10_000_000;
export const WATCH_MOMENTUM = 1.15;
export const FARM_MIN_AGE_DAYS = 180;

const EXCLUDED_CATEGORIES = new Set([
  'Bridge',
  'Canonical Bridge',
  'Liquid Staking',
  'Liquid Restaking',
  'Restaked BTC',
  'CEX',
]);

const EXCHANGE_PREFIXES = [
  'Binance',
  'Coinbase',
  'Bybit',
  'Kraken',
  'Bitget',
  'OKX',
  'Bitfinex',
  'Gemini',
];

const VERSION_SUFFIXES = [' V2', ' v2', ' 2.0', ' V3', ' v3', ' 3.0'];

/** The median of a list of numbers: the sorted middle, or the mean of the two middles for even counts. */
export function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const n = sorted.length;
  if (n === 0) throw new Error('median of an empty list');
  const mid = Math.floor(n / 2);
  return n % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

/** A protocol records no token when DefiLlama carries no market cap, no Gecko id and no symbol for it. */
export function isPreToken(p: SnapshotProtocol): boolean {
  return p.mcap_usd === null && p.gecko_id === null && p.symbol === null;
}

/**
 * The house rule for a rankable protocol: it records no token, it is not a
 * wrapped, staked or bridged product of a token that already trades, it is
 * not a centralised exchange, its name carries no version marker and no
 * whole word wrapped / staked / staking, and it does not begin with an
 * exchange's name.
 */
export function isRankable(p: SnapshotProtocol): boolean {
  if (!isPreToken(p)) return false;
  if (p.category !== null && EXCLUDED_CATEGORIES.has(p.category)) return false;
  if (EXCHANGE_PREFIXES.some((prefix) => p.name.startsWith(prefix))) return false;
  const words = p.name.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 0);
  if (words.some((w) => w === 'wrapped' || w === 'staked' || w === 'staking')) return false;
  if (VERSION_SUFFIXES.some((suffix) => p.name.endsWith(suffix))) return false;
  return true;
}

/**
 * The comparables: for each category, the median mcap/TVL of its tokened
 * protocols. A category median is used only when at least three tokened
 * protocols back it; anything thinner falls back to the global median over
 * all tokened protocols. Every multiple is clamped to [0.05, 2.0], which
 * neuters wild single-comparable categories twice over.
 */
export function computeComparables(protocols: SnapshotProtocol[]): Comparables {
  const ratiosByCategory = new Map<string, number[]>();
  const allRatios: number[] = [];
  for (const p of protocols) {
    // A zero market cap is a dead record, not a price: only a positive
    // market cap over a positive TVL is a comparable.
    if (p.mcap_usd === null || p.mcap_usd <= 0 || p.tvl_usd <= 0 || p.category === null) continue;
    const ratio = p.mcap_usd / p.tvl_usd;
    allRatios.push(ratio);
    const list = ratiosByCategory.get(p.category);
    if (list === undefined) ratiosByCategory.set(p.category, [ratio]);
    else list.push(ratio);
  }
  const globalMedian = median(allRatios);
  const byCategory = new Map<string, ComparableRow>();
  for (const [category, ratios] of ratiosByCategory) {
    const n = ratios.length;
    const row: ComparableRow =
      n >= 3
        ? { category, median: clamp(median(ratios), MULTIPLE_MIN, MULTIPLE_MAX), n, source: 'category' }
        : { category, median: clamp(globalMedian, MULTIPLE_MIN, MULTIPLE_MAX), n, source: 'global' };
    byCategory.set(category, row);
  }
  const table = [...byCategory.values()].sort((a, b) => b.n - a.n || (a.category < b.category ? -1 : 1));
  return { globalMedian: clamp(globalMedian, MULTIPLE_MIN, MULTIPLE_MAX), globalN: allRatios.length, byCategory, table };
}

/** The multiple a category's protocols are valued at: its own median, or the global median when thin. */
export function multipleFor(category: string | null, comparables: Comparables): ComparableRow {
  if (category !== null) {
    const row = comparables.byCategory.get(category);
    if (row !== undefined) return row;
  }
  return { category: category ?? '(no category)', median: comparables.globalMedian, n: 0, source: 'global' };
}

export function clamp(value: number, low: number, high: number): number {
  return Math.min(high, Math.max(low, value));
}

/**
 * The momentum factor: the seven-day TVL change, clamped to [-60, 120]%,
 * moves the value by half its size. A protocol whose change is not
 * reported gets a neutral 1.0.
 */
export function momentumFactor(change7d: number | null): number {
  if (change7d === null) return 1.0;
  const clamped = clamp(change7d, MOMENTUM_CLAMP_LOW, MOMENTUM_CLAMP_HIGH);
  return 1 + (clamped / 100) * 0.5;
}

/**
 * The maturity factor: a protocol earns from 0.6 at listing up to 1.0 after
 * three years with no token. Older, longer-running protocols are worth
 * more of their comparable multiple.
 */
export function maturityFactor(ageDays: number): number {
  return 0.6 + (Math.min(ageDays, MATURITY_CAP_DAYS) / MATURITY_CAP_DAYS) * 0.4;
}

/** Whole days between two UTC dates written as YYYY-MM-DD. */
export function daysBetween(fromIso: string, toIso: string): number {
  const from = Date.UTC(
    Number(fromIso.slice(0, 4)),
    Number(fromIso.slice(5, 7)) - 1,
    Number(fromIso.slice(8, 10)),
  );
  const to = Date.UTC(
    Number(toIso.slice(0, 4)),
    Number(toIso.slice(5, 7)) - 1,
    Number(toIso.slice(8, 10)),
  );
  return Math.round((to - from) / 86_400_000);
}

/** A protocol's age in days at the snapshot date, or null when its listing date is not reported. */
export function ageDaysOf(p: SnapshotProtocol, asOf: string): number | null {
  if (p.listed_at === null) return null;
  return daysBetween(p.listed_at, asOf);
}

/** The median age of the given protocols that report a listing date. */
export function medianAgeDays(protocols: SnapshotProtocol[], asOf: string): number {
  const ages: number[] = [];
  for (const p of protocols) {
    const age = ageDaysOf(p, asOf);
    if (age !== null) ages.push(age);
  }
  return median(ages);
}

/**
 * The implied value: TVL times the comparable multiple, times momentum,
 * times maturity, rounded to whole dollars and clamped to
 * [$1M, $100T]. The multiple already carries the concentration
 * adjustment (the [0.05, 2.0] clamp in computeComparables).
 */
export function impliedValueUsd(tvlUsd: number, multiple: number, momentum: number, maturity: number): number {
  const raw = Math.round(tvlUsd * multiple * momentum * maturity);
  return clamp(raw, IMPLIED_MIN, IMPLIED_MAX);
}

/** One line of the model walk-through, as the detail view shows it. */
export interface Walkthrough {
  tvlLine: string;
  multipleLine: string;
  momentumLine: string;
  maturityLine: string;
  resultLine: string;
}

const usdFull = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
const usdCompact = (value: number): string => {
  if (value >= 1_000_000_000) return `$${(value / 1_000_000_000).toFixed(2)}B`;
  if (value >= 1_000_000) return `$${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `$${(value / 1_000).toFixed(1)}K`;
  return usdFull.format(value);
};

export function formatUsdCompact(value: number): string {
  return usdCompact(value);
}

export function formatUsdFull(value: number): string {
  return usdFull.format(value);
}

/** "TVL up 8.3% in 7 days" / "TVL down 12.0% in 7 days" / "7-day change not reported". */
export function changeText(change7d: number | null): string {
  if (change7d === null) return '7-day change not reported';
  if (change7d > 0) return `TVL up ${change7d.toFixed(1)}% in 7 days`;
  if (change7d < 0) return `TVL down ${Math.abs(change7d).toFixed(1)}% in 7 days`;
  return 'TVL flat over 7 days';
}

/** The verdict a row earns, with the one decisive reason computed from its own numbers. */
export function verdictFor(implied: number, momentum: number, change7d: number | null, ageDays: number): { verdict: string; reason: string } {
  const change = changeText(change7d);
  if (implied >= FARM_LINE_USD && momentum >= 1.0 && ageDays >= FARM_MIN_AGE_DAYS) {
    return {
      verdict: 'Farm now',
      reason: `Implied value ${usdCompact(implied)} — above the $50M farm line. ${change}; ${ageDays} days with no token.`,
    };
  }
  if (implied >= WATCH_LINE_USD) {
    return {
      verdict: 'Watch',
      reason: `Implied value ${usdCompact(implied)} — above the $10M watch line. ${change}; ${ageDays} days with no token.`,
    };
  }
  if (momentum >= WATCH_MOMENTUM) {
    return {
      verdict: 'Watch',
      reason: `${change} — momentum factor ${momentum.toFixed(2)} is above the 1.15 watch line, even though implied value ${usdCompact(implied)} is below $10M.`,
    };
  }
  return {
    verdict: 'Skip',
    reason: `Implied value ${usdCompact(implied)} — below the $10M watch line. ${change}.`,
  };
}

/** The farming principal for a TVL band: $2,000 at $1B+, $1,000 at $100M+, $500 at $10M+, else $250. */
export function principalFor(tvlUsd: number): number {
  if (tvlUsd >= 1_000_000_000) return 2000;
  if (tvlUsd >= 100_000_000) return 1000;
  if (tvlUsd >= 10_000_000) return 500;
  return 250;
}

/** The gas profile of a chain, from the protocol's first listed chain. */
export function gasProfileFor(chain: string | null): string {
  if (chain === 'Ethereum') return 'L1 gas $2–15 per transaction';
  if (
    chain === 'Arbitrum' ||
    chain === 'Optimism' ||
    chain === 'Base' ||
    chain === 'Polygon' ||
    chain === 'zkSync' ||
    chain === 'Scroll' ||
    chain === 'Blast' ||
    chain === 'Mantle' ||
    chain === 'Linea' ||
    chain === 'Mode'
  ) {
    return 'L2 gas $0.05–0.50 per transaction';
  }
  if (chain === 'Solana') return '$0.01 per transaction';
  if (chain === 'BNB Chain' || chain === 'BSC') return '$0.10–0.30 per transaction';
  if (chain === 'Avalanche') return '$0.10–0.50 per transaction';
  return 'a few cents to a few dollars per transaction';
}

interface CategoryPlan {
  action: (name: string, principal: number, chain: string) => string;
  weekly: string;
}

function categoryPlan(category: string | null): CategoryPlan {
  const c = (category ?? '').toLowerCase();
  if (c.includes('lending') || c.includes('cdp')) {
    return {
      action: (name, principal) =>
        `Supply $${principal.toLocaleString('en-US')} of USDC to ${name} and borrow a small amount back to open the supply-and-borrow loop.`,
      weekly: 'supply a little more or repay a little',
    };
  }
  if (c.includes('dex') || c.includes('yield') || c.includes('leveraged farming')) {
    return {
      action: (name, principal) =>
        `Provide $${principal.toLocaleString('en-US')} of liquidity to ${name} in equal parts of both sides of a pool, inside a narrow range.`,
      weekly: 'add or remove a little liquidity',
    };
  }
  if (c.includes('perpetual') || c.includes('derivative')) {
    return {
      action: (name, principal) =>
        `Open a small test position on ${name} first, then repeat it live with $${principal.toLocaleString('en-US')} once the mechanics are clear.`,
      weekly: 'open one small position',
    };
  }
  if (c.includes('bridge')) {
    return {
      action: (name, principal, chain) =>
        `Bridge $${principal.toLocaleString('en-US')} of USDC through ${name} to ${chain}, then use the funds inside an app on that chain.`,
      weekly: 'bridge a small amount and use it in-app',
    };
  }
  if (c.includes('staking') || c.includes('restaking')) {
    return {
      action: (name, principal) =>
        `Stake $${principal.toLocaleString('en-US')} with ${name} and hold the staking receipt it issues.`,
      weekly: 'stake a little more or restake rewards',
    };
  }
  if (c.includes('rwa')) {
    return {
      action: (name, principal) => `Mint $${principal.toLocaleString('en-US')} of ${name}'s yield-bearing asset.`,
      weekly: 'mint a little more of the yield asset',
    };
  }
  if (c.includes('prediction')) {
    return {
      action: (name, principal) => `Take a $${principal.toLocaleString('en-US')} position in one market on ${name}.`,
      weekly: 'take one small market position',
    };
  }
  if (c.includes('curator') || c.includes('allocator')) {
    return {
      action: (name, principal) => `Deposit $${principal.toLocaleString('en-US')} into a ${name} vault.`,
      weekly: 'deposit a little more into the vault',
    };
  }
  if (c.includes('stable')) {
    return {
      action: (name, principal) => `Mint or deposit $${principal.toLocaleString('en-US')} of ${name}'s stable asset.`,
      weekly: 'mint or deposit a little more of the stable asset',
    };
  }
  return {
    action: (name, principal) => `Deposit $${principal.toLocaleString('en-US')} of USDC into ${name}.`,
    weekly: 'deposit a little more USDC',
  };
}

/**
 * The farm plan: six concrete steps, each naming an action, a dollar
 * figure and a time. The hold length grows for younger protocols so the
 * activity lands in more than one snapshot.
 */
export function buildFarmPlan(p: SnapshotProtocol, ageDays: number): string[] {
  const principal = principalFor(p.tvl_usd);
  const chain = p.chains.length > 0 ? p.chains[0]! : 'its main chain';
  const gas = gasProfileFor(p.chains.length > 0 ? p.chains[0]! : null);
  const plan = categoryPlan(p.category);
  const holdDays = ageDays < 180 ? 60 : ageDays < 365 ? 45 : 30;
  return [
    `Open a fresh wallet for this farm only and write its seed phrase on paper, kept offline. Cost $0, about 10 minutes. Never paste the seed into any site or message.`,
    `${plan.action(p.name, principal, chain)} Gas on ${chain} runs ${gas}. About 30 minutes.`,
    `Do one more qualifying action each week — ${plan.weekly} — so the farm shows steady use across snapshots. Each action costs about ${gas} in gas and takes 15 minutes.`,
    `Hold the position for ${holdDays} days without withdrawing, so the activity lands in more than one snapshot. Cost $0 beyond gas, about 5 minutes a week to check in.`,
    `Claim only from ${p.name}'s own published links — its site and docs. Never pay to claim and never approve a claim from a link sent to you. Cost $0, a few minutes when a claim opens.`,
    `Keep a farm log: wallet address, dates, transaction hashes and amounts. If a token launches, the log is your proof of use. Cost $0, 5 minutes per entry.`,
  ];
}

/** One board row: the rank, the value, the walk-through and the farm plan. */
export interface BoardRow {
  slug: string;
  name: string;
  rank: number;
  implied_value_usd: number;
  farm_steps: string[];
  tvl_usd: number;
  category: string | null;
  chains: string[];
  change_7d: number | null;
  listed_at: string | null;
  age_days: number;
  age_estimated: boolean;
  watchlist: boolean;
  multiple: number;
  comparables_n: number;
  multiple_source: 'category' | 'global';
  momentum_factor: number;
  maturity_factor: number;
  verdict: string;
  verdict_reason: string;
  walkthrough: Walkthrough;
}

/** Build one board row from a rankable protocol and the comparables. */
export function buildRow(
  p: SnapshotProtocol,
  comparables: Comparables,
  medianAge: number,
  asOf: string,
  onWatchlist: boolean,
): BoardRow {
  const row = multipleFor(p.category, comparables);
  const momentum = momentumFactor(p.change_7d);
  const knownAge = ageDaysOf(p, asOf);
  const ageDays = knownAge ?? medianAge;
  const maturity = maturityFactor(ageDays);
  const implied = impliedValueUsd(p.tvl_usd, row.median, momentum, maturity);
  const verdict = verdictFor(implied, momentum, p.change_7d, ageDays);
  const multipleLine =
    row.source === 'category'
      ? `Comparable multiple ${row.median.toFixed(3)} — the median mcap/TVL of ${row.n} tokened ${p.category} protocols.`
      : p.category === null
        ? `Comparable multiple ${row.median.toFixed(3)} — the global median mcap/TVL of ${comparables.globalN} tokened protocols (no category reported).`
        : `Comparable multiple ${row.median.toFixed(3)} — the global median mcap/TVL of ${comparables.globalN} tokened protocols (${p.category} has only ${row.n} comparable${row.n === 1 ? '' : 's'}, below the 3 needed).`;
  const maturityLine =
    knownAge !== null
      ? `Maturity factor ${maturity.toFixed(2)} — ${ageDays} days with no token (listed ${p.listed_at}).`
      : `Maturity factor ${maturity.toFixed(2)} — listed_at not reported, so the median age of the ranked protocols (${medianAge} days) is used.`;
  return {
    slug: p.slug,
    name: p.name,
    rank: 0,
    implied_value_usd: implied,
    farm_steps: buildFarmPlan(p, ageDays),
    tvl_usd: p.tvl_usd,
    category: p.category,
    chains: p.chains,
    change_7d: p.change_7d,
    listed_at: p.listed_at,
    age_days: ageDays,
    age_estimated: knownAge === null,
    watchlist: onWatchlist,
    multiple: row.median,
    comparables_n: row.n,
    multiple_source: row.source,
    momentum_factor: momentum,
    maturity_factor: maturity,
    verdict: verdict.verdict,
    verdict_reason: verdict.reason,
    walkthrough: {
      tvlLine: `TVL ${usdCompact(p.tvl_usd)} as of ${asOf}.`,
      multipleLine,
      momentumLine:
        p.change_7d === null
          ? `Momentum factor ${momentum.toFixed(2)} — 7-day change not reported, so the factor is neutral.`
          : `Momentum factor ${momentum.toFixed(2)} — ${changeText(p.change_7d)} (change clamped to −60…120%).`,
      maturityLine,
      resultLine: `Implied value ${usdFull.format(implied)} = TVL × ${row.median.toFixed(3)} × ${momentum.toFixed(2)} × ${maturity.toFixed(2)}, rounded to the nearest dollar.`,
    },
  };
}

/** The live-token view: the 24 tokened protocols with the largest market caps, showing the market's own values only. */
export function liveTokens(protocols: SnapshotProtocol[], count = 24): {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  mcap_usd: number;
  tvl_usd: number;
  change_7d: number | null;
}[] {
  return protocols
    .filter((p) => p.mcap_usd !== null)
    .sort((a, b) => b.mcap_usd! - a.mcap_usd! || (a.slug < b.slug ? -1 : 1))
    .slice(0, count)
    .map((p) => ({
      slug: p.slug,
      name: p.name,
      category: p.category,
      chains: p.chains,
      mcap_usd: p.mcap_usd!,
      tvl_usd: p.tvl_usd,
      change_7d: p.change_7d,
    }));
}
