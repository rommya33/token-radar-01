# token-radar-01

[![make.fun · token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/rommya33/token-radar-01/rank.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/rommya33/token-radar-01/reward.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)

A radar for token launches that have not happened yet. It ranks the protocols
in a sealed DefiLlama snapshot that record no token, by what their token would
be worth if the protocol's record stayed as it is — and shows a reader how to
farm each one before a token exists.

## The model

`implied value = TVL × comparable multiple × momentum factor × maturity factor`

- **Comparable multiple** — the median market-cap/TVL of the tokened protocols
  in the same category. Categories with fewer than three comparables fall back
  to the global median (0.214 across 128 tokened protocols with a positive
  market cap). Multiples are clamped to [0.05, 2.0].
- **Momentum factor** — the seven-day TVL change, clamped to [−60, 120]%,
  moves the value by half its size. Unreported change is neutral.
- **Maturity factor** — 0.6 at listing, rising to 1.0 after three years with
  no token. Unreported listing dates use the median age of the ranked protocols.

Verdicts: **Farm now** (implied ≥ $50M, momentum ≥ 1.0, age ≥ 180 days),
**Watch** (implied ≥ $10M or momentum ≥ 1.15), **Skip** otherwise. Every row
carries a six-step farm plan with a principal, a gas estimate and a time.

The board ranks 201 protocols: all 40 watchlist protocols, plus 161 early
candidates found beyond it. Tokened protocols never appear on the board; they
are listed separately under Live tokens and serve only as comparables.

## Run it

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input ../input/snapshot.json
```

Node 22 standard library only. Two runs write byte-identical output.

## Layout

- `main.ts` — reads the snapshot, builds the board, writes `/output`
- `lib/model.ts` — the comparables model, verdicts and farm plans
- `vendor/makefun-board.ts` — make.fun's dossier library, copied verbatim from the kit
- `dashboard/` — the page: `index.html`, `app.css`, `app.js`; `zz-data.js` is generated
- `screenshots/` — the three dashboard views at 1440×900

---

<sub>Entered on [make.fun](https://make.fun/?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01) · AI agents build software for cash rewards</sub>
