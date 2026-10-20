# VT2 Strategy v2: Trial Log

This log immutably records all backtest trials, parameter executions, and outcomes (including failed runs) to prevent selective reporting.

| Trial # | Timestamp | Candidate | Segment | Asset Class | Session | Net P&L | Trades | Win Rate | Profit Factor | Max DD | Status / Verdict | Notes |
| :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :--- |
| *Pre-registration committed* | 2026-10-19 11:48 UTC | — | — | — | — | — | — | — | — | — | INITIALIZED | Pre-registration committed before any backtest trial |
| 0 (Ablation) | 2026-10-19 13:56 UTC | v1 Baseline | Dev | Equity | E0 | -$2,796.55 | 289 | 40.48% | 0.69 | 30.85% | ABLATION | Baseline Dev run; confirmed 9 rule variations evaluated |

| 1 | 2026-10-19 13:25 UTC | C0 (v1 Baseline) | dev | Equity | E0 | $-3194.64 | 288 | 38.89% | 0.66 | 32.9% | FAIL | 2xSens PnL: $-4132.44 |
| 2 | 2026-10-19 13:25 UTC | C0 (v1 Baseline) | validation | Equity | E0 | $-531.89 | 62 | 43.55% | 0.76 | 6.58% | FAIL | 2xSens PnL: $-837.23 |
| 3 | 2026-10-19 13:25 UTC | C1 (Trend Pullback (1h/15m)) | dev | Equity | E0 | $-6269.49 | 443 | 14.67% | 0.44 | 64% | FAIL | 2xSens PnL: $-6590.38 |
| 4 | 2026-10-19 13:25 UTC | C1 (Trend Pullback (1h/15m)) | validation | Equity | E0 | $-2264.33 | 112 | 12.5% | 0.38 | 22.64% | FAIL | 2xSens PnL: $-2635.01 |
| 5 | 2026-10-19 13:25 UTC | C1 (Trend Pullback (1h/15m)) | dev | Equity | E1 | $-4079.9 | 254 | 10.63% | 0.37 | 40.8% | FAIL | 2xSens PnL: $-4891.62 |
| 6 | 2026-10-19 13:25 UTC | C1 (Trend Pullback (1h/15m)) | validation | Equity | E1 | $-1671.86 | 64 | 9.38% | 0.26 | 16.79% | FAIL | 2xSens PnL: $-1613.92 |
| 7 | 2026-10-19 13:25 UTC | C2 (4h Breakout Trend-Follower) | dev | Equity | E0 | $-389.44 | 61 | 34.43% | 0.71 | 6.96% | FAIL | 2xSens PnL: $-105.86 |
| 8 | 2026-10-19 13:25 UTC | C2 (4h Breakout Trend-Follower) | validation | Equity | E0 | $-254.64 | 16 | 25% | 0.5 | 3.78% | FAIL | 2xSens PnL: $-380.56 |
| 9 | 2026-10-19 13:25 UTC | C2 (4h Breakout Trend-Follower) | dev | Equity | E1 | $-782.29 | 47 | 29.79% | 0.37 | 7.96% | FAIL | 2xSens PnL: $-493.54 |
| 10 | 2026-10-19 13:25 UTC | C2 (4h Breakout Trend-Follower) | validation | Equity | E1 | $-339.04 | 12 | 16.67% | 0.27 | 3.41% | FAIL | 2xSens PnL: $-195.56 |


## Round 2 Pre-Registered Trials (Commit: 33beca481f2f20904faa57135f36e092cba399ff)

| Date | Candidate | Universe | Session | Split | Trades | Win Rate | Net P&L | PF | Max DD | Sens x0 | Sens x1 | Sens x2 | Status |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 2026-10-19 | R2-A | Equity | E0 | dev | 43 | 34.88% | $-414.81 | 0.46 | 4.15% | $-387.60 | $-414.80 | $-442.00 | FAIL |
| 2026-10-19 | R2-A | Equity | E0 | validation | 11 | 9.09% | $-333.34 | 0.08 | 3.61% | $-324.15 | $-333.34 | $-342.54 | FAIL |
| 2026-10-19 | R2-A | Equity | E1 | dev | 33 | 39.39% | $-309.36 | 0.52 | 3.09% | $-286.38 | $-309.35 | $-332.31 | FAIL |
| 2026-10-19 | R2-A | Equity | E1 | validation | 5 | 0% | $-144.50 | 0 | 1.46% | $-140.53 | $-144.50 | $-148.47 | FAIL |
| 2026-10-19 | R2-A | Crypto | E0 | dev | 9 | 11.11% | $-125.65 | 0.57 | 1.99% | $-120.82 | $-125.65 | $-130.47 | FAIL |
| 2026-10-19 | R2-A | Crypto | E0 | validation | 3 | 66.67% | $63.87 | 2.28 | 0.03% | $65.76 | $63.87 | $61.99 | **PASS** |
| 2026-10-19 | R2-B | Equity | E0 | dev | 266 | 24.81% | $-1366.89 | 0.87 | 21.43% | $-1161.89 | $-1366.95 | $-1572.00 | FAIL |
| 2026-10-19 | R2-B | Equity | E0 | validation | 47 | 27.66% | $-18.99 | 0.99 | 6.74% | $22.88 | $-18.99 | $-60.87 | FAIL |
| 2026-10-19 | R2-B | Equity | E1 | dev | 122 | 29.51% | $392.80 | 1.08 | 13.02% | $508.20 | $392.77 | $277.35 | FAIL |
| 2026-10-19 | R2-B | Equity | E1 | validation | 27 | 22.22% | $-313.31 | 0.73 | 4.85% | $-289.10 | $-313.29 | $-337.48 | FAIL |
| 2026-10-19 | R2-B | Crypto | E0 | dev | 13 | 30.77% | $72.74 | 1.15 | 1.69% | $85.98 | $72.74 | $59.50 | FAIL |
| 2026-10-19 | R2-B | Crypto | E0 | validation | 20 | 20% | $-331.48 | 0.63 | 6.63% | $-310.13 | $-331.48 | $-352.82 | FAIL |

**Forward Holdout Split Status**: KEPT CLOSED (no candidate satisfied pre-registered pass criteria)


## Long-History Pre-Registered Trials (Candidate L1, Commit: 49bc92f)

| Date | Candidate | Universe | Timeframe | Split | Trades | Net Return | B&H Return | Max DD | B&H Max DD | Return/DD | B&H Ret/DD | Status |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 2026-10-20 | L1 (100d SMA) | BTC+ETH (50/50) | 1D | Dev (2019-2023) | 43 | +702.78% | +779.37% | 51.87% | 77.90% | 13.55 | 10.00 | FAIL (DD ratio 0.67x > 0.60x) |
| 2026-10-20 | L1 (100d SMA) | BTC+ETH (50/50) | 1D | Val (2024-2025) | 36 | +44.80% | +67.31% | 41.82% | 41.60% | 1.07 | 1.62 | FAIL (DD ratio 1.01x > 0.60x) |

**L1 Forward Holdout Status**: KEPT CLOSED (did not pass pre-registered criteria on Dev and Validation)
