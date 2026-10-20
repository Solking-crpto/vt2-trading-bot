# VT2 Strategy v2: Comprehensive Research Conclusion (5-Month Window)

**Evaluation Period:** May 11, 2026 – October 10, 2026 (151.7 days)  
**Universe:** 19 Verified Bitget Tokenized US Equity Perpetuals & Top Crypto Perpetuals  
**Branch:** `v2`  
**Protocol:** Pre-Registered Multi-Segment Replay (Dev, Validation, Locked Forward Holdout)  

---

## 1. Executive Summary & Trial Accounting

Across two pre-registered quantitative research rounds, a total of **22 independent strategy trials** were conducted under strict zero look-ahead and execution modeling:

| Round | Candidate | Session Mode | Universe | Splits Tested | Total Trials | Passing Candidates |
|---|---|---|---|---|---|---|
| **Ablation** | Trial 0 (v1 Baseline Ablation) | E0 (24/7) | Equity | Dev | 1 | None |
| **Round 1** | C0 (v1 Baseline) | E0 (24/7) | Equity | Dev, Validation | 2 | None |
| **Round 1** | C1 (15m Pullback in 1h Trend) | E0, E1 (RTH) | Equity | Dev, Validation | 4 | None |
| **Round 1** | C2 (4h Donchian Breakout) | E0, E1 (RTH) | Equity | Dev, Validation | 4 | None |
| **Round 2** | R2-A (4h Donchian Breakout 55-Bar) | E0, E1 | Equity, Crypto | Dev, Validation | 6 | None |
| **Round 2** | R2-B (15m Pullback Maker Execution) | E0, E1 | Equity, Crypto | Dev, Validation | 6 | None |
| **Long-History** | L1 (100d SMA Trend Filter) | 24/7 | BTC + ETH (50/50) | Dev (2019-2023), Val (2024-2025) | 2 | None |
| **TOTALS** | — | — | — | — | **25 Experimental Runs** | **0 Passed** |

*(Note: Candidates C3, C4, C5 do not exist; previous text referencing "[C1-E0 through C5-E1]" was an unverified narrative error. Round 1 contained only C0, C1, and C2).*

### Round 2 Crypto Data Truncation Notice
All 4 Round 2 Crypto trials (R2-A Dev [9 trades], R2-A Val [3 trades], R2-B Dev [13 trades], R2-B Val [20 trades]) are marked **NOT EVALUABLE**:
- **Severe Sample Truncation:** Each split had fewer than the pre-registered 30-trade minimum sample threshold.
- **Missing Universe Data:** 8 of the 10 configured crypto symbols (`SOL`, `XRP`, `DOGE`, `SUI`, `PEPE`, `ADA`, `AVAX`, `NEAR`) had 0 bars in `data/history/`. Only `BTCUSDT` had Dev bars, and only `BTCUSDT` and `ETHUSDT` had Validation bars. Consequently, these crypto runs cannot be evaluated as representing the multi-asset crypto universe.

> [!CAUTION]
> **Definitive Scientific Verdict: NONE of the 25 experimental runs achieved the pre-registered dual-split pass criteria.**
> In strict accordance with the pre-registration protocol, the **Forward Holdout Splits (October 10, 2026 to Present for 5-month, and 2026 to Present for L1) were KEPT STRICTLY CLOSED** to prevent holdout contamination and selective reporting.

---

## 2. The Cost-Versus-Signal Empirical Finding

A primary quantitative question addressed across these trials was whether strategy failure is driven by **pure cost friction** or by **negative signal edge**:

1. **Candidate C1 (15m Pullback with Taker Execution): Negative Signal Edge:**
   - Candidate C1 incurred gross losses of **-$2,724.67** on Dev *before deducting exchange fees and slippage* (from `reports/strategy-v2/trades.csv`).
   - The underlying signal itself has negative expectancy in tokenized equity perpetuals.
   - Total friction of **$3,544.82** (Fees ~$2,357.65, Slippage ~$1,113.31, Funding ~$73.86) compounded this negative signal into an unsustainable **64.0% drawdown** across 443 trades (net win rate 14.67%, gross win rate 48.08%, net P&L -$6,269.49).

2. **v1 Baseline: Flat Signal Edge Swallowed by Friction:**
   - v1 produced a gross P&L of **-$160.99** over 246 in-sample trades (~flat before costs).
   - Taker fees ($1,940.68), slippage ($776.30), and continuous funding ($258.50) totaled **$2,975.48 in friction**, directly generating the net loss of -$2,360.18.

3. **Candidate C2 (4h Breakout Trend-Follower): Modest Positive Edge, Insufficient for Taker Fees:**
   - C2 achieved positive gross P&L (**+$39.59**) on Dev over 61 trades.
   - Longer holding periods (~62.4 hours) reduced total friction by 80% ($429.03 vs $4,227.07 for C1).
   - However, the gross edge was too narrow to absorb the 0.06% taker fee and 0.02% slippage on exits.

4. **Candidate R2-B: Maker Execution & Simulation Limitations:**
   - Candidate R2-B (15m pullback with passive limit entry at EMA20) generated positive Dev Net P&L (**+$392.80**) in regular trading hours (`Equity-E1`), remaining positive under cost-doubling stress (**+$277.35**).
   - **However, R2-B failed validation:** Its Dev Profit Factor was 1.08 (falling short of the pre-registered 1.25 threshold), and it broke down out-of-sample on Validation (**-$313.31** Net P&L).
   - **Maker-Fill Model Limitation (Optimism Bias):** The backtest's through-tick maker fill model assumes guaranteed execution at the exact limit price with zero slippage. In live markets, this model is optimistic because:
     - *Queue Position:* Passive orders sit at the back of the order book queue; a bar trading through by a fraction of a cent does not guarantee execution if queue depth is depleted.
     - *Adverse Selection:* Maker limit orders suffer from toxic order flow—fills occur with higher probability when market momentum aggressively cuts through the level, leading to adverse post-fill price movement.

---

## 3. Scientific Conclusion on the 5-Month Window

The 5-month dataset (May 11 to October 10, 2026) has been rigorously probed across multi-timeframe trend-following, intraday pullbacks, session gating, cost gating, and maker execution.

**Conclusion:**
> **Further parameter tuning, indicator tweaking, or rule optimization on this 5-month window is mathematically meaningless.**

Any additional rule adjustments made on this window would constitute retroactive data mining and p-hacking. The empirical evidence demonstrates that on this 5-month timeframe:
- Tokenized equity perpetuals lack sufficient persistent trending momentum to overcome exchange taker fees on intraday timeframes.
- High-frequency intraday trades (15m) suffer severe friction penalties relative to stop distance.
- Robust alpha verification requires multi-year historical datasets across complete market cycles rather than further iteration on a single 5-month slice.
