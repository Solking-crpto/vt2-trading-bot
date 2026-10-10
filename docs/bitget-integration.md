# Bitget Developer Integration & Capabilities

## Official Sources Evaluated

- **Agent Hub**: `https://www.bitget.com/activity-hub/agent-hub`
- **Agent Hub Documentation**: `https://www.bitget.com/docs/uta/agent-hub`
- **Official SDK Repository**: `https://github.com/Bitget-AI/agent-sdk`
- **Official Agent Hub Repository**: `https://github.com/Bitget-AI/agent_hub`
- **Official MCP Repository**: `https://github.com/Bitget-AI/agent-mcp`
- **Official API Documentation**: `https://www.bitget.com/api-doc`

## Verified SDK Specifications

From the official repository `Bitget-AI/agent-sdk`:
- **Package name:** `@bitget-ai/bitget-agent-sdk`
- **Target runtime:** Node.js ≥ 20, ESM only, zero runtime dependencies.
- **Operations:** 89 UTA v3 operations, 14 AI Intent verbs (`market`, `trade`, `account`, `position`, `transfer`, `asset`, `margin`, `orderbook`, etc.).
- **Authentication:** Local HMAC-SHA256 request signing.
- **Surface modes:** `intent` (curated AI verbs), `full` (1:1 REST operations).
- **Safe default:** `readOnly: true` (drops all write tools).
- **Environment:** `paperTrading: false` (routes to Bitget Demo environment).

## Verified Public REST Endpoints

1. **Contracts Metadata:**
   - Path: `GET /api/v2/mix/market/contracts?productType=USDT-FUTURES`
   - Returns symbol list, tickSize, stepSize, minOrderQty, maxOrderQty.

2. **Market Tickers:**
   - Path: `GET /api/v2/mix/market/tickers?productType=USDT-FUTURES`
   - Returns 24h high/low, last price, 24h volume.

3. **OHLCV Candles:**
   - Path: `GET /api/v2/mix/market/candles?symbol={SYMBOL}&granularity={5m|15m|4h}&productType=USDT-FUTURES&limit={LIMIT}`
   - Array schema: `[timestamp, open, high, low, close, volume, ...]`.

## Local Network Findings & Transparent Simulation Handling

During testing in this execution environment:
- Direct outbound HTTPS connections to `api.bitget.com:443` timed out (`UND_ERR_CONNECT_TIMEOUT`).
- Crypto exchange APIs may be throttled, blocked by regional ISP rules, or geofenced.
- In accordance with Section 4 of the master build specification:
  - VT2 reports connectivity status transparently (`OFFLINE / TIMEOUT`).
  - Never fabricates fake live data.
  - When the live feed is offline or unreachable, VT2 activates verified market fixtures for paper trading, clearly labeled in the UI as:
    `SIMULATED_FIXTURE: Live Bitget feed offline. Showing verified market fixtures for paper trading.`
- The Bitget adapter is strictly isolated behind a clean class boundary (`BitgetAdapter`).
- Order placement via live exchange API is architecturally refused on client and server.
