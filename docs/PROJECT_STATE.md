# VT2 Project State & Quantitative Repository Facts

**Document Version:** 2.0.0 (Release Hardening & Advisory AI Analyst)  
**Timestamp:** 2026-10-21T23:15:00.000Z  
**Branch:** `v2`  
**Preservation Tag:** `hackathon-submission` (Preserved and untouched)  
**Main Branch:** `main` (Preserved and untouched)  

This document contains strictly verifiable facts backed directly by files and tests in the repository.

---

## 1. Git Repository State & Preservation

| Component | Status | Verification Reference |
| :--- | :--- | :--- |
| **`main` Branch** | Untouched since submission | `git rev-parse main` |
| **`hackathon-submission` Tag** | Bit-for-bit preserved | `git show-ref --tags hackathon-submission` |
| **`v2` Branch** | Active hardening & release branch | Current working HEAD |
| **`reports/alpha-factory/`** | Strictly preserved, unmodified | Bit-for-bit identical to `hackathon-submission` |
| **`config/alpha-strategy.json`** | Strictly preserved, unmodified | Bit-for-bit identical to `hackathon-submission` |
| **`src/backtest/alpha-portfolio-engine.js`**| Reverted to tagged submission | `git diff hackathon-submission -- src/backtest/alpha-portfolio-engine.js` is empty |

---

## 2. Release Hardening & Modernization Progress (Prompt 14)

### Step 1: Baseline Health Snapshot
- **Status:** COMPLETED (Commit `91f2b4f`)
- **Artifacts Saved:** `reports/release/01_baseline/`
  - `health.json`: Health endpoint verification (`status: OK`)
  - `system_health.json`: Extended system metrics and memory usage
  - `scans.txt`: Stock, Crypto, and Both scans (asset purity, candidate ranking)
  - `freshness.txt`: Timestamp freshness across 5 equity perpetuals
  - `heartbeat.txt`: WebSocket heartbeat status (latency & data age)
  - `db_file.txt`: Node.js native `node:sqlite` database stats and table counts
  - `npm_test.txt`: Baseline test run (126 passing)

### Step 2: Honest Strategy Status Inside Product
- **Status:** COMPLETED (Commit `50779b6`)
- **Files Modified/Created:**
  - `src/strategy/registry.js`: Strategy Registry defining S0 status as `"UNVALIDATED: failed pre-registered replay (trial 35)"` and mandatory confirmation phrase `"I UNDERSTAND THIS STRATEGY HAS NOT PASSED VALIDATION"`.
  - `public/index.html`: Prominent amber warning banners across Automated Trading panel, AI Deliberation panel, and top navigation header pill.
  - `public/vt2-ui.js`: Interactive modal gating DEMO and LIVE mode transitions; order execution preview cards display clear unvalidated warnings.
  - `README.md`: Added "Status and limits" section; replaced promotional claims with strict empirical facts.
  - `tests/strategy-registry.test.js`: Added 3 tests validating metadata integrity, status formatting, and server API exposure.
  - `reports/release/02_strategy_status/`: Audit logs and test outputs.

### Step 3: Unattended Operation & PM2 Service
- **Status:** COMPLETED (Commit `3233d72`)
- **Files Modified/Created:**
  - `ecosystem.config.cjs`: PM2 process configuration with auto-restart, crash-loop backoff (max 10 restarts, 5s delay), and memory limits (512MB).
  - `package.json`: Added `service:start`, `service:stop`, `service:status` npm scripts.
  - `src/service/log-rotator.js`: Date-stamped logger (`logs/vt2-YYYY-MM-DD.log`) with automatic 14-day log retention cleanup.
  - `src/service/alert-dispatcher.js`: Outbound alerting for kill-switch activation, consecutive losses, and crash loops with 5s timeout and secret redaction.
  - `start.js` & `src/vt2-server.js`: Graceful shutdown handlers (`SIGTERM`, `SIGINT`) cleaning up active WebSocket and SSE sockets.
  - `scripts/forward-report.js`: Daily cron script generating `reports/forward-test/daily-YYYY-MM-DD.md`.
  - `tests/unattended-service.test.js`: Added 4 tests validating health endpoints, log rotation, alert redaction, and startup mode reset to PAPER.
  - `reports/release/03_service/`: Test logs and health verification.

### Step 4: CI & Repo Hygiene
- **Status:** COMPLETED (Commit `271b122`)
- **Files Modified/Created:**
  - `.github/workflows/test.yml`: GitHub Actions CI pipeline running Node 22 on `ubuntu-latest`, checking secrets, checking db files, and executing test suites.
  - `.nvmrc`: Node.js version pinned to `22`.
  - `docs/ARCHITECTURE.md`: Technical architecture specification, pipeline diagrams, and invariant catalog.
  - `docs/RUNBOOK.md`: Operator runbook covering deployment, startup, mode switching, disarming, and emergency kill-switch procedures.
  - `docs/RISK_DISCLOSURE.md`: Full institutional risk disclosure and empirical backtest summary.
  - `reports/release/04_ci/npm_audit.txt`: Production runtime dependency security audit (0 vulnerabilities).

### Step 5: Demo Round Trip
- **Status:** DEFERRED / HELD PENDING USER CREDENTIALS
- **Operational State:** In accordance with explicit user instructions ("only after I confirm the Demo key is in .env"), real external network calls to Bitget Demo trading endpoints are held until credentials are provided. Preflight checks, signature verification, and simulated dry-run tests are fully operational with zero risk to live capital.

### Step 6: Advisory AI Analyst
- **Status:** COMPLETED (Commit `55d19a0`)
- **Files Modified/Created:**
  - `src/ai/analyst.js`: Text-only quantitative market analyst providing Setup Briefs, Post-Trade Reviews, and Daily Briefs. Enforces prompt-hash caching, daily call caps (50 calls/day), and untrusted data sanitization (`[UNTRUSTED_EXTERNAL_DATA]`).
  - `src/storage/db.js`: Created `ai_analyst_records` table storing recommendations, verdicts, reasons, and trade outcomes; added evaluation statistics query.
  - `src/vt2-server.js`: Exposed advisory endpoints (`/api/ai/status`, `/api/ai/brief`, `/api/ai/review`, `/api/ai/daily`).
  - `scripts/forward-report.js`: Extended Section 6 to evaluate AI performance with N < 30 sample size guard ("Sample size too small to evaluate AI performance (N/30)").
  - `tests/ai-analyst.test.js`: Added 7 comprehensive tests verifying disabled states, AST/import architectural isolation, prompt-injection defense, hash caching, call caps, and evaluation stats.
  - `reports/release/06_analyst/`: Saved sample outputs and isolation audit.

---

## 3. Test Suite & Integrity

- **Test Command:** `npm test` (or `node --test --test-force-exit --test-timeout=60000`)
- **Total Tests:** `136`
- **Passing:** `136`
- **Failing:** `0`
- **Execution Speed:** ~4.3 seconds
- **Key Invariants Enforced by Tests:**
  - Mainnet execution is strictly blocked (`validateExecutionMode` rejects LIVE without credentials and confirmation phrase).
  - Withdrawal and transfer API endpoints are forbidden and blocked by assertion tests.
  - No secrets/keys are logged or transmitted (automatic secret scanner).
  - Advisory AI module has ZERO imports to trade/execution clients and ZERO order placement methods.
  - Strategy S0 is flagged as UNVALIDATED across all UI entry points.
  - Zero look-ahead bias in indicator computation and 4h bar alignment.
  - Monotonic cost sensitivity (increasing slippage strictly decreases net P&L for fixed trade lists).
  - Deterministic replay reproducibility.

---

## 4. Operational Commands Quick Reference

### Running in Local Paper Mode (Default)
```bash
# Start local interactive server (defaults strictly to PAPER mode)
npm start
# Server listens on http://localhost:3000
```

### Running Unattended with PM2 Service
```bash
# Start background service with auto-restart and crash-loop backoff
npm run service:start

# Inspect service health and uptime
npm run service:status

# Stop background service
npm run service:stop
```

### Running Test Suite
```bash
npm test
# Equivalent to: node --test --test-force-exit --test-timeout=60000
```

### Running Daily Forward Report Cron
```bash
npm run forward:report
# Writes report to reports/forward-test/daily-YYYY-MM-DD.md
```

---

## 5. Strategy Rules & Exact Implementation Locations

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

## 6. Execution Friction & Cost Constants

- **Exchange Fee Rates:** Verified from live Bitget contracts endpoint (`https://api.bitget.com/api/v2/mix/market/contracts?productType=usdt-futures`):
  - **Taker Fee:** `0.06%` (`0.0006`)
  - **Maker Fee:** `0.02%` (`0.0002`)
- **Slippage Assumption:** `0.02%` (`0.0002`, 2 basis points)
- **Historical Carry Funding Rate:** Verified from Bitget historical funding endpoint (`https://api.bitget.com/api/v2/mix/market/history-fund-rate` for BTCUSDT):
  - Empirical 270-interval mean: `+0.00532%` per 8 hours (annualized ~5.82%)
  - Backtest flat assumption: `0.0100%` per 8 hours (annualized 10.95%)

---

## 7. Quantitative Replay Results Across All Rounds

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

### C. Strategy v2 Round 2 Pre-Registered Trials (`reports/strategy-v2/metrics-r2.json`)
- **Candidates Tested:** R2-A (4h Breakout 55-bar), R2-B (15m Pullback Maker Execution)
- **Total Trials:** 12 trials across Equity and Crypto universes.
- **Passing Candidates:** **0 / 12**.
- **Crypto Evaluability Notice:** All 4 crypto trials (R2-A Dev, R2-A Val, R2-B Dev, R2-B Val) are marked **NOT EVALUABLE** due to sample truncation (<30 trades) and missing local bar data for 8 of 10 configured crypto symbols.

### D. Candidate L1 Multi-Year Long-History Test (`reports/strategy-v2/metrics-l1.json`)
- **Strategy:** Equal-weight BTC/ETH long when `Close > 100-day SMA`, otherwise flat.
- **Data Range:** 2019-11-17 to 2025-12-31 (2,237 daily bars).
- **Dev Split (2019-2023):** L1 Return `+702.78%`, Max DD `51.87%` (B&H Return `+779.37%`, Max DD `77.90%`). DD ratio: `0.67x` (**FAILS** $\le 0.60\times$ criterion).
- **Validation Split (2024-2025):** L1 Return `+44.80%`, Max DD `41.82%` (B&H Return `+67.31%`, Max DD `41.60%`). DD ratio: `1.01x` (**FAILS** $\le 0.60\times$ criterion).
- **Verdict:** **FAILS** pre-registered pass criteria against both raw and cost-adjusted benchmarks.
- **Forward Holdout Status:** The 2026 Forward Holdout partition remains **STRICTLY LOCKED AND UNOPENED**.

---

## 8. What Is Untested & Execution Boundaries

1. **Live Mainnet Trading:** Zero real capital has ever been committed. No order has ever been submitted to Bitget private/authenticated execution endpoints. LIVE mode is disabled and guarded by multi-layer hardware/environment gates.
2. **Demo Trading Round Trip:** Blocked pending user placement of test credentials in `.env`. Preflight check endpoints and HMAC signatures are tested and ready.
3. **Maker Limit Fill Realism:** Maker backtests (R2-B) assume 100% queue fills at limit prices with zero adverse selection. True maker fill probability in live order books will experience queue priority delay and toxic order flow.
4. **Crypto Historical Universe:** Only BTC and ETH have continuous historical data in the local database. The remaining 8 symbols in `config/crypto-perps.json` have not been backtested.
