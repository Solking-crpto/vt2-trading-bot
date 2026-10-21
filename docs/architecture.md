# VT2 System Architecture

This document describes the architectural components and data flow of the VT2 trading bot and research terminal.

## 1. Components

### Market Data Ingestion Adapter (`src/adapters/bitget-adapter.js`, `src/adapters/bitget-ws.js`)
The market data adapter interacts strictly with Bitget's public V2 REST and WebSocket endpoints. It dynamically discovers tokenized US equity perpetual contracts at launch (`isRwa === "YES"`), enforces strict ascending chronological candle sorting via `assertCandleIntegrity` to eliminate look-ahead timestamp corruption, and streams real-time ticker prices with sub-second latency and automated heartbeat age tracking.

### Quantitative Strategy Engine (`src/strategy/engine.js`, `src/strategy/registry.js`)
The strategy engine calculates multi-timeframe moving averages (EMA20/50/200), RSI momentum filters, and volume expansion ratios across 4-hour, 15-minute, and 5-minute intervals. Equity setups are strictly gated by the closed 4-hour trend of the S&P 500 ETF (`SPYUSDT`) to ensure directional macro alignment, and the strategy registry immutably maintains empirical validation statuses (such as S0's unvalidated replay status).

### Multi-Agent Deliberation Pipeline (`src/agents/index.js`)
The deliberation pipeline coordinates three deterministic, rules-based agents without unconstrained neural-network hallucination. The *Market Intelligence Agent* formulates mathematical directional theses; the *Adversarial Review Agent* stress-tests setups against spread decay, taker fees, and benchmark divergence; and the *Execution Coordinator* enforces strict gating and entry sizing bounds.

### Deterministic Risk Engine (`src/risk-engine.js`, `config/live-limits.json`)
The risk engine enforces mathematical risk guardrails with absolute veto power over all proposed orders. It sizes positions to exactly configured equity risk (default 0.5% in paper, bounded by min(strategy, 0.25%) in live), locks entries upon reaching the daily loss limit (2% paper, $10.00 live), enforces 3 consecutive loss circuit pauses, requires a 30-minute cooldown, and prevents conflicting directional exposure inside correlation groups.

### Execution Engine & Mode State Machine (`src/environment.js`, `src/execution/paper-engine.js`, `src/execution/bitget-trade-client.js`)
The execution system manages a strict three-tier execution hierarchy: PAPER (internal simulation, default), DEMO (Bitget official paptrading for crypto), and LIVE (strictly local, multi-factor armed). Orders are quantized according to exchange contract step rules (`minTradeNum`, `sizeMultiplier`), and all live/demo executions mandate exchange-side stop loss verification before fill confirmation.

### Data Persistence & State Store (`src/storage/db.js`)
Persistence is powered by Node.js native SQLite (`node:sqlite`) for local operation (`data/vt2.db`) and an in-memory database fallback for serverless deployments. It manages ACID-compliant transactional persistence for orders, position lifecycles, user settings, trade journal archives, and rejected candidate setup telemetry.

### Unattended Service & Monitoring Suite (`src/service/`, `src/monitor/trade-monitor.js`)
The service layer enables reliable unattended operation through PM2 ecosystem integration, automated crash-loop backoff protection, date-stamped log management with 14-day automated retention, background position sentiment monitoring, and optional secret-redacted webhook/Telegram alert dispatching.

## 2. End-to-End Data Flow

```
[Bitget Public Feeds] ──> [Market Data Ingestion] ──> [Strategy Engine & SPY Filter]
                                                               │
                                                               ▼
[Persistent SQLite DB] <── [Risk Engine & Limits] <── [Multi-Agent Deliberation]
           │                         │
           ▼                         ▼
[Web UI / SSE Stream] <── [Execution Engine] (PAPER / DEMO / LIVE)
```

1. **Ingestion:** Public market feeds stream live candles and ticker prices into memory, where candle integrity is validated.
2. **Signal Scanning:** The strategy engine scans active universe symbols, evaluating multi-timeframe moving averages and SPY benchmark alignment.
3. **Deliberation:** Passing candidates are evaluated by the Market Intelligence and Adversarial Review agents, testing counter-theses and slippage.
4. **Risk Gate:** The Execution Coordinator passes the setup to the Deterministic Risk Engine, which computes position size from stop distance and enforces hard loss and concurrency caps.
5. **Execution:** Upon risk approval, the order is routed to the active execution engine (PAPER simulation, DEMO paptrading, or armed LIVE exchange adapter).
6. **State & Broadcast:** Orders and fills are flushed to SQLite and broadcast via Server-Sent Events (SSE) to the interactive terminal.
