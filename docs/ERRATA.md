# VT2 Documentation Errata & Rule Reconciliation

**Document Version:** 1.1.0  
**Audit Date:** 2026-10-21  
**Target Branch:** `erratum` / `v2`  
**Reference Deliverables:** `reports/audit/rules_source_lines.txt`, `reports/audit/v1_realized_net_rr.txt`, `reports/audit/s0_replay_results.txt`

---

## 1. Discrepancy Matrix: Configuration vs Backtest Engine vs Live Strategy Engine

The quantitative backtest (`AlphaPortfolioEngine`), the live execution/scanning engine (`StrategyEngine` / `PaperExecutionEngine` / `RiskEngine`), and the frozen configuration (`config/alpha-strategy.json`) exhibit several operational divergences:

| Strategy Rule | Listed in `config/alpha-strategy.json` | Applied by `AlphaPortfolioEngine` (v1 Backtest) | Applied by Live `StrategyEngine` (Scanner) | Exact Code Line Citations |
|---|---|---|---|---|
| **Target Formula** | `stopsAndTargets.targetMethod: "ATR_MULTIPLE"`, `minNetRewardToRisk: 1.5` | **Static Target:** Sets `targetDistance = stopDistance * 1.5 * 1.05 = stopDistance * 1.575`. No dynamic ATR multiple. | **ATR Multiple Clamped:** Sets `targetPct = Math.min(0.03, Math.max(0.011, (atr15m * 1.8) / entryPrice))`. Clamped to 1.1%–3.0%. | `src/backtest/alpha-portfolio-engine.js:446-449`<br>`src/strategy/engine.js:236-240, 250-254` |
| **Macro Benchmark (SPY)** | `benchmarkSymbol: "SPYUSDT"` | **Strictly Applied:** Evaluates SPYUSDT 4h `close > ema50`. Gates Long on BULLISH, Short on BEARISH. | **Strictly Applied:** Rejects trades divergent from SPY 4h trend with `STOCK_BENCHMARK_DIVERGENCE`. | `src/backtest/alpha-portfolio-engine.js:69, 79, 396, 422, 427`<br>`src/strategy/engine.js:70, 87, 198-214, 360-361` |
| **15m RVOL Spike** | `entry15m.volumeMultiplierThreshold: 1.5` | **NOT Applied:** Volume data loaded but never inspected or filtered during entry qualification. | **Scoring Only:** `isVolumeSpike \|\| rvol >= 1.2` awards +25 vs +10 ranking points; does not reject setups. | `src/backtest/alpha-portfolio-engine.js` (unreferenced)<br>`src/strategy/engine.js:20, 279, 304` |
| **5m Confirmation** | `execution5m.volumeConfirmation: true`, `rvolMin: 1.2` | **NOT Applied:** `synthesize5mFrom15m` helper defined at line 24 but never called during replay simulation. | **Scoring Only:** Requires `>=30` 5m candles; computes 5m indicators and evaluates volume spike/RVOL for scoring. | `src/backtest/alpha-portfolio-engine.js:24` (uncalled)<br>`src/strategy/engine.js:142, 157, 279` |
| **RSI Momentum Bounds** | Long: `42 <= RSI <= 68`<br>Short: `32 <= RSI <= 58` | **Strictly Applied:** Evaluates 15m RSI against exact corridor (42–68 Long, 32–58 Short). | **Boundary Filter:** Rejects `RSI > 72` (Long) and `RSI < 28` (Short). Does not enforce inner bounds. | `src/backtest/alpha-portfolio-engine.js:424, 429`<br>`src/strategy/engine.js:280, 282, 291` |
| **4h Trend Alignment** | `trend4h.alignmentRequired: true` (`ema20 > ema50 > ema200`) | **Dual EMA Check:** Evaluates `ema20 > ema50 && close > ema50` (or `<` for Short). Does not check EMA200. | **Single EMA Check:** Evaluates `close > ema20` (or `<` for Short). Does not check EMA50 or EMA200. | `src/backtest/alpha-portfolio-engine.js:415-416`<br>`src/strategy/engine.js:176-177` |
| **Post-Trade Cooldown** | `rules.riskEngine.cooldownMinutes: 30` | **Strictly Applied:** `currentTs - lastTradeClosedAt < 30m` blocks all new entries. | **Strictly Applied:** Enforced in `RiskEngine` (`COOLDOWN_ACTIVE`, default 30 minutes). | `src/backtest/alpha-portfolio-engine.js:392, 395`<br>`src/risk-engine.js:206-218` |
| **Stop Distance Band** | Min: `0.5%`, Max: `0.8%`, ATR mult: `1.5` | **Strictly Applied:** Clamps stop distance between `0.005 * entry` and `0.008 * entry`. | **Strictly Applied:** Clamps max/min of 10-bar swing and `1.5 * ATR` between `0.005 * entry` and `0.008 * entry`. | `src/backtest/alpha-portfolio-engine.js:437-440`<br>`src/strategy/engine.js:228-234, 242-248` |
| **Min Net Reward-to-Risk** | `minNetRewardToRisk: 1.5` | **NOT Dynamically Validated:** Target price set at `stopDistance * 1.575`; net R:R after friction was not verified. | **Strictly Validated:** Calls `calculateNetRewardRisk()`; rejects if net R:R < 1.5 after taker fee and slippage. | `src/backtest/alpha-portfolio-engine.js:446`<br>`src/strategy/engine.js:258-276` |

---

## 2. Quantitative Correction: Realized Net Reward-to-Risk and Break-Even Win Rate

Documentation in `README.md`, `SUBMISSION.md`, and `reports/alpha-factory/report.md` claimed the strategy maintained a minimum 1.5:1 net reward-to-risk ratio. Empirical analysis of all 287 v1 trades (`reports/alpha-factory/trades.csv`) reveals:

1. **Stop & Target Distances:**
   - Average realized stop distance: **0.6111%** (clamped to 0.50%–0.80% band).
   - Average realized target distance: **0.8850%**.
   - Price distance ratio (target / stop): **1.4483:1**.
2. **Impact of Exchange Friction:**
   - On a 0.61% stop with $50 risk budget, round-trip friction (~0.14% in fees and slippage) amounts to ~$11.50 per trade.
   - Average winning trade net PnL: **+$55.93** (reduced from nominal ~$67.50).
   - Average losing trade net PnL: **-$55.73** (increased from nominal -$50.00).
3. **Realized Net R:R vs Break-Even:**
   - **Realized Net Reward-to-Risk:** **1.0036:1** (essentially 1:1, far below the claimed 1.5:1).
   - **Implied Break-Even Win Rate:** $1 / (1 + 1.0036) = \mathbf{49.91\%}$.
   - **Actual Realized Win Rate:** $118 / 287 = \mathbf{41.11\%}$.
   - **Structural Edge Deficit:** **-8.80%** below break-even, resulting in an average expectancy of **-$9.82 per trade** (-$2,818.83 total).

---

## 3. Discrepancies in Published Claims

The following statements in submission documentation do not match what the backtest or live engine actually executed:

### A. `README.md`
- **Statement:** *"Performs multi-timeframe trend alignment using 4h, 15m, and 5m exponential moving averages (EMA20/50/200), RSI momentum filters, and volume expansion confirmation."*
  - **Correction:** The backtest evaluated only 4h and 15m EMAs, never inspected 5m candles, did not evaluate EMA200, and did not enforce volume expansion confirmation.
- **Statement:** *"trailing stops following 5m EMA20 after 10% ROI..."*
  - **Correction:** Trailing stops were implemented in `PaperExecutionEngine`, but were **not** evaluated in the submission backtest replay.

### B. `SUBMISSION.md`
- **Statement:** *"Requires directional alignment of EMA20 > EMA50 > EMA200 on both 4h and 15m timeframes."*
  - **Correction:** The backtest evaluated `ema20 > ema50 && close > ema50`. EMA200 was not evaluated.
- **Statement:** *"Scans and proposals require net R:R >= 1.5."*
  - **Correction:** Target distances were nominally set at $1.575\times$ stop distance in the backtest without post-cost validation; realized net R:R after friction collapsed to 1.0036:1.

### C. Live Strategy Edge
- The strategy rules the application actually executes (`StrategyEngine.scanUniverse`) were **never backtested** prior to Prompt 13.
- When tested under rigorous chronological simulation (Candidate S0, Trial #35), the as-shipped strategy achieved:
  - Dev Split: Net P&L -$154.41, 40.80% WR, PF 0.99, Max DD 19.69%.
  - Validation Split: Net P&L -$647.91, 23.53% WR, PF 0.48, Max DD 25.07%.
  - **Verdict:** The app as shipped has no demonstrated edge on this data.
