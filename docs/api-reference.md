# VT2 REST & Streaming API Reference

Base URL: `http://localhost:3000`

## Endpoints

### 1. Health & Safety
- **Endpoint:** `GET /api/health`
- **Response:**
  ```json
  {
    "status": "HEALTHY",
    "service": "VT2-Trading-Bot",
    "tagline": "Think. Verify. Trade.",
    "environment": "PAPER",
    "mainnetExecutionAllowed": false,
    "timestamp": 1728504000000,
    "uptime": 120.4
  }
  ```

### 2. Market Data Connectivity
- **Endpoint:** `GET /api/market/status`
- **Response:**
  ```json
  {
    "status": "ONLINE",
    "latencyMs": 45,
    "lastCheckedAt": 1728504000000,
    "isLive": true,
    "note": "Official Bitget V2 market-data feed connected."
  }
  ```

### 3. Market Tickers
- **Endpoint:** `GET /api/market/tickers`
- **Response:** Array of eligible USDT perpetual tickers with 24h price and volume stats.

### 4. Market Candles
- **Endpoint:** `GET /api/market/candles?symbol=BTCUSDT&timeframe=15m`
- **Response:** Array of historical OHLCV candles with forming/closed flag.

### 5. Multi-Timeframe Scanner
- **Endpoint:** `GET /api/market/scanner`
- **Response:**
  ```json
  {
    "qualified": [ /* setups satisfying moving averages, RSI, volume, and R:R */ ],
    "rejected": [ /* setups disqualified with explicit reason */ ],
    "btcContext": { "trend": "BULLISH", "btcPrice": 64250 },
    "timestamp": 1728504000000
  }
  ```

### 6. AI Multi-Agent Deliberation
- **Endpoint:** `POST /api/agents/deliberate`
- **Body:** `{ "proposal": { ... } }`
- **Response:**
  ```json
  {
    "isApproved": true,
    "coordinatorVerdict": "APPROVED_FOR_PAPER_EXECUTION",
    "thesis": { /* Market Intelligence output */ },
    "review": { /* Adversarial Review critique */ },
    "riskResult": { /* Deterministic Risk Engine evaluation */ }
  }
  ```

### 7. Paper Order Placement
- **Endpoint:** `POST /api/orders/paper`
- **Body:** `{ "symbol": "BTCUSDT", "side": "LONG", "entryPrice": 60000, "stopLoss": 59600, "takeProfit": 61000, "quantity": 0.1 }`
- **Response:** HTTP 201 Created with order and position IDs.

### 8. Live Mainnet Order Interception Guard
- **Endpoint:** `POST /api/orders/live` or `POST /api/orders/mainnet`
- **Response:** HTTP 403 Forbidden:
  ```json
  {
    "error": "MAINNET_EXECUTION_BLOCKED",
    "message": "CRITICAL SECURITY INTERCEPTION: Live Mainnet execution is strictly disabled. VT2 operates exclusively in verifiable PAPER TRADING mode.",
    "securityAlert": true
  }
  ```

### 9. System & Strategy Settings
- **Endpoint:** `GET /api/settings`
- **Response:** Current persisted user settings and factory defaults (`entryAllocationPercent`, `theme`, `riskPerTrade`, `maxDailyLoss`, etc.).
- **Endpoint:** `POST /api/settings`
- **Body:** `{ "entryAllocationPercent": 25, "theme": "light", "riskPerTrade": 0.005, ... }`
- **Response:** HTTP 200 `{ "success": true, "updated": [...] }` or HTTP 400 validation error.

### 10. Positions & Execution Management
- **Endpoint:** `GET /api/positions` — Active simulated paper positions.
- **Endpoint:** `POST /api/positions/:id/close` — Manually close an active paper position at modeled market price.
- **Endpoint:** `GET /api/orders` — Audit trail of submitted, filled, and rejected orders.

### 11. Historical Journal & Setup Archive
- **Endpoint:** `GET /api/journal` — Closed paper trades with performance metrics and execution notes.
- **Endpoint:** `GET /api/rejected-setups` — Disqualified setups archive with explicit rejection reasons.

### 12. Walk-Forward Backtesting
- **Endpoint:** `POST /api/backtest`
- **Body:** `{ "symbol": "BTCUSDT", "timeframe": "15m", "config": { "riskPerTrade": 0.005 } }`
- **Response:** Performance report containing net P&L, win rate, profit factor, max drawdown, expectancy, and chronologically executed trade logs.

### 13. System Health & Diagnostics
- **Endpoint:** `GET /api/system/health`
- **Response:** Memory metrics (heap, RSS), uptime, Node.js version, platform, feed status, and active database records.

### 14. Server-Sent Events (SSE) Stream
- **Endpoint:** `GET /api/stream`
- **Stream Format:** `Content-Type: text/event-stream`
- Emits real-time account equity and position updates every 2.5 seconds.
