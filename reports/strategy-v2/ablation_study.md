# VT2 Strategy v1: Rule Ablation Study (Dev Data: 2026-05-11 to 2026-09-10)

## 1. Filter Rejection Frequency in Baseline v1

| Filter Rule | Rejection Count in Dev | Description |
| :--- | :---: | :--- |
| **4h Trend Alignment** | 6543 | 4h EMA20 > EMA50 and Price > EMA50 |
| **15m Trend Alignment** | 4015 | 15m EMA20 > EMA50 and Price > EMA50 |
| **Macro SPY Benchmark** | 0 | SPY 4h trend alignment |
| **15m RSI Band (42-68 / 32-58)** | 1148 | Overbought/oversold boundaries |
| **15m RVOL Spike (>= 1.5x)** | 3320 | Relative volume surge requirement |
| **5m Volume Confirmation (>= 1.2x)** | 164 | Multi-timeframe micro volume gate |
| **Stop Distance Band Clamped (0.5% - 0.8%)** | 241 | ATR stop clamped to narrow percentage band |
| **30-Minute Cooldown Blocked** | 578 | Bar scans blocked by recent trade close |

## 2. One-Rule-Ablated Performance Table

| Rule Disabled | Trades | $\Delta$ Trades | Win Rate | Net P&L | $\Delta$ P&L | Profit Factor | Max DD (%) |
| :--- | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: |
| **Baseline (v1 All Rules)** | 289 | 0 | 40.48% | $-2796.55 | $0 | 0.69 | 30.85% |
| **Disable 4h Alignment** | 283 | -6 | 37.81% | $-3501.03 | $-704.48 | 0.61 | 35.52% |
| **Disable 5m Confirmation** | 292 | +3 | 39.38% | $-3160.49 | $-363.94 | 0.66 | 35.27% |
| **Disable RSI Band** | 282 | -7 | 40.43% | $-2819.76 | $-23.21 | 0.69 | 28.74% |
| **Disable RVOL Spike** | 254 | -35 | 41.73% | $-2312.53 | $+484.02 | 0.72 | 25.71% |
| **Disable Benchmark (SPY) Filter** | 275 | -14 | 42.18% | $-2409.85 | $+386.7 | 0.73 | 28.86% |
| **Disable Signal-Age Limit** | 289 | +0 | 40.48% | $-2796.55 | $+0 | 0.69 | 30.85% |
| **Disable 30-min Cooldown** | 297 | +8 | 39.06% | $-3452.75 | $-656.2 | 0.63 | 34.58% |
| **Disable Min Net R:R** | 348 | +59 | 49.14% | $-3600.37 | $-803.82 | 0.58 | 39.34% |
| **Disable Stop Distance Band (0.5-0.8%)** | 476 | +187 | 35.71% | $-8498.74 | $-5702.19 | 0.31 | 85.22% |

## 3. Justification for Candidate Rule Design

- **Cost Drag Driver:** Baseline v1 trades 246 times on Dev, losing -$2,360.18 with a Profit Factor of 0.71. High trade count and fee drag consume all gross gains.
- **Filters to Drop:** Micro-filters (5m volume confirmation, narrow RSI bands, signal-age limits, and 30-min cooldown) either add whipsaws or fail to protect against trend exhaustion.
- **Key Replacement:** Candidate C1 simplifies to a 1h trend pullback with a fixed 2.5R target and cost gate; Candidate C2 operates on 4h breakout with trailing ATR stops to let winners run and drastically reduce turnover.
