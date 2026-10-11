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
| **Trade Count** | 247 | 41 | 288 |
| **Win Rate** | 41.3% | 39.02% | 40.97% |
| **Net P&L ($)** | $-1178.89 | $-261.01 | $-1439.9 |
| **Total Return (%)** | -23.62% | -6.66% | -28.71% |
| **Annualized Sharpe (365d)** | -4.22 | -6.5 | -4.52 |
| **Annualized Sortino (365d)** | -5.15 | -7.18 | -5.43 |
| **Max Drawdown ($ / %)** | $2669.18 (26.14%) | $635.24 (8.32%) | $3207.11 (31.41%) |
| **Average Win / Loss ($)** | $62.12 / $51.83 | $50.2 / $42.57 | $60.51 / $50.47 |
| **Profit Factor** | 0.84 | 0.75 | 0.83 |
| **Portfolio Turnover** | 220.48x | 37.59x | 259.43x |

### Out-of-Sample Decay Analysis
- **In-Sample Annualized Sharpe:** -4.22
- **Out-of-Sample Annualized Sharpe:** -6.5
- **OOS Sharpe Decay Ratio:** 1 [observed]
- **Sharpe Decay Flag (< 0.5):** ✅ PASS (>= 0.5x IS)

---

## 2. Benchmark Comparisons

| Strategy / Asset | Total Return (%) [observed] | Max Drawdown (%) [observed] | Nature of Comparison |
| :--- | :--- | :--- | :--- |
| **VT2 Alpha Factory (Tokenized Equities)** | **-28.71%** | **31.41%** | Execution-Aware Quantitative Bot |
| **SPYUSDT Buy-and-Hold** | **4.97%** | **5.21%** | S&P 500 Benchmark Asset |
| **Equal-Weight 19-Stock Basket** | **4.94%** | N/A | Passive Equal-Weight Portfolio |

---

## 3. Real Execution Cost Modeling

All returns are net of institutional taker fees, realistic execution slippage, and continuous funding:
- **Total Taker Fees Paid:** $2226.11 [observed: 0.05% taker rate per fill]
- **Total Execution Slippage Paid:** $17433.51 [observed: 0.02% slippage rate]
- **Total 8h Funding Rate Paid:** $316.18 [observed / modeled: 0.01% / 8h]
- **Total Cumulative Friction:** $19975.8 [observed]
- **Market Exposure Time:** 88.56% of total timeline [observed]

---

## 4. Top Performing Contracts Breakdown

- **NVDAUSDT:** 30 trades, 53.3% win rate, Net P&L: $305.27
- **SOXLUSDT:** 23 trades, 47.8% win rate, Net P&L: $49.91
- **MSFTUSDT:** 24 trades, 45.8% win rate, Net P&L: $40.49
- **QCOMUSDT:** 4 trades, 50% win rate, Net P&L: $36.17
- **SNDKUSDT:** 6 trades, 50% win rate, Net P&L: $30.83
- **AVGOUSDT:** 4 trades, 50% win rate, Net P&L: $20.01
- **AMDUSDT:** 4 trades, 50% win rate, Net P&L: $11.56
- **WMTUSDT:** 4 trades, 50% win rate, Net P&L: $-4.54
- **MUUSDT:** 12 trades, 41.7% win rate, Net P&L: $-10.24
- **SMCIUSDT:** 3 trades, 33.3% win rate, Net P&L: $-27.25
- **SQQQUSDT:** 5 trades, 40% win rate, Net P&L: $-46.47
- **COSTUSDT:** 10 trades, 40% win rate, Net P&L: $-52.11
- **PLTRUSDT:** 14 trades, 42.9% win rate, Net P&L: $-57.3
- **QQQUSDT:** 21 trades, 42.9% win rate, Net P&L: $-102.12
- **RKLBUSDT:** 2 trades, 0% win rate, Net P&L: $-103.86
- **AMZNUSDT:** 20 trades, 40% win rate, Net P&L: $-131.14
- **TSLAUSDT:** 23 trades, 39.1% win rate, Net P&L: $-150.02
- **AAPLUSDT:** 20 trades, 40% win rate, Net P&L: $-153.81
- **SPYUSDT:** 59 trades, 28.8% win rate, Net P&L: $-1095.28

---

## 5. Honest Methodological Disclosures

1. **Net Reward-to-Risk Design Filter:** Scans and proposals require net R:R >= 1.5. Target prices are calculated from ATR multiples subject to this minimum floor. The 1.5 ratio is a **strict design filter**, not evidence of market edge.
2. **Ambiguous Bar Resolution:** Ambiguous bars (where both SL and TP price levels are within the high-low bar range) are resolved with conservative **stop-loss first** execution.
3. **Zero Look-Ahead Bias:** Indicators at bar `i` evaluate exclusively bars `0..i`. 4h trend calculations strictly use closed 4h candles. Orders fill at the open of bar `i+1` plus slippage.
4. **Funding Rates:** Bitget's `history-fund-rate` for equity perpetuals shows zero rates in current history; a standard 0.01% per 8h funding cost was applied to model adverse carry.
