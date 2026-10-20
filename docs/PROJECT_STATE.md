# VT2 Project State & Quantitative Repository Facts

**Document Version:** 1.0.0  
**Timestamp:** 2026-10-20T22:30:00.000Z  
**Branch:** `v2` (Git head: clean)  
**Preservation Tag:** `hackathon-submission` (Preserved and untouched)  
**Main Branch:** Untouched  

This document contains strictly verifiable facts backed directly by files and tests in the repository.

---

## 1. Git Repository State & Preservation

| Component | Status | Verification Reference |
| :--- | :--- | :--- |
| **`main` Branch** | Untouched since submission | `git rev-parse main` |
| **`hackathon-submission` Tag** | Bit-for-bit preserved | `git show-ref --tags hackathon-submission` |
| **`v2` Branch** | Active research & hardening branch | Current working HEAD |
| **`reports/alpha-factory/`** | Strictly preserved, unmodified | Bit-for-bit identical to `hackathon-submission` |
| **`config/alpha-strategy.json`** | Strictly preserved, unmodified | Bit-for-bit identical to `hackathon-submission` |
| **`src/backtest/alpha-portfolio-engine.js`**| Reverted to tagged submission | `git diff hackathon-submission -- src/backtest/alpha-portfolio-engine.js` is empty |

---

## 2. Test Suite & Integrity

- **Test Command:** `npm test`
- **Total Tests:** `122`
- **Passing:** `122`
- **Failing:** `0`
- **Execution Speed:** ~5.9 seconds
- **Key Invariants Enforced by Tests:**
  - Mainnet execution is strictly blocked (`validateExecutionMode` rejects LIVE without credentials and confirmation phrase).
  - Withdrawal and transfer API endpoints are forbidden and blocked by assertion tests.
  - No secrets/keys are logged or transmitted.
  - Zero look-ahead bias in indicator computation and 4h bar alignment.
  - Monotonic cost sensitivity (increasing slippage strictly decreases net P&L for fixed trade lists).
  - Deterministic replay reproducibility.

---

## 3. Strategy Rules & Exact Implementation Locations

| Rule | Stated in `config/alpha-strategy.json` | `AlphaPortfolioEngine` (v1 Backtest) | Live `StrategyEngine` / `RiskEngine` | Status & Consistency Notes |
| :--- | :--- | :--- | :--- | :--- |
| **4h Trend Alignment** | `rules.indicators.trend4h`: `emaFast: 20`, `emaMedium: 50`, `emaSlow: 200` | `src/backtest/alpha-portfolio-engine.js:415-416` (`ema20 > ema50 && close > ema50`) | `src/strategy/engine.js:140-141` (`close > ema20` for Long, `< ema20` for Short) | Partial in both; neither engine checks 3-EMA alignment (`ema20 > ema50 > ema200`). |
| **15m RSI Momentum Band** | `rules.indicators.entry15m`: Long `42–68`, Short `32–58` | `src/backtest/alpha-portfolio-engine.js:424, 429` (`rsi >= 42 && rsi <= 68`) | `src/strategy/engine.js:148, 155` (Rejects `rsi > 72` or `< 28`) | Backtest uses narrow 42–68 corridor; live engine rejects extreme overbought/oversold. |
| **15m RVOL Spike** | `rules.indicators.entry15m.volumeMultiplierThreshold: 1.5` | **NOT APPLIED** | `src/strategy/engine.js:164-167` (Adds +15 to ranking score) | Not a gating entry rejection in either engine. |
| **5m Pullback / Confirmation** | `rules.indicators.execution5m`: `volumeConfirmation: true`, `rvolMin: 1.2` | **NOT APPLIED** (`synthesize5mFrom15m` uncalled) | **NOT APPLIED** (Operates only on 15m/4h) | Completely omitted from both execution pipelines. |
| **SPY Benchmark Filter** | `benchmarkSymbol: "SPYUSDT"` | `src/backtest/alpha-portfolio-engine.js:396, 422, 427` | `src/strategy/engine.js:126-135` (`STOCK_BENCHMARK_DIVERGENCE`) | Fully consistent and enforced in both engines. |
| **Signal Freshness (<10m)** | `rules.riskEngine.maxSignalAgeMinutes: 10` | **N/A** (Discrete historical replay) | `src/risk-engine.js:246-255`, `src/strategy/engine.js:106` | Enforced live; N/A in discrete simulation. |
| **Post-Trade Cooldown (30m)** | `rules.riskEngine.cooldownMinutes: 30` | `src/backtest/alpha-portfolio-engine.js:392` (`currentTs - lastTradeClosedAt < 30m`) | `src/risk-engine.js:231-240` (`COOLDOWN_ACTIVE`) | Fully consistent (30 minutes). |
| **Min Net R:R (1.5)** | `rules.stopsAndTargets.minNetRewardToRisk: 1.5` | `src/backtest/alpha-portfolio-engine.js:446` (Sets target = `stopDistance * 1.5 * 1.05`) | `src/risk-engine.js:275-285` (`INSUFFICIENT_NET_REWARD_TO_RISK`) | Live RiskEngine checks dynamic post-cost fee drag; backtest scaled target proportionally. |
| **Stop Distance Band (0.5%–0.8%)**| `minStopDistancePercent: 0.005`, `maxStopDistancePercent: 0.008` | `src/backtest/alpha-portfolio-engine.js:437-440` (Clamps to `[0.005, 0.008]`) | `src/risk-engine.js:288-310`, `src/strategy/engine.js:11-12` | Fully consistent (0.5% to 0.8%). |
| **RSI Reversal Early Exit** | `rules.lifecycleExits.earlyExitOnRsiReversal: true` | **NOT APPLIED** | `src/execution/paper-engine.js:347-353` (Exits long if `rsi < 45`) | Enforced in paper execution; omitted in backtest engine. |

---

## 4. Execution Friction & Cost Constants

- **Exchange Fee Rates:** Verified from live Bitget contracts endpoint (`https://api.bitget.com/api/v2/mix/market/contracts?productType=usdt-futures`):
  - **Taker Fee:** `0.06%` (`0.0006`)
  - **Maker Fee:** `0.02%` (`0.0002`)
- **Slippage Assumption:** `0.02%` (`0.0002`, 2 basis points)
- **Historical Carry Funding Rate:** Verified from Bitget historical funding endpoint (`https://api.bitget.com/api/v2/mix/market/history-fund-rate` for BTCUSDT):
  - Empirical 270-interval mean: `+0.00532%` per 8 hours (annualized ~5.82%)
  - Backtest flat assumption: `0.0100%` per 8 hours (annualized 10.95%)

---

## 5. Quantitative Replay Results Across All Rounds

### A. Published v1 Baseline (`reports/alpha-factory/metrics.json`)
- **Period:** 151.7 days (May 11, 2026 – October 10, 2026, 14,601 bars)
- **Universe:** 19 tokenized US equity perpetuals
- **Trades:** 287 (In-Sample: 246, Out-of-Sample: 41)
- **Net P&L:** `-$2,818.83` (In-Sample: `-$2,360.18`, Out-of-Sample: `-$458.65`)
- **Win Rate:** `41.11%` (In-Sample: `41.46%`, Out-of-Sample: `39.02%`)
- **Profit Factor:** `0.70`
- **Total Friction:** `$3,430.65` (Taker Fees: `$2,223.72`, Slippage: `$889.52`, Funding: `$317.42`)
- **Max Drawdown:** `$3,162.53` (`30.98%`)

### B. Strategy v2 Round 1 Pre-Registered Trials (`reports/strategy-v2/metrics.json`)
- **Candidates Tested:** C0 (v1 Baseline), C1 (15m Pullback 1h Trend), C2 (4h Donchian Breakout)
- **Total Trials:** 10 trials across E0 (24/7), E1 (RTH), Dev, and Validation splits.
- **Passing Candidates:** **0 / 10** (None met pre-registered dual-split criteria).
- **Key Finding:** C1 suffered negative gross expectancy (`-$2,724.67` gross loss on Dev), amplified by friction into a `64.0%` drawdown. C2 had positive gross expectancy (`+$39.59` on Dev), but was swallowed by taker fees.

### C. Strategy v2 Round 2 Pre-Registered Trials (`reports/strategy-v2/metrics-r2.json`)
- **Candidates Tested:** R2-A (4h Breakout 55-bar), R2-B (15m Pullback Maker Execution)
- **Total Trials:** 12 trials across Equity and Crypto universes.
- **Passing Candidates:** **0 / 12**.
- **Crypto Evaluability Notice:** All 4 crypto trials (R2-A Dev, R2-A Val, R2-B Dev, R2-B Val) are marked **NOT EVALUABLE** due to severe sample truncation (<30 trades: 9, 3, 13, 20 trades) and missing data (8 of 10 configured crypto symbols have 0 bars in `data/history/`).

### D. Candidate L1 Multi-Year Long-History Test (`reports/strategy-v2/metrics-l1.json`)
- **Strategy:** Equal-weight BTC/ETH long when `Close > 100-day SMA`, otherwise flat.
- **Data Range:** 2019-11-17 to 2025-12-31 (2,237 daily bars).
- **Dev Split (2019-2023):** L1 Return `+702.78%`, Max DD `51.87%` (B&H Return `+779.37%`, Max DD `77.90%`). DD ratio: `0.67x` (**FAILS** $\le 0.60\times$ criterion).
- **Validation Split (2024-2025):** L1 Return `+44.80%`, Max DD `41.82%` (B&H Return `+67.31%`, Max DD `41.60%`). DD ratio: `1.01x` (**FAILS** $\le 0.60\times$ criterion).
- **Verdict:** **FAILS** pre-registered pass criteria against both raw and cost-adjusted benchmarks.
- **Forward Holdout Status:** The 2026 Forward Holdout partition remains **STRICTLY LOCKED AND UNOPENED**.

---

## 6. What Is Untested & Execution Boundaries

1. **Live Mainnet Trading:** Zero real capital has ever been committed. No order has ever been submitted to Bitget private/authenticated execution endpoints. LIVE mode is disabled and guarded by multi-layer hardware/environment gates.
2. **Maker Limit Fill Realism:** Maker backtests (R2-B) assume 100% queue fills at limit prices with zero adverse selection. True maker fill probability in live order books will experience queue priority delay and toxic order flow.
3. **Crypto Historical Universe:** Only BTC and ETH have continuous historical data in the local database. The remaining 8 symbols in `config/crypto-perps.json` have not been backtested.
