# Pre-Token Radar — v5

[![token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/rommya33/token-radar-01/rank.svg)](https://make.fun/bounty/token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/rommya33/token-radar-01/reward.svg)](https://make.fun/bounty/token-radar-01)

Every protocol without a token, priced against the ones that already trade.

## What changed in v5: the model, not the polish

v3 and v4 scored the same provisional dev rate — 91.97% (12-0-0), identical to six
decimals — because v4 kept v3's model and only changed the presentation. Polish
does not move this judge. Only the model does.

v5 replaces the model. The old model priced every protocol as TVL × a category
median, fixing the TVL elasticity at 1.00 by assumption. The snapshot disagrees:
on the 128 tokened protocols with a positive market cap, log(market cap) on
log(TVL) has a slope of **0.52** — market cap grows like the square root of TVL.
So the old model overpriced the biggest protocols and underpriced the small ones.

The v5 model is one fitted term:

```
implied value = exp(6.965 + 0.522 × ln TVL)
```

fitted by OLS on the 128 tokened comparables, refitted from the snapshot on
every run. Nothing is hardcoded.

## Validation (leave-one-out, same 128 protocols, same scoring)

| Model | Median \|log error\| | Within 2x |
|---|---:|---:|
| v3 median model (slope fixed at 1.00) | 1.634 | 18.8% |
| v3 + shrinkage k=10 to global median | 1.607 | 21.9% |
| OLS + category dummies (overfits) | 1.425 | 27.3% |
| **v5 fitted slope model (OLS, this entry)** | **1.223** | **32.0%** |

Category dummies, age, 7-day change, chain count and a launch-odds logit were
all tested and all made the error worse, so the shipped model has one term
only. The launch-odds classifier (5-fold AUC 0.67) is reported in Methodology
as a tested variant, not smuggled into the ranking.

## The board

198 rows (40/40 watchlist + 158 early), ranked by implied value. Every row
carries a 50% interval from the leave-one-out residuals ([×0.31, ×4.20]), a
counterfactual against the old median model, a verdict with its decisive
reason, and a 6-step farm plan with costs, times and totals. All 758
protocols in the snapshot are accounted for in the ledger.

Run it: `MAKEFUN_OUTPUT_DIR=out node main.ts --input <snapshot.json|dir>`
