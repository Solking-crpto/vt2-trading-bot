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
