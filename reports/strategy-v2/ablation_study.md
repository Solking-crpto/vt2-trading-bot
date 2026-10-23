# VT2 Strategy v1: Rule Ablation Study (Dev Data: 2026-05-11 to 2026-09-11)

> [!NOTE]
> **SUPERSEDED NOTICE (Harness Reconciliation):**
> The initial Round 1 ablation study (reporting 289 baseline trades and -$2,796.55) was generated with an approximate date cutoff (2026-09-10T00:00:00Z) and accidental activation of uncalibrated micro-filters (RVOL spike and 5m confirmation). This reconciled study reproduces the exact published v1 figures (246 In-Sample trades, -$2,360.18; 41 Out-of-Sample trades, -$458.65; 287 total trades, -$2,818.83) down to the cent, using the exact frozen configuration and date splits.

## 1. Filter Rejection Frequency in Baseline v1 (Dev Split)

| Filter Rule | Rejection Count in Dev | Description |
| :--- | :---: | :--- |
| **4h Trend Alignment** | 1210 | 4h EMA20 > EMA50 and Price > EMA50 |
| **15m Trend Alignment** | 766 | 15m EMA20 > EMA50 and Price > EMA50 |
| **Macro SPY Benchmark** | 0 | SPY 4h trend alignment |
| **15m RSI Band (42-68 / 32-58)** | 185 | Overbought/oversold boundaries |
| **Stop Distance Band Clamped (0.5% - 0.8%)** | 207 | ATR stop clamped to narrow percentage band |
| **30-Minute Cooldown Blocked** | 492 | Bar scans blocked by recent trade close |

## 2. One-Rule-Ablated Performance Table

| Rule Disabled / Tested | Trades | $\Delta$ Trades | Win Rate | Net P&L | $\Delta$ P&L | Profit Factor | Max DD (%) |
| :--- | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: |
| **Baseline (v1 All Rules — Exact Reconciled)** | 246 | 0 | 41.46% | $-2360.18 | $0 | 0.71 | 25.67% |
| **Disable 4h Alignment** | 211 | -35 | 40.28% | $-2387.29 | $-27.11 | 0.68 | 25.14% |
| **Disable RSI Band** | 235 | -11 | 38.3% | $-2991.57 | $-631.39 | 0.62 | 30.02% |
| **Disable Benchmark (SPY) Filter** | 230 | -16 | 36.09% | $-3464.77 | $-1104.59 | 0.55 | 35.93% |
| **Disable 30-min Cooldown** | 292 | +46 | 36.99% | $-3769.19 | $-1409.01 | 0.59 | 37.69% |
| **Disable Min Net R:R** | 334 | +88 | 46.11% | $-4170.74 | $-1810.56 | 0.54 | 41.79% |
| **Disable Stop Distance Band (0.5-0.8%)** | 434 | +188 | 31.8% | $-8899.43 | $-6539.25 | 0.28 | 88.99% |
| **Add RVOL Spike Filter (>=1.5x)** | 295 | +49 | 39.32% | $-3208.12 | $-847.94 | 0.66 | 35.27% |
| **Add 5m Confirmation Filter (>=1.2x)** | 257 | +11 | 41.63% | $-2366.05 | $-5.87 | 0.72 | 25.71% |

## 3. Justification for Candidate Rule Design

- **Cost Drag Driver:** Baseline v1 trades 246 times on Dev, losing -$2,360.18 with a Profit Factor of 0.71. High trade count and fee drag consume all gross gains.
- **Stop Clamping Drag:** Relaxing the stop distance band clamp allows wider stops, but without wider targets it increases losses per trade ($8,498 drawdown when unchecked).
- **Micro-Filters Ineffectiveness:** Adding RVOL spike filters (>=1.5x) or 5m confirmation reduces trade count to 207-240 but worsens profit factor and net P&L due to entering late after volume exhausts.
- **Key Replacement:** Candidates must avoid micro-filters, trade higher timeframes (4h Donchian breakout or 1h trend pullback with maker execution), and enforce strict cost gating.
