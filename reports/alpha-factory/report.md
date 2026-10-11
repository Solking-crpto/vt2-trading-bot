# VT2 Alpha Factory: Quantitative Strategy Backtest Report

**Track 1:** Alpha Factory  
**Theme:** Open Theme (Execution-Aware, Risk-Budgeted Alpha on Tokenized US Equity Perpetuals)  
**Strategy Hash:** `541c10ab1dcae7bbaaebe5d8c465730bd118747b`  
**Simulation Period:** 151.7 Days (~5 Months, May 2026 – October 2026)  
**Universe:** 19 Verified Bitget Tokenized US Equity Perpetuals (`isRwa === "YES"`)  
**Operating Mode:** Paper Replay with Live Deterministic Risk Engine Constraints  

---

## 1. Executive Summary & Headline Results

| Metric | In-Sample (IS) [observed] | Out-of-Sample (OOS, Final 30d) [observed] | Total Replay [observed] |
| :--- | :--- | :--- | :--- |
| **Trade Count** | 246 | 41 | 287 |
| **Win Rate** | 41.46% | 39.02% | 41.11% |
| **Net P&L ($)** | $-2360.18 | $-458.65 | $-2818.83 |
| **Total Return (%)** | -23.13% | -6.66% | -28.25% |
| **Annualized Sharpe (365d)** | -4.15 | -6.51 | -4.46 |
| **Annualized Sortino (365d)** | -5.09 | -7.18 | -5.39 |
| **Max Drawdown ($ / %)** | $2620.87 (25.67%) | $639.58 (8.32%) | $3162.53 (30.98%) |
| **Average Win / Loss ($)** | $57.54 / $57.15 | $45.64 / $47.55 | $55.93 / $55.73 |
| **Profit Factor** | 0.71 | 0.61 | 0.7 |
| **Portfolio Turnover** | 219.4x | 37.59x | 258.47x |

### Out-of-Sample Decay Analysis
- **In-Sample Annualized Sharpe:** -4.15
- **Out-of-Sample Annualized Sharpe:** -6.51
- **OOS Sharpe Decay Ratio:** 1.569 [observed mathematical ratio: -6.51 / -4.15]
- **Sharpe Decay Interpretation:** Standard Sharpe decay ratio is not economically meaningful when In-Sample Sharpe is zero or negative (dividing negative by negative yields positive, not retention).

---

## 2. Benchmark Comparisons

| Strategy / Asset | Total Return (%) [observed] | Max Drawdown (%) [observed] | Nature of Comparison |
| :--- | :--- | :--- | :--- |
| **VT2 Alpha Factory (Tokenized Equities)** | **-28.25%** | **30.98%** | Execution-Aware Quantitative Bot |
| **SPYUSDT Buy-and-Hold** | **4.97%** | **5.21%** | S&P 500 Benchmark Asset |
| **Equal-Weight 19-Stock Basket** | **4.94%** | N/A | Passive Equal-Weight Portfolio |

---

## 3. Real Execution Cost Modeling & Worked Trade Example

All returns are net of institutional taker fees, realistic execution slippage, and continuous funding:
- **Total Taker Fees Paid:** $2223.72 [observed: 0.05% taker rate per fill across entries, partial TP, and exits]
- **Total Execution Slippage Paid:** $889.52 [observed: 0.02% slippage rate per fill across ~$4.4M gross notional]
- **Total 8h Funding Rate Paid:** $317.42 [observed / modeled: 0.01% / 8h adverse carry]
- **Total Cumulative Friction:** $3430.65 [observed]
- **Market Exposure Time:** 88.54% of total timeline [observed]

### Slippage Accounting & Double-Counting Verdict
- **Execution Mechanism:** Fills are executed at slippage-adjusted prices (`fillPrice = rawOpen * (1 + 0.0002)` for Longs, `rawOpen * (1 - 0.0002)` for Shorts; exits at `rawExit * (1 - 0.0002)` for Longs, `rawExit * (1 + 0.0002)` for Shorts).
- **Inclusion in Net P&L:** Because execution prices directly embed slippage, **slippage is already inside Gross and Net P&L**. It is NOT deducted a second time from cash equity. The reported metric `totalSlippagePaid` ($889.52) is an analytical tracking metric documenting friction.

### Worked Trade Example (Fees, Slippage, and Carry)
Consider a representative Long trade in **NVDAUSDT** (50 contracts):
1. **Signal Generation (Bar $t$):** Breakout confluence detected. Stop loss: $198.50, Initial target: $203.00.
2. **Next-Bar Entry (Bar $t+1$):** Raw open = $200.00.
   - Fill Price (Long +0.02% slippage): `$200.00 * 1.0002 = $200.04`.
   - Entry Notional: `50 * $200.04 = $10,002.00`.
   - Entry Slippage Paid: `|200.04 - 200.00| * 50 = $2.00`.
   - Entry Taker Fee (0.05%): `$10,002.00 * 0.0005 = $5.001`.
   - Cash equity debited for entry fee: `-$5.001`.
3. **Holding Period Carry:** Position held 16 hours (2 funding settlement cycles at 0.01%):
   - Funding Paid: `50 * $200.00 * 0.0001 * 2 = $2.00`.
   - Cash equity debited for funding carry: `-$2.00`.
4. **Exit at Stop Loss:** Stop triggered at $198.50.
   - Fill Price (Long -0.02% slippage): `$198.50 * 0.9998 = $198.4603`.
   - Exit Notional: `50 * $198.4603 = $9,923.015`.
   - Exit Slippage Paid: `|198.4603 - 198.50| * 50 = $1.985`.
   - Exit Taker Fee (0.05%): `$9,923.015 * 0.0005 = $4.9615`.
   - Cash equity credited with net remaining proceeds: `($198.4603 - $200.04) * 50 - $4.9615 = -$83.9465`.
5. **Trade Accounting Reconciliation:**
   - **Gross Price P&L:** `($198.4603 - $200.04) * 50 = -$78.985` (already embeds $3.985 total slippage).
   - **Net Trade P&L:** `-$78.985 - $5.001 (entry fee) - $4.9615 (exit fee) - $2.00 (funding) = -$90.9475`.
   - **Total Account Equity Impact:** `-$5.001 + (-$2.00) + (-$83.9465) = -$90.9475`.
   - Net Trade P&L equals exact Account Equity change.

---

## 4. Top Performing Contracts Breakdown

- **NVDAUSDT:** 30 trades, 53.3% win rate, Net P&L: $178.08
- **QCOMUSDT:** 4 trades, 50% win rate, Net P&L: $22.77
- **AVGOUSDT:** 4 trades, 50% win rate, Net P&L: $7.69
- **SNDKUSDT:** 6 trades, 50% win rate, Net P&L: $4.63
- **AMDUSDT:** 4 trades, 50% win rate, Net P&L: $-5.32
- **SOXLUSDT:** 23 trades, 47.8% win rate, Net P&L: $-19.17
- **WMTUSDT:** 4 trades, 50% win rate, Net P&L: $-24.35
- **SMCIUSDT:** 3 trades, 33.3% win rate, Net P&L: $-35.9
- **MUUSDT:** 12 trades, 41.7% win rate, Net P&L: $-48.41
- **SQQQUSDT:** 5 trades, 40% win rate, Net P&L: $-61.74
- **MSFTUSDT:** 24 trades, 45.8% win rate, Net P&L: $-77.29
- **COSTUSDT:** 10 trades, 40% win rate, Net P&L: $-106.76
- **RKLBUSDT:** 2 trades, 0% win rate, Net P&L: $-109.69
- **PLTRUSDT:** 14 trades, 42.9% win rate, Net P&L: $-111.97
- **QQQUSDT:** 20 trades, 45% win rate, Net P&L: $-148.81
- **AMZNUSDT:** 20 trades, 40% win rate, Net P&L: $-235.29
- **AAPLUSDT:** 20 trades, 40% win rate, Net P&L: $-247.53
- **TSLAUSDT:** 23 trades, 39.1% win rate, Net P&L: $-250.72
- **SPYUSDT:** 59 trades, 28.8% win rate, Net P&L: $-1549.05

---

## 5. Historical Data Coverage & Integrity Audit

Direct programmatic audit of all 50 candle files in `data/history/`:
- **Universe Inspected:** 25 symbols x 2 granularities (15m and 4h) = 50 total files.
- **Failed Downloads (0 bars from Bitget REST):** 3 files failed to download and contain 0 bars:
  - `TQQQUSDT_15m.json` (0 bars)
  - `SOXSUSDT_4h.json` (0 bars)
  - `BAUSDT_4h.json` (0 bars)
- **Short History (<90 days):** 4 files:
  - `AMATUSDT_15m.json` (62.5 days)
  - `BAUSDT_15m.json` (18.7 days)
  - `MSTRUSDT_15m.json` (33.3 days)
  - `SOXSUSDT_15m.json` (39.6 days)
- **Headline Replay Universe (>=90 days continuous data):** Exactly 19 Tokenized US Equity Perpetuals (plus BTCUSDT comparison):
  `SPYUSDT`, `QQQUSDT`, `NVDAUSDT`, `TSLAUSDT`, `AAPLUSDT`, `MSFTUSDT`, `AMZNUSDT`, `PLTRUSDT`, `SOXLUSDT`, `SQQQUSDT`, `MUUSDT`, `AMDUSDT`, `SNDKUSDT`, `SMCIUSDT`, `AVGOUSDT`, `QCOMUSDT`, `WMTUSDT`, `COSTUSDT`, `RKLBUSDT`.
- **Integrity Validation:** 0 gaps and 0 duplicate timestamps across all 19 headline contracts (14,400 to 14,600 15m bars and 866 to 1,000 4h bars per symbol). Full audit table is recorded in `reports/alpha-factory/coverage_audit.md`.

---

## 6. Honest Methodological Disclosures

1. **Net Reward-to-Risk Design Filter:** Scans and proposals require net R:R >= 1.5. Target prices are calculated from ATR multiples subject to this minimum floor. The 1.5 ratio is a **strict design filter**, not evidence of market edge.
2. **Ambiguous Bar Resolution:** Ambiguous bars (where both SL and TP price levels are within the high-low bar range) are resolved with conservative **stop-loss first** execution.
3. **Zero Look-Ahead Bias:** Indicators at bar `i` evaluate exclusively bars `0..i`. 4h trend calculations strictly use closed 4h candles. Orders fill at the open of bar `i+1` plus slippage.
4. **Funding Rates:** Bitget's `history-fund-rate` for equity perpetuals shows zero rates in current history; a standard 0.01% per 8h funding cost was applied to model adverse carry.
5. **Sharpe Decay Interpretation:** When In-Sample Sharpe is negative, dividing two negative numbers produces a positive decay ratio (`1.569`). The standard decay ratio is not economically meaningful when the in-sample strategy did not generate positive excess return.
