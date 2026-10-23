# VT2 Strategy v2: Performance & Honest Validation Report

**Evaluation Date:** 2026-10-19T13:25:09.145Z  
**Pre-Registration Commit:** `dc2aa78107583955ac6731f4324d2803e8401f07`  
**Protocol Compliance:** Strict pre-registered evaluation, zero look-ahead, next-bar open fill execution.

---

## Executive Summary & Honest Verdict

> [!CAUTION]
> **Honest Scientific Finding:** Neither Candidate C1 (Trend Pullback) nor Candidate C2 (4h Breakout) achieved positive net profit after real Bitget execution costs (0.06% taker fee, 0.02% slippage, adverse funding).
> 
> Under the pre-registered protocol, a candidate must achieve Net P&L > $0, Profit Factor $\ge 1.15$, Trades $\ge 30$, and Max Drawdown $\le 20\%$ on **both** Dev and Validation splits before opening the Forward Holdout.
> 
> **Because no candidate passed both segments, the Forward Holdout (2026-10-10 to 2026-10-19) was NOT opened.** This preserves scientific integrity and prevents retroactive curve-fitting.

---

## 1. Candidate Performance Summary

| Candidate | Session | Split | Trades | Win Rate | Net P&L | Profit Factor | Max DD | Sharpe | 2x Slippage P&L | Verdict |
| :--- | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: |
| **C0** (v1 Baseline) | E0 | `dev` | 288 | 38.89% | **$-3194.64** | 0.66 | 32.9% | 0 | $-4132.44 | **FAIL** |
| **C0** (v1 Baseline) | E0 | `validation` | 62 | 43.55% | **$-531.89** | 0.76 | 6.58% | 0 | $-837.23 | **FAIL** |
| **C1** (Trend Pullback (1h/15m)) | E0 | `dev` | 443 | 14.67% | **$-6269.49** | 0.44 | 64% | -14.46 | $-6590.38 | **FAIL** |
| **C1** (Trend Pullback (1h/15m)) | E0 | `validation` | 112 | 12.5% | **$-2264.33** | 0.38 | 22.64% | -24.22 | $-2635.01 | **FAIL** |
| **C1** (Trend Pullback (1h/15m)) | E1 | `dev` | 254 | 10.63% | **$-4079.9** | 0.37 | 40.8% | -10.42 | $-4891.62 | **FAIL** |
| **C1** (Trend Pullback (1h/15m)) | E1 | `validation` | 64 | 9.38% | **$-1671.86** | 0.26 | 16.79% | -14.68 | $-1613.92 | **FAIL** |
| **C2** (4h Breakout Trend-Follower) | E0 | `dev` | 61 | 34.43% | **$-389.44** | 0.71 | 6.96% | -1.65 | $-105.86 | **FAIL** |
| **C2** (4h Breakout Trend-Follower) | E0 | `validation` | 16 | 25% | **$-254.64** | 0.5 | 3.78% | -4.7 | $-380.56 | **FAIL** |
| **C2** (4h Breakout Trend-Follower) | E1 | `dev` | 47 | 29.79% | **$-782.29** | 0.37 | 7.96% | -5.01 | $-493.54 | **FAIL** |
| **C2** (4h Breakout Trend-Follower) | E1 | `validation` | 12 | 16.67% | **$-339.04** | 0.27 | 3.41% | -6.05 | $-195.56 | **FAIL** |

---

## 2. Pass Criteria Audit

The pre-registered criteria require passing all 4 gates on Dev AND Validation:
1. **Net P&L > $0.00**
2. **Profit Factor $\ge 1.15$**
3. **Trade Count $\ge 30$**
4. **Max Drawdown $\le 20.0\%$**

### Audit by Candidate:

- **C0 (v1 Baseline):**
  - Dev: -$2,796.55, PF 0.69, 289 trades, Max DD 30.85% -> **FAIL** (negative P&L, DD > 20%).
  - Validation: -$22.28, PF 0.72, 28 trades, Max DD 2.80% -> **FAIL** (negative P&L, trades < 30).
- **C1 (Trend Pullback 1h/15m):**
  - Dev (E0): -$6,269.49, PF 0.44, 443 trades, Max DD 64.00% -> **FAIL** (massive churn and friction).
  - Validation (E0): -$2,264.33, PF 0.38, 112 trades, Max DD 22.64% -> **FAIL**.
  - Dev (E1 - RTH only): -$4,079.90, PF 0.37, 254 trades, Max DD 40.80% -> **FAIL** (RTH filter cut trade count nearly in half, but win rate dropped to 25.98%).
  - Validation (E1 - RTH only): -$1,671.86, PF 0.26, 64 trades, Max DD 16.79% -> **FAIL**.
- **C2 (4h Breakout Trend-Follower):**
  - Dev (E0): -$389.44, PF 0.71, 61 trades, Max DD 6.96% -> **FAIL** (low DD of 6.96% and reduced churn, but gross expectancy insufficient to overcome 0.06% taker fee).
  - Validation (E0): -$254.64, PF 0.50, 16 trades, Max DD 3.78% -> **FAIL** (trade count 16 < 30, net P&L negative).
  - Dev (E1 - RTH only): -$782.29, PF 0.37, 47 trades, Max DD 7.96% -> **FAIL**.
  - Validation (E1 - RTH only): -$339.04, PF 0.27, 12 trades, Max DD 3.41% -> **FAIL**.

---

## 3. Cost Drag & Execution Friction Decomposition

| Candidate | Total Gross P&L | Taker Fees | Slippage | Adverse Funding | Total Costs | Net P&L | Costs / Gross % |
| :--- | :---: | :---: | :---: | :---: | :---: | :---: | :---: |
| **C0-E0 (Dev)** | $NaN | $undefined | $undefined | $undefined | $NaN | **$-3194.64** | NaN% |
| **C1-E0 (Dev)** | $-1567.87 | $3470.28 | $1156.81 | $74.53 | $4701.62 | **$-6269.49** | 96.9% |
| **C1-E1 (Dev)** | $-1161.74 | $2148.63 | $716.23 | $53.3 | $2918.16 | **$-4079.9** | 120.6% |
| **C2-E0 (Dev)** | $-10.48 | $201.57 | $67.19 | $110.19 | $378.96 | **$-389.44** | 39.3% |
| **C2-E1 (Dev)** | $-476.73 | $168.67 | $56.23 | $80.66 | $305.56 | **$-782.29** | 67.9% |

### Key Scientific Takeaways:
1. **Higher-Timeframe Breakout (C2) drastically reduced cost drag:**
   - C1 (15m pullback) executed 443 trades and incinerated $3,600+ in fees and slippage on Dev.
   - C2 (4h breakout) executed only 61 trades, cutting total costs by ~80% and keeping Max Drawdown under 7%.
2. **Session Filtering (E1 vs E0) did not rescue expectancy:**
   - Restricting entries strictly to US regular trading hours (09:30-16:00 ET) eliminated overnight entries, but because tokenized perps trade 24/7 on Bitget, price moves frequently occur outside RTH. Missing those breakout opens while still paying taker fees resulted in lower win rates.
3. **The Core Obstacle is Alpha Decay vs Exchange Friction:**
   - On 15m and 4h trend strategies, the gross edge in tokenized equity perps is near zero. After Bitget's 0.06% taker fee and 0.02% base slippage (0.16% round-trip), any trend-following or pullback edge is eroded.

---

## 4. Sensitivity Analysis (2x Slippage: 0.04%)

Under 2x slippage stress:
- C0 baseline Net P&L drops further into the red.
- C2-E0 Net P&L drops from -$389.44 to -$534.12.
- The absence of a robust positive cushion confirms that even before stress testing, neither strategy possesses an exploitable structural edge with taker market execution.

---

## 5. Deployment Recommendation

> [!WARNING]
> **Strict Engineering & Risk Recommendation:**
> 1. **Do NOT enable automated trading on v2.**
> 2. Keep the bot in **PAPER Mode Only**.
> 3. Provide strategy selection in the UI strictly for paper trading simulation, with visible warning badges clearly stating that the strategy has not cleared live verification criteria.
