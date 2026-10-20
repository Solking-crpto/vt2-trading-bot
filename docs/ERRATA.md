# VT2 Documentation Errata & Rule Reconciliation

**Document Version:** 1.0.0  
**Audit Date:** 2026-10-20  
**Target Branch:** `v2` (for future publication review; `main` remains untouched)

---

## 1. Discrepancy Matrix: Configuration vs Backtest Engine vs Live Strategy Engine

The quantitative backtest (`AlphaPortfolioEngine`), the live execution/scanning engine (`StrategyEngine` / `PaperExecutionEngine`), and the frozen configuration (`config/alpha-strategy.json`) exhibit several operational divergences:

| Strategy Rule | Listed in `config/alpha-strategy.json` | Applied by `AlphaPortfolioEngine` (v1 Backtest) | Applied by Live `StrategyEngine` (Scanner) | Reconciliation Notes & Discrepancies |
|---|---|---|---|---|
| **4h Trend Alignment** | `trend4h.alignmentRequired: true` (`ema20 > ema50 > ema200`) | **Partially Applied:** Evaluates `ema20 > ema50 && close > ema50` (or `<` for short). Does **not** check `ema200`. | **Partially Applied:** Evaluates `close > ema20` (or `<` for short). Does **not** check `ema50` or `ema200`. | Neither the backtest nor the live engine enforced the full 3-EMA stack (`ema20 > ema50 > ema200`). |
| **5m Volume Confirmation** | `execution5m.volumeConfirmation: true`, `rvolMin: 1.2` | **NOT Applied:** Function `synthesize5mFrom15m` was defined in the module but **never invoked** in `runSimulation`. | **Scoring Only:** Evaluates `isVolumeSpike \|\| rvol >= 1.2`, but only adds +15 points to the ranking score. Does **not** reject unqualified setups. | 5m volume confirmation was not a hard barrier in either engine. |
| **15m RVOL Spike** | `entry15m.volumeMultiplierThreshold: 1.5` | **NOT Applied:** Ignored during bar signal evaluation in the backtest replay. | **Scoring Only:** Included in relative volume calculations for ranking, but does not trigger rejection. | Configured as an indicator rule, but not implemented as a gating filter. |
| **RSI Momentum Corridor** | Long: `42 <= RSI <= 68`<br>Short: `32 <= RSI <= 58` | **Strictly Applied:** Evaluates 15m RSI(14) against exact bounds (42–68 for Longs, 32–58 for Shorts). | **Different Filter:** Rejects `RSI > 72` (Long overbought) and `RSI < 28` (Short oversold). Does **not** enforce the narrow 42–68 / 32–58 corridor. | Backtest used a tight entry corridor; live engine used a wide extreme-reversal rejection filter. |
| **Macro Benchmark (SPY)** | `benchmarkSymbol: "SPYUSDT"` | **Strictly Applied:** Only permits Longs when SPY 4h close > EMA50/EMA20 (Shorts when < EMA50/EMA20). | **Strictly Applied:** Rejects trades divergent from SPY 4h trend (`STOCK_BENCHMARK_DIVERGENCE`). | Fully consistent across config, backtest, and live engine. |
| **Signal Freshness / Age** | `maxSignalAgeMinutes: 10` | **N/A (Discrete Replay):** Backtest executes on closed 15m bars and fills at the exact next bar open (`t + 15m`). | **Strictly Applied:** Rejects candles older than 10 minutes (`currentTime - lastCandleTs > 10m`). | Consistent adaptation for discrete simulation vs streaming live ticks. |
| **Post-Trade Cooldown** | `cooldownMinutes: 30` | **Strictly Applied:** `currentTs - lastTradeClosedAt < 30m` blocks all new entry signals. | **Strictly Applied:** Enforced by `RiskEngine` and `AutoTrader` (`COOLDOWN_ACTIVE`). | Fully consistent. |
| **Min Net Reward-to-Risk (1.5)** | `minNetRewardToRisk: 1.5` | **Approximated:** Calculates target level directly as `stopDistance * 1.5 * 1.05`; does not evaluate dynamic post-cost fee drag. | **Strictly Applied:** Calls `calculateNetRewardRisk()` with contract fees and slippage; rejects if `netRR < 1.5`. | Live scanner applies post-cost mathematical check; backtest set target distance proportionally. |
| **Stop Distance Band** | Min: `0.5%`, Max: `0.8%`, ATR mult: `1.5` | **Strictly Applied:** Clamps stop distance between `0.005 * price` and `0.008 * price`. | **Strictly Applied:** Clamps raw stop distance percentage to `[0.005, 0.008]`. | Fully consistent. |
| **Partial Take Profit (+1.1% ROI)** | `partialTakeProfitRoi: 0.011`, ratio: `0.50`, offset: `0.0005` | **Strictly Applied:** Closes 50% at +1.1% ROI, moves stop to breakeven + 0.05%. | **Strictly Applied:** In `PaperExecutionEngine`, executes partial TP and ratchets stop. | Fully consistent. |
| **Trailing Stop (5m EMA20)** | `trailingStopRoiThreshold: 0.10`, `timeframe: "5m"` | **NOT Applied:** `AlphaPortfolioEngine` did not implement 5m trailing ATR logic. | **Strictly Applied:** `PaperExecutionEngine` activates 5m EMA trailing stop after +10% peak ROI. | Omitted in backtest; present in live engine. |
| **Early Exit on RSI Reversal** | `earlyExitOnRsiReversal: true` | **NOT Applied:** `AlphaPortfolioEngine` did not check intraday RSI reversals on open positions. | **Strictly Applied:** `PaperExecutionEngine` exits long if 15m RSI drops < 45. | Omitted in backtest; present in live engine. |

---

## 2. Inaccurate Statements in Published Project Documentation

The following statements in project documentation do not match what the backtest engine (`AlphaPortfolioEngine`) actually executed:

### A. `README.md`
- **Statement (Line 133):** *"Performs multi-timeframe trend alignment using 4h, 15m, and 5m exponential moving averages (EMA20/50/200), RSI momentum filters, and volume expansion confirmation."*
  - **Correction:** The backtest engine evaluated only 4h and 15m EMAs, never inspected 5m candles, did not evaluate EMA200, and did not enforce volume expansion confirmation.
- **Statement (Line 99):** Mermaid diagram node: `MTF["Multi-Timeframe Analysis (4h / 15m / 5m)"]`.
  - **Correction:** In the backtest, only 4h and 15m timeframes were processed. 5m synthesis was present in code but uncalled.
- **Statement (Line 136):** *"trailing stops following 5m EMA20 after 10% ROI..."*
  - **Correction:** While implemented in `PaperExecutionEngine`, this rule was **not** evaluated in the backtest replay.

### B. `SUBMISSION.md`
- **Statement (Line 37):** *"Requires directional alignment of EMA20 > EMA50 > EMA200 on both 4h and 15m timeframes."*
  - **Correction:** The backtest evaluated `ema20 > ema50 && close > ema50`. EMA200 was not part of the condition.
- **Statement (Line 38):** *"RSI Momentum Corridor: Enforces 15m RSI between 42 and 68 for Longs..."*
  - **Correction:** Accurate for the backtest, but inaccurate for the live scanner (which enforced `< 72` and `> 28`).

### C. `reports/alpha-factory/report.md`
- **Statement (Line 129):** *"Scans and proposals require net R:R >= 1.5. Target prices are calculated from ATR multiples subject to this minimum floor."*
  - **Correction:** In `AlphaPortfolioEngine`, targets were set at `stopDistance * 1.5 * 1.05`, but there was no explicit validation that post-cost net R:R met or exceeded 1.5.

### D. `public/report.html`
- Contains identical summary claims to `reports/alpha-factory/report.md` regarding 3-timeframe alignment and 5m volume confirmation.

---

## 3. Publication Recommendation
These errata should be incorporated into the final public documentation release to maintain strict research transparency and avoid overstating the degree of multi-timeframe filtering in the v1 backtest.
