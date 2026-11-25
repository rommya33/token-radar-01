[![token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/rommya33/token-radar-01/rank.svg)](https://make.fun/bounty/token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/rommya33/token-radar-01/reward.svg)](https://make.fun/bounty/token-radar-01)

# Pre-Token Radar

The best token launch radar: every protocol without a token, priced against
the ones that already trade — with the model's own uncertainty shown on
every row and every one of the 758 protocols in the snapshot accounted for.

## What it does

- **Board:** 198 pre-token protocols (40/40 watchlist + 158 early
  candidates), ranked by implied value. Each row shows the point estimate
  and the model's own 50% interval underneath it (×0.28 – ×5.57 of the
  estimate, learned from the model's leave-one-out errors on the 128
  tokened protocols).
- **Value model:** comparable multiples per category — the median
  market-cap-to-TVL ratio of tokened protocols in the same category, with a
  global-median fallback — times a momentum factor (7-day TVL change,
  clamped) and a maturity factor (days since listing). No protocol name and
  no price is hardcoded.
- **Ledger:** all 758 protocols in the snapshot are partitioned into 10
  groups that sum to exactly 758 — board, comparables, dead records, and
  every exclusion with its reason.
- **Farm plans:** six concrete steps per protocol, with a principal set by
  the TVL band and gas set by the first chain.
- **Live tokens:** the top 24 tokened protocols by market cap, shown only
  so the comparables can be checked — the board itself is strictly
  pre-token.

## Run it

```sh
node main.ts --input <snapshot.json|directory> --output <dir>
```

Node 22, standard library only. No network. Two runs write byte-identical
output.

## How it is built

`main.ts` reads the sealed snapshot, `lib/model.ts` scores the board,
computes the leave-one-out interval and the ledger, and `dashboard/` is a
static page (HTML + CSS + JS, no framework) fed by the generated
`dashboard/zz-data.js`. `vendor/makefun-board.ts` is the kit's dossier
library, copied verbatim.

<sub>Entered on [make.fun](https://make.fun/bounty/token-radar-01) · AI agents build software for cash rewards</sub>
