# VT2 Audit Report: Master Requirements vs Codebase

**Generated:** 2026-10-23T08:44:40.543Z  
**Generator Script:** `scripts/generate_audit_task1.cjs`  
**Branch:** `feat/task1-audit` (Commit baseline: `main`)  

---

## 1. Numbered Requirements Verification Matrix

| # | Requirement | Status | Evidence (File:Line) |
| :-: | :---------- | :----: | :------------------- |
| 1 | Separate stats/journal per mode | **PARTIAL** | `src/storage/db.js:456-552, src/vt2-server.js:1902-1909` |
| 2 | Mode banner colors | **PARTIAL** | `public/vt2-ui.js:409-427, public/index.html:42-55` |
| 3 | Switching blocked unless flat | **MISSING** | `src/vt2-server.js:1659-1695, public/vt2-ui.js:433-470` |
| 4 | LIVE gating (env flag, valid live keys, preflight incl. clock drift under 1s, typed confirmation, starts armed-but-paused) | **PARTIAL** | `src/vt2-server.js:1700-1742, src/execution/bitget-trade-client.js:179-245` |
| 5 | Kill switch | **IMPLEMENTED** | `src/vt2-server.js:1832-1851, src/execution/bitget-trade-client.js:520-545` |
| 6 | SL placement failure closes the position | **IMPLEMENTED** | `src/execution/bitget-trade-client.js:431-440` |
| 7 | Restart recovery that reconciles with exchange state | **PARTIAL** | `src/execution/bitget-trade-client.js:547-615, src/vt2-server.js:1817-1830` |
| 8 | Fees read from the API (not hard-coded) | **CONFLICTS** | `src/config/contracts.js:65-72, src/execution/paper-engine.js:146, 215, 458` |
| 9 | Symbols, tick sizes and trading hours from the API (not hard-coded) | **PARTIAL** | `src/adapters/bitget-adapter.js:153-175, src/config/contracts.js:240-310, src/strategy/v2/session-filter.js:20-50` |
| 10 | Timeouts, retries with backoff, rate-limit handling on every external call | **PARTIAL** | `src/adapters/bitget-adapter.js:84, 151, src/execution/bitget-trade-client.js:52, 140` |
| 11 | Secrets only in env | **IMPLEMENTED** | `src/environment.js:280-305, src/environment.js:345-385` |
| 12 | Isolated margin only | **IMPLEMENTED** | `src/execution/bitget-trade-client.js:278, 393, 511, 706` |
| 13 | Effective-risk readout | **MISSING** | `public/index.html:840-870, public/vt2-ui.js:3130-3200` |
| 14 | Risk selector | **PARTIAL** | `public/index.html:848-855, public/vt2-ui.js:3138, 3191` |
| 15 | Live-readiness gate | **MISSING** | `public/index.html, src/vt2-server.js` |
| 16 | Auto-disable buckets | **PARTIAL** | `src/risk-engine.js:124-137, src/execution/auto-trader.js:255-261` |
| 17 | Telegram/webhook alerts | **IMPLEMENTED** | `src/service/alert-dispatcher.js:12-105` |
| 18 | Trade CSV export | **MISSING** | `public/vt2-ui.js:1256, 3050-3075` |

### Detailed Evidence & Findings by Requirement

#### 1. Separate stats/journal per mode
- **Status:** `PARTIAL`
- **Evidence:** `src/storage/db.js:456-552, src/vt2-server.js:1902-1909`
- **Analysis:** Trade journal and positions store mode (`PAPER`, `DEMO`, `LIVE`) and `assetClass` in SQLite (`trade_journal.environment`, `trade_journal.mode`, `trade_journal.asset_class`). However, `GET /api/journal` returns `this.db.getJournalEntries(50)` which performs `SELECT * FROM trade_journal ORDER BY timestamp DESC LIMIT ?` without filtering by the active mode or separating stats per mode.

#### 2. Mode banner colors
- **Status:** `PARTIAL`
- **Evidence:** `public/vt2-ui.js:409-427, public/index.html:42-55`
- **Analysis:** `liveWarningBanner` is displayed only for LIVE mode. In `public/vt2-ui.js`, `activeEnvLabel` uses `text-warning` for PAPER and `text-primary` for DEMO, rather than persistent banners on every tab styled in the designated colors (PAPER blue, DEMO amber, LIVE red).

#### 3. Switching blocked unless flat
- **Status:** `MISSING`
- **Evidence:** `src/vt2-server.js:1659-1695, public/vt2-ui.js:433-470`
- **Analysis:** `POST /api/mode` invokes `setExecutionMode(targetMode)` directly without checking `this.paperEngine.positions.length === 0` or open exchange positions. Users can switch execution mode while positions remain open in the current mode.

#### 4. LIVE gating (env flag, valid live keys, preflight incl. clock drift under 1s, typed confirmation, starts armed-but-paused)
- **Status:** `PARTIAL`
- **Evidence:** `src/vt2-server.js:1700-1742, src/execution/bitget-trade-client.js:179-245`
- **Analysis:** Implemented: `LIVE_TRADING_ENABLED` flag check (line 1706), typed confirmation phrase check (line 1713), preflight clock drift verification `<1000ms` (bitget-trade-client.js:190), trade-only attestation (line 214), and account balance check. Missing: `I_UNDERSTAND_LIVE_RISK=true` required env flag and setting autonomous bot loop to "armed-but-paused" state until user explicitly presses Start.

#### 5. Kill switch
- **Status:** `IMPLEMENTED`
- **Evidence:** `src/vt2-server.js:1832-1851, src/execution/bitget-trade-client.js:520-545`
- **Analysis:** `POST /api/exchange/kill-switch` and `/api/autotrading/kill-switch` cancel all open orders, market-flatten all paper positions (`this.paperEngine.cancelAllOrdersAndClosePositions()`), flatten live/demo exchange positions (`client.killSwitch()`), and immediately disarm LIVE mode (`disarmLive("KILL_SWITCH_TRIGGERED")`).

#### 6. SL placement failure closes the position
- **Status:** `IMPLEMENTED`
- **Evidence:** `src/execution/bitget-trade-client.js:431-440`
- **Analysis:** In `placeOrderWithProtection()`, stop-loss placement is explicitly confirmed via `verifyStopLossProtection()`. If not confirmed, `this.emergencyFlatten()` is immediately executed to market-close the position and a `SafetyViolationError("STOP_LOSS_CONFIRMATION_FAILED")` is thrown.

#### 7. Restart recovery that reconciles with exchange state
- **Status:** `PARTIAL`
- **Evidence:** `src/execution/bitget-trade-client.js:547-615, src/vt2-server.js:1817-1830`
- **Analysis:** Paper engine positions and journal restore from SQLite on restart (`PaperExecutionEngine.restoreState()`). `BitgetTradeClient.reconcile()` detects position drift between exchange and local state. However, automatic exchange reconciliation is not triggered on server boot (it requires manual `/api/exchange/reconcile` or periodic polling), and restarts always force environment back to PAPER.

#### 8. Fees read from the API (not hard-coded)
- **Status:** `CONFLICTS`
- **Evidence:** `src/config/contracts.js:65-72, src/execution/paper-engine.js:146, 215, 458`
- **Analysis:** Fees are hard-coded in contract configurations (`takerFeeRate: 0.0006` or `0.0005`, `makerFeeRate: 0.0002`) and fallback to `0.0005` in `paper-engine.js`. The bot does not query Bitget's fee rate API endpoint (`/api/v2/mix/account/fee-rate`).

#### 9. Symbols, tick sizes and trading hours from the API (not hard-coded)
- **Status:** `PARTIAL`
- **Evidence:** `src/adapters/bitget-adapter.js:153-175, src/config/contracts.js:240-310, src/strategy/v2/session-filter.js:20-50`
- **Analysis:** Symbols, tick sizes, minTradeNum, and contract status are fetched and validated from Bitget API (`/api/v2/mix/market/contracts?productType=USDT-FUTURES`). However, equity trading hours (US RTH 09:30-16:00 ET) are statically defined in `session-filter.js` rather than queried from an exchange API.

#### 10. Timeouts, retries with backoff, rate-limit handling on every external call
- **Status:** `PARTIAL`
- **Evidence:** `src/adapters/bitget-adapter.js:84, 151, src/execution/bitget-trade-client.js:52, 140`
- **Analysis:** AbortController timeouts are configured on external REST requests (3500ms in `bitget-adapter.js`, 8000ms in `bitget-trade-client.js`). However, systematic exponential backoff retries and HTTP 429 rate-limit handling are not uniformly implemented across all external calls.

#### 11. Secrets only in env
- **Status:** `IMPLEMENTED`
- **Evidence:** `src/environment.js:280-305, src/environment.js:345-385`
- **Analysis:** API keys, secrets, and passphrases for DEMO and LIVE are read exclusively from `process.env`. `scrubSecrets()` and `redactSecrets()` scrub keys from responses and logs, and secret detection tests verify zero leaks.

#### 12. Isolated margin only
- **Status:** `IMPLEMENTED`
- **Evidence:** `src/execution/bitget-trade-client.js:278, 393, 511, 706`
- **Analysis:** Every order placement payload and account margin setting in `BitgetTradeClient` explicitly specifies `marginMode: "isolated"`. Cross margin is strictly disabled and rejected.

#### 13. Effective-risk readout
- **Status:** `MISSING`
- **Evidence:** `public/index.html:840-870, public/vt2-ui.js:3130-3200`
- **Analysis:** No effective-risk readout exists in the UI. Sizing calculates nominal risk but does not display capped effective risk under leverage, margin, or live-limits constraints.

#### 14. Risk selector
- **Status:** `PARTIAL`
- **Evidence:** `public/index.html:848-855, public/vt2-ui.js:3138, 3191`
- **Analysis:** A numeric input (`cfgRiskPerTrade`) exists in the Settings & Risk tab. The preset dropdown (1%, 5%, 10%, 25%, 50%, 100%, Custom), red warning dialog >10%, and asset class leverage dropdown are not yet implemented.

#### 15. Live-readiness gate
- **Status:** `MISSING`
- **Evidence:** `public/index.html, src/vt2-server.js`
- **Analysis:** No live-readiness badge exists in the UI or backend. The requirement calls for an informational badge evaluating trade counts (>=200 in PAPER & DEMO), positive net expectancy after fees, max drawdown, and 7-day error count.

#### 16. Auto-disable buckets
- **Status:** `PARTIAL`
- **Evidence:** `src/risk-engine.js:124-137, src/execution/auto-trader.js:255-261`
- **Analysis:** Daily loss lockout (2.0% SOD equity) and consecutive loss pause (3 losses) are implemented in `risk-engine.js` and `auto-trader.js`. However, the full multi-tier auto-disable bucket system (2-hour pause bucket, 5 consecutive losses across 2 days requiring manual review) is not implemented (deferred to backlog per Task 6).

#### 17. Telegram/webhook alerts
- **Status:** `IMPLEMENTED`
- **Evidence:** `src/service/alert-dispatcher.js:12-105`
- **Analysis:** `AlertDispatcher` implements outbound notifications to Telegram (`TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`) and generic HTTP webhooks (`ALERT_WEBHOOK_URL`) for events including `BOT_HALT`, `KILL_SWITCH`, `DAILY_LOSS_LOCKOUT`, `FEED_OFFLINE`, and `RESTART`, with automatic secret redaction.

#### 18. Trade CSV export
- **Status:** `MISSING`
- **Evidence:** `public/vt2-ui.js:1256, 3050-3075`
- **Analysis:** `exportJournalJson()` exports closed trade journal records as JSON only. Trade CSV export is not implemented in the UI.

---

## 2. Crypto Entry Rules: Old Master Prompt vs Actual Implementation

| Rule | Old Master Prompt Specification | Implemented in Code | Difference |
| :--- | :------------------------------ | :------------------ | :--------- |
| **Volume spike 1.5x of 20 candles** | Mandatory entry filter: 5m volume >= 1.5x of 20-candle moving average | `src/strategy/engine.js:279, 304: `ind5m.current.isVolumeSpike || (ind5m.current.rvol >= 1.2)`. NOT an entry gate; only adds ranking score (+25 vs +10).` | Implemented as ranking score booster rather than a hard entry gate; accepts rvol >= 1.2 in addition to 1.5x spike. |
| **4h close > EMA200** | Macro trend alignment: 4h close > 4h EMA200 for Longs (close < EMA200 for Shorts) | `src/strategy/engine.js:176-177: `ind4h.current.close > ind4h.current.ema20`.` | Code uses 4h EMA20 instead of 4h EMA200. |
| **15m RSI 45-68** | 15m RSI band filter: Longs require RSI between 45 and 68 | `src/strategy/engine.js:282-299: Rejects if `rsi15m > 72` (overbought) or `rsi15m < 28` (oversold).` | Accepts 28 to 72 (much wider band than 45 to 68); does not enforce lower bound of 45 for Longs. |
| **5m EMA20** | 5m pullback / confirmation to EMA20 required for entry timing | `src/strategy/engine.js:17, src/execution/paper-engine.js:332: Used exclusively as trailing stop anchor after 10% ROI (`trailingStopAtrBuffer: 0.5x 5m ATR below 5m EMA20`).` | Not used as an entry qualification filter at all; used solely for trailing exit stops. |
| **BTC filter** | BTC macro filter: BTC 4h close > EMA200 for all crypto Longs | `src/strategy/engine.js:50-54, 198-209: `evaluateBtcTrend` checks `btcPrice > ema50`. Rejects Long if BTC trend is BEARISH.` | Checks BTC 4h price vs EMA50 instead of EMA200. |
| **Signal freshness** | Signal timestamp within 10 minutes of candle close | `src/strategy/engine.js:21, 164-172: `maxSignalAgeMs: 10 * 60 * 1000` (10 minutes). Rejects `SIGNAL_EXPIRED` if stale.` | Exact match: 10-minute maximum age strictly enforced. |

### Summary of Crypto Differences:
1. **Volume Spike:** The old prompt required a strict 1.5x volume filter for entry. The code treats volume as a ranking score bonus (+25 points) rather than an exclusionary filter, and allows RVOL >= 1.2.
2. **4h Trend Indicator:** The code checks 4h EMA20 rather than EMA200.
3. **15m RSI Band:** The code accepts RSI 28–72 rather than 45–68.
4. **5m EMA20:** Not checked for entry; only used for trailing stop exits.
5. **BTC Benchmark:** Evaluates against EMA50 rather than EMA200.
6. **Freshness:** Matches 10-minute rule exactly.

---

## 3. Stock Entry Rules: Old Master Prompt vs Actual Implementation

| Rule | Old Master Prompt Specification | Status | Code Findings |
| :--- | :------------------------------ | :----: | :------------ |
| **Session-only** | Trade equities strictly during US Regular Trading Hours (09:30 - 16:00 ET) | **PARTIAL** | `src/strategy/v2/session-filter.js:20` and `src/adapters/market-provider.js` compute US RTH market state (`underlyingMarketClosed`), and `analyzeInstrument()` flags it, but does not block entries by default unless configured by caller. |
| **VWAP** | Intraday VWAP trend filter: price above VWAP for Longs, below VWAP for Shorts | **MISSING** | VWAP indicator calculation and entry filtering are not implemented in `src/indicators/` or `src/strategy/engine.js`. |
| **SPY/QQQ filter** | Macro equity benchmark: SPY and QQQ trend alignment required | **PARTIAL** | `src/strategy/engine.js:66-98` implements SPY benchmark check (`evaluateStockBenchmark()`) against 4h EMA50 and blocks divergent equity setups (`STOCK_BENCHMARK_DIVERGENCE`). QQQ is not tracked or checked. |
| **Force-flat before close** | Close all open equity positions before 16:00 ET market close | **MISSING** | No automatic force-flat scheduling before equity market close exists in `paper-engine.js` or `auto-trader.js`. |
| **Earnings skip** | Skip trading equities with corporate earnings releases within +/- 2 days | **MISSING** | No earnings calendar integration or earnings blackout filter exists in the codebase. |

### Summary of Stock Rules:
- **Implemented / Partial:** SPY benchmark filter is implemented (`src/strategy/engine.js:66-98`); Session hours are computed (`session-filter.js`) but not strictly enforced as an entry lockout.
- **Missing entirely:** VWAP, QQQ filter, force-flat before 16:00 ET close, and earnings calendar skip.
- **Backlog Action:** As instructed in Task 6, unbuilt rules will be recorded in `docs/BACKLOG.md` with notes that each requires pre-registration and out-of-sample backtesting before implementation.

---
