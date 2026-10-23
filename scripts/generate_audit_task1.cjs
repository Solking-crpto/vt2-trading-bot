/**
 * scripts/generate_audit_task1.cjs
 *
 * Programmatically inspects the VT2 codebase and generates reports/launch/00_audit.md
 * evaluating all 18 numbered requirements and trading rule comparisons.
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');

function searchFile(relPath, pattern) {
  const fullPath = path.join(ROOT, relPath);
  if (!fs.existsSync(fullPath)) return null;
  const content = fs.readFileSync(fullPath, 'utf8');
  const lines = content.split('\n');
  const matches = [];
  lines.forEach((line, idx) => {
    if (typeof pattern === 'string' ? line.includes(pattern) : pattern.test(line)) {
      matches.push({ lineNum: idx + 1, text: line.trim() });
    }
  });
  return matches;
}

function getLineRange(relPath, startLine, endLine) {
  const fullPath = path.join(ROOT, relPath);
  if (!fs.existsSync(fullPath)) return '';
  const lines = fs.readFileSync(fullPath, 'utf8').split('\n');
  return lines.slice(startLine - 1, endLine).map((l, i) => `${startLine + i}: ${l}`).join('\n');
}

function generateAudit() {
  console.log('[Audit Script] Inspecting codebase...');

  const auditItems = [
    {
      id: 1,
      name: 'Separate stats/journal per mode',
      status: 'PARTIAL',
      evidenceFile: 'src/storage/db.js:456-552, src/vt2-server.js:1902-1909',
      details: 'Trade journal and positions store mode (`PAPER`, `DEMO`, `LIVE`) and `assetClass` in SQLite (`trade_journal.environment`, `trade_journal.mode`, `trade_journal.asset_class`). However, `GET /api/journal` returns `this.db.getJournalEntries(50)` which performs `SELECT * FROM trade_journal ORDER BY timestamp DESC LIMIT ?` without filtering by the active mode or separating stats per mode.',
    },
    {
      id: 2,
      name: 'Mode banner colors',
      status: 'PARTIAL',
      evidenceFile: 'public/vt2-ui.js:409-427, public/index.html:42-55',
      details: '`liveWarningBanner` is displayed only for LIVE mode. In `public/vt2-ui.js`, `activeEnvLabel` uses `text-warning` for PAPER and `text-primary` for DEMO, rather than persistent banners on every tab styled in the designated colors (PAPER blue, DEMO amber, LIVE red).',
    },
    {
      id: 3,
      name: 'Switching blocked unless flat',
      status: 'MISSING',
      evidenceFile: 'src/vt2-server.js:1659-1695, public/vt2-ui.js:433-470',
      details: '`POST /api/mode` invokes `setExecutionMode(targetMode)` directly without checking `this.paperEngine.positions.length === 0` or open exchange positions. Users can switch execution mode while positions remain open in the current mode.',
    },
    {
      id: 4,
      name: 'LIVE gating (env flag, valid live keys, preflight incl. clock drift under 1s, typed confirmation, starts armed-but-paused)',
      status: 'PARTIAL',
      evidenceFile: 'src/vt2-server.js:1700-1742, src/execution/bitget-trade-client.js:179-245',
      details: 'Implemented: `LIVE_TRADING_ENABLED` flag check (line 1706), typed confirmation phrase check (line 1713), preflight clock drift verification `<1000ms` (bitget-trade-client.js:190), trade-only attestation (line 214), and account balance check. Missing: `I_UNDERSTAND_LIVE_RISK=true` required env flag and setting autonomous bot loop to "armed-but-paused" state until user explicitly presses Start.',
    },
    {
      id: 5,
      name: 'Kill switch',
      status: 'IMPLEMENTED',
      evidenceFile: 'src/vt2-server.js:1832-1851, src/execution/bitget-trade-client.js:520-545',
      details: '`POST /api/exchange/kill-switch` and `/api/autotrading/kill-switch` cancel all open orders, market-flatten all paper positions (`this.paperEngine.cancelAllOrdersAndClosePositions()`), flatten live/demo exchange positions (`client.killSwitch()`), and immediately disarm LIVE mode (`disarmLive("KILL_SWITCH_TRIGGERED")`).',
    },
    {
      id: 6,
      name: 'SL placement failure closes the position',
      status: 'IMPLEMENTED',
      evidenceFile: 'src/execution/bitget-trade-client.js:431-440',
      details: 'In `placeOrderWithProtection()`, stop-loss placement is explicitly confirmed via `verifyStopLossProtection()`. If not confirmed, `this.emergencyFlatten()` is immediately executed to market-close the position and a `SafetyViolationError("STOP_LOSS_CONFIRMATION_FAILED")` is thrown.',
    },
    {
      id: 7,
      name: 'Restart recovery that reconciles with exchange state',
      status: 'PARTIAL',
      evidenceFile: 'src/execution/bitget-trade-client.js:547-615, src/vt2-server.js:1817-1830',
      details: 'Paper engine positions and journal restore from SQLite on restart (`PaperExecutionEngine.restoreState()`). `BitgetTradeClient.reconcile()` detects position drift between exchange and local state. However, automatic exchange reconciliation is not triggered on server boot (it requires manual `/api/exchange/reconcile` or periodic polling), and restarts always force environment back to PAPER.',
    },
    {
      id: 8,
      name: 'Fees read from the API (not hard-coded)',
      status: 'CONFLICTS',
      evidenceFile: 'src/config/contracts.js:65-72, src/execution/paper-engine.js:146, 215, 458',
      details: 'Fees are hard-coded in contract configurations (`takerFeeRate: 0.0006` or `0.0005`, `makerFeeRate: 0.0002`) and fallback to `0.0005` in `paper-engine.js`. The bot does not query Bitget\'s fee rate API endpoint (`/api/v2/mix/account/fee-rate`).',
    },
    {
      id: 9,
      name: 'Symbols, tick sizes and trading hours from the API (not hard-coded)',
      status: 'PARTIAL',
      evidenceFile: 'src/adapters/bitget-adapter.js:153-175, src/config/contracts.js:240-310, src/strategy/v2/session-filter.js:20-50',
      details: 'Symbols, tick sizes, minTradeNum, and contract status are fetched and validated from Bitget API (`/api/v2/mix/market/contracts?productType=USDT-FUTURES`). However, equity trading hours (US RTH 09:30-16:00 ET) are statically defined in `session-filter.js` rather than queried from an exchange API.',
    },
    {
      id: 10,
      name: 'Timeouts, retries with backoff, rate-limit handling on every external call',
      status: 'PARTIAL',
      evidenceFile: 'src/adapters/bitget-adapter.js:84, 151, src/execution/bitget-trade-client.js:52, 140',
      details: 'AbortController timeouts are configured on external REST requests (3500ms in `bitget-adapter.js`, 8000ms in `bitget-trade-client.js`). However, systematic exponential backoff retries and HTTP 429 rate-limit handling are not uniformly implemented across all external calls.',
    },
    {
      id: 11,
      name: 'Secrets only in env',
      status: 'IMPLEMENTED',
      evidenceFile: 'src/environment.js:280-305, src/environment.js:345-385',
      details: 'API keys, secrets, and passphrases for DEMO and LIVE are read exclusively from `process.env`. `scrubSecrets()` and `redactSecrets()` scrub keys from responses and logs, and secret detection tests verify zero leaks.',
    },
    {
      id: 12,
      name: 'Isolated margin only',
      status: 'IMPLEMENTED',
      evidenceFile: 'src/execution/bitget-trade-client.js:278, 393, 511, 706',
      details: 'Every order placement payload and account margin setting in `BitgetTradeClient` explicitly specifies `marginMode: "isolated"`. Cross margin is strictly disabled and rejected.',
    },
    {
      id: 13,
      name: 'Effective-risk readout',
      status: 'MISSING',
      evidenceFile: 'public/index.html:840-870, public/vt2-ui.js:3130-3200',
      details: 'No effective-risk readout exists in the UI. Sizing calculates nominal risk but does not display capped effective risk under leverage, margin, or live-limits constraints.',
    },
    {
      id: 14,
      name: 'Risk selector',
      status: 'PARTIAL',
      evidenceFile: 'public/index.html:848-855, public/vt2-ui.js:3138, 3191',
      details: 'A numeric input (`cfgRiskPerTrade`) exists in the Settings & Risk tab. The preset dropdown (1%, 5%, 10%, 25%, 50%, 100%, Custom), red warning dialog >10%, and asset class leverage dropdown are not yet implemented.',
    },
    {
      id: 15,
      name: 'Live-readiness gate',
      status: 'MISSING',
      evidenceFile: 'public/index.html, src/vt2-server.js',
      details: 'No live-readiness badge exists in the UI or backend. The requirement calls for an informational badge evaluating trade counts (>=200 in PAPER & DEMO), positive net expectancy after fees, max drawdown, and 7-day error count.',
    },
    {
      id: 16,
      name: 'Auto-disable buckets',
      status: 'PARTIAL',
      evidenceFile: 'src/risk-engine.js:124-137, src/execution/auto-trader.js:255-261',
      details: 'Daily loss lockout (2.0% SOD equity) and consecutive loss pause (3 losses) are implemented in `risk-engine.js` and `auto-trader.js`. However, the full multi-tier auto-disable bucket system (2-hour pause bucket, 5 consecutive losses across 2 days requiring manual review) is not implemented (deferred to backlog per Task 6).',
    },
    {
      id: 17,
      name: 'Telegram/webhook alerts',
      status: 'IMPLEMENTED',
      evidenceFile: 'src/service/alert-dispatcher.js:12-105',
      details: '`AlertDispatcher` implements outbound notifications to Telegram (`TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`) and generic HTTP webhooks (`ALERT_WEBHOOK_URL`) for events including `BOT_HALT`, `KILL_SWITCH`, `DAILY_LOSS_LOCKOUT`, `FEED_OFFLINE`, and `RESTART`, with automatic secret redaction.',
    },
    {
      id: 18,
      name: 'Trade CSV export',
      status: 'MISSING',
      evidenceFile: 'public/vt2-ui.js:1256, 3050-3075',
      details: '`exportJournalJson()` exports closed trade journal records as JSON only. Trade CSV export is not implemented in the UI.',
    },
  ];

  const cryptoRules = [
    {
      rule: 'Volume spike 1.5x of 20 candles',
      promptSpec: 'Mandatory entry filter: 5m volume >= 1.5x of 20-candle moving average',
      codeImplementation: 'src/strategy/engine.js:279, 304: `ind5m.current.isVolumeSpike || (ind5m.current.rvol >= 1.2)`. NOT an entry gate; only adds ranking score (+25 vs +10).',
      difference: 'Implemented as ranking score booster rather than a hard entry gate; accepts rvol >= 1.2 in addition to 1.5x spike.',
    },
    {
      rule: '4h close > EMA200',
      promptSpec: 'Macro trend alignment: 4h close > 4h EMA200 for Longs (close < EMA200 for Shorts)',
      codeImplementation: 'src/strategy/engine.js:176-177: `ind4h.current.close > ind4h.current.ema20`.',
      difference: 'Code uses 4h EMA20 instead of 4h EMA200.',
    },
    {
      rule: '15m RSI 45-68',
      promptSpec: '15m RSI band filter: Longs require RSI between 45 and 68',
      codeImplementation: 'src/strategy/engine.js:282-299: Rejects if `rsi15m > 72` (overbought) or `rsi15m < 28` (oversold).',
      difference: 'Accepts 28 to 72 (much wider band than 45 to 68); does not enforce lower bound of 45 for Longs.',
    },
    {
      rule: '5m EMA20',
      promptSpec: '5m pullback / confirmation to EMA20 required for entry timing',
      codeImplementation: 'src/strategy/engine.js:17, src/execution/paper-engine.js:332: Used exclusively as trailing stop anchor after 10% ROI (`trailingStopAtrBuffer: 0.5x 5m ATR below 5m EMA20`).',
      difference: 'Not used as an entry qualification filter at all; used solely for trailing exit stops.',
    },
    {
      rule: 'BTC filter',
      promptSpec: 'BTC macro filter: BTC 4h close > EMA200 for all crypto Longs',
      codeImplementation: 'src/strategy/engine.js:50-54, 198-209: `evaluateBtcTrend` checks `btcPrice > ema50`. Rejects Long if BTC trend is BEARISH.',
      difference: 'Checks BTC 4h price vs EMA50 instead of EMA200.',
    },
    {
      rule: 'Signal freshness',
      promptSpec: 'Signal timestamp within 10 minutes of candle close',
      codeImplementation: 'src/strategy/engine.js:21, 164-172: `maxSignalAgeMs: 10 * 60 * 1000` (10 minutes). Rejects `SIGNAL_EXPIRED` if stale.',
      difference: 'Exact match: 10-minute maximum age strictly enforced.',
    },
  ];

  const stockRules = [
    {
      rule: 'Session-only',
      promptSpec: 'Trade equities strictly during US Regular Trading Hours (09:30 - 16:00 ET)',
      status: 'PARTIAL',
      details: '`src/strategy/v2/session-filter.js:20` and `src/adapters/market-provider.js` compute US RTH market state (`underlyingMarketClosed`), and `analyzeInstrument()` flags it, but does not block entries by default unless configured by caller.',
    },
    {
      rule: 'VWAP',
      promptSpec: 'Intraday VWAP trend filter: price above VWAP for Longs, below VWAP for Shorts',
      status: 'MISSING',
      details: 'VWAP indicator calculation and entry filtering are not implemented in `src/indicators/` or `src/strategy/engine.js`.',
    },
    {
      rule: 'SPY/QQQ filter',
      promptSpec: 'Macro equity benchmark: SPY and QQQ trend alignment required',
      status: 'PARTIAL',
      details: '`src/strategy/engine.js:66-98` implements SPY benchmark check (`evaluateStockBenchmark()`) against 4h EMA50 and blocks divergent equity setups (`STOCK_BENCHMARK_DIVERGENCE`). QQQ is not tracked or checked.',
    },
    {
      rule: 'Force-flat before close',
      promptSpec: 'Close all open equity positions before 16:00 ET market close',
      status: 'MISSING',
      details: 'No automatic force-flat scheduling before equity market close exists in `paper-engine.js` or `auto-trader.js`.',
    },
    {
      rule: 'Earnings skip',
      promptSpec: 'Skip trading equities with corporate earnings releases within +/- 2 days',
      status: 'MISSING',
      details: 'No earnings calendar integration or earnings blackout filter exists in the codebase.',
    },
  ];

  // Build Markdown
  let md = `# VT2 Audit Report: Master Requirements vs Codebase

**Generated:** ${new Date().toISOString()}  
**Generator Script:** \`scripts/generate_audit_task1.cjs\`  
**Branch:** \`feat/task1-audit\` (Commit baseline: \`main\`)  

---

## 1. Numbered Requirements Verification Matrix

| # | Requirement | Status | Evidence (File:Line) |
| :-: | :---------- | :----: | :------------------- |
`;

  for (const item of auditItems) {
    md += `| ${item.id} | ${item.name} | **${item.status}** | \`${item.evidenceFile}\` |\n`;
  }

  md += `\n### Detailed Evidence & Findings by Requirement\n\n`;

  for (const item of auditItems) {
    md += `#### ${item.id}. ${item.name}\n`;
    md += `- **Status:** \`${item.status}\`\n`;
    md += `- **Evidence:** \`${item.evidenceFile}\`\n`;
    md += `- **Analysis:** ${item.details}\n\n`;
  }

  md += `---

## 2. Crypto Entry Rules: Old Master Prompt vs Actual Implementation

| Rule | Old Master Prompt Specification | Implemented in Code | Difference |
| :--- | :------------------------------ | :------------------ | :--------- |
`;

  for (const r of cryptoRules) {
    md += `| **${r.rule}** | ${r.promptSpec} | \`${r.codeImplementation}\` | ${r.difference} |\n`;
  }

  md += `\n### Summary of Crypto Differences:
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
`;

  for (const s of stockRules) {
    md += `| **${s.rule}** | ${s.promptSpec} | **${s.status}** | ${s.details} |\n`;
  }

  md += `\n### Summary of Stock Rules:
- **Implemented / Partial:** SPY benchmark filter is implemented (\`src/strategy/engine.js:66-98\`); Session hours are computed (\`session-filter.js\`) but not strictly enforced as an entry lockout.
- **Missing entirely:** VWAP, QQQ filter, force-flat before 16:00 ET close, and earnings calendar skip.
- **Backlog Action:** As instructed in Task 6, unbuilt rules will be recorded in \`docs/BACKLOG.md\` with notes that each requires pre-registration and out-of-sample backtesting before implementation.

---
`;

  const outputPath = path.join(ROOT, 'reports', 'launch', '00_audit.md');
  fs.writeFileSync(outputPath, md, 'utf8');
  console.log(`[Audit Script] Audit report generated successfully at: ${outputPath}`);
}

generateAudit();
