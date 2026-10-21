# VT2 Operations Runbook

This runbook provides step-by-step operational procedures for running, monitoring, and maintaining the VT2 trading bot.

---

## 1. Starting the Terminal

### Interactive Mode (Local Development / Testing)
To launch VT2 interactively in standard local mode:
```bash
# Standard local start (starts in PAPER mode on port 3000)
npm start

# Development mode with hot-reloading
npm run dev
```
Open your browser to `http://localhost:3000`.

### Unattended Service Mode (PM2 Background Daemon)
For continuous 24/7 background operation:
```bash
# Start background daemon via PM2
npm run service:start

# View process status, memory, and uptime
npm run service:status

# View live service logs
npx pm2 logs vt2-trading-bot
```

---

## 2. Stopping the Terminal

### Interactive Stop
In your terminal, press `Ctrl+C`. The process executes graceful shutdown handlers:
1. Flushes active SQLite transactions to disk.
2. Stops autonomous bot loops and position monitors.
3. Closes open HTTP and SSE socket connections.
4. Resets active mode to PAPER.

### Service Stop
```bash
npm run service:stop
```

---

## 3. Emergency Kill Switch

The Master Kill Switch is designed to immediately halt all algorithmic execution and protect account capital:

### Triggering the Kill Switch
- **From Web UI:** Click the red **KILL SWITCH** button in the top right corner of the terminal topbar, then click **ENGAGE KILL SWITCH** in the confirmation dialog.
- **Via API Endpoint:**
  ```bash
  curl -X POST http://localhost:3000/api/exchange/kill-switch
  ```
- **Via Automated Trading Engine:**
  ```bash
  curl -X POST http://localhost:3000/api/autotrading/kill-switch
  ```

### What Happens When Engaged:
1. The autonomous auto-trading bot is immediately stopped and locked.
2. All open paper and demo positions are market-closed immediately.
3. Any open or pending limit orders are canceled.
4. If LIVE mode was armed, the terminal is immediately disarmed with reason `KILL_SWITCH_DISARM` and reverts to PAPER mode.
5. An emergency audit record is logged to the SQLite database and an alert is dispatched if alerts are configured.

---

## 4. Handling Reconciliation Mismatches

During DEMO or LIVE execution, the background reconciliation engine polls the exchange every 15–30 seconds to verify that local position records match the exchange's reported positions.

### When a Mismatch Occurs:
- The reconciliation engine detects position drift or untracked orders.
- The terminal immediately:
  1. Triggers emergency disarm of LIVE mode.
  2. Reverts execution environment to PAPER mode.
  3. Halts autonomous bot execution.
  4. Dispatches a critical alert notification.

### Operator Remediation Checklist:
1. **Inspect Logs:**
   Open the latest log file under `logs/vt2-YYYY-MM-DD.log` or run:
   ```bash
   node scripts/reconciliation-check.js
   ```
2. **Verify Bitget Positions Directly:**
   Log into the official Bitget web interface or app. Inspect open contracts and order history under USDT-M Futures.
3. **Resolve Drift:**
   Manually close or adjust any orphaned contracts directly on Bitget.
4. **Restart Cleanly:**
   Restart the VT2 service:
   ```bash
   npm run service:stop
   npm run service:start
   ```
   The terminal will launch cleanly in PAPER mode. Do not re-arm LIVE until the root cause of the position discrepancy is understood.

---

## 5. How to Read the Daily Report

Daily forward reports are automatically generated under `reports/forward-test/daily-YYYY-MM-DD.md`. You can manually trigger report generation anytime with:
```bash
npm run forward:report
```

### Key Sections:
1. **Governance & Holdout Status:** Confirms whether the forward holdout dataset (2026-10-10 onwards) remains strictly locked to prevent look-ahead bias and data leakage.
2. **Live Paper Account Summary:**
   - **Account Equity & Balance:** Tracks simulated starting capital ($10,000 baseline).
   - **Realized Net P&L:** Net profits or losses after taker fees and slippage.
   - **Win Rate:** Percentage of profitable closed trades.
3. **Active Open Positions:** Displays current symbols, entry price, current mark price, stop-loss, take-profit, and unrealized P&L.
4. **Trade Journal:** Chronological record of closed positions with entry/exit timestamps, strategy identifier, realized P&L, ROI %, holding duration, and explicit exit reasons (`TAKE_PROFIT_FINAL`, `STOP_LOSS`, `RSI_EXIT`).
5. **Safety Bounds:** Confirms hard risk limits (daily loss lockout, position caps, correlation rules).
