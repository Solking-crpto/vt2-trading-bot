# Deterministic Risk Policy

## Principle: Code Over Opinion

VT2 enforces risk constraints deterministically in pure code (`src/risk-engine.js`).
No AI agent thesis, indicator signal, or user impulse can bypass or loosen the deterministic risk limits.

## Hard Constraints

| Check | Boundary | Action on Breach |
|---|---|---|
| **Risk per trade** | Default 0.5% (Max 1.0%) of current equity | Rejection: `RISK_CONFIG_EXCEEDS_LIMIT` |
| **Entry size allocation** | 1% to 100% of trading allocation base (default 10%) | Rejection: `INVALID_ENTRY_ALLOCATION` |
| **High allocation confirmation** | Affirmative dialog for >10%; explicit 5-point warning for 100% | Interactive Client & Engine Verification |
| **Daily loss limit** | 2.0% of Start-of-Day (SOD) equity | Rejection: `DAILY_LOSS_LIMIT_REACHED` |
| **Consecutive losses** | 3 losses in a row | Trading Pause: `CONSECUTIVE_LOSS_PAUSE` |
| **Concurrent positions cap** | 1 to 5 non-correlated positions (default 1) | Rejection: `MAX_OPEN_POSITIONS_EXCEEDED` |
| **Aggregate open risk cap** | 0.5% to 2.0% equity total portfolio risk across all positions (default 1.0%) | Rejection: `AGGREGATE_RISK_CAP_EXCEEDED` |
| **Duplicate symbol guard** | Maximum 1 active position per instrument symbol | Rejection: `DUPLICATE_ORDER_OR_POSITION` |
| **Directional correlation guard** | Prevents conflicting long & short directional exposure across correlated pairs | Rejection: `CORRELATED_EXPOSURE_LIMIT` |
| **Post-trade cooldown** | 30 minutes after trade close | Rejection: `COOLDOWN_ACTIVE` |
| **Signal freshness** | Maximum 10 minutes from signal generation | Rejection: `SIGNAL_EXPIRED` |
| **Directional stop loss** | Long stop must be < Entry; Short stop must be > Entry | Rejection: `INVALID_STOP_LOSS` |
| **Net Reward-to-Risk** | Minimum 1.5:1 after modeled costs | Rejection: `INSUFFICIENT_NET_REWARD_RISK` |
| **Order size precision** | Aligned with contract step size & min quantity | Rejection: `ORDER_QUANTITY_BELOW_MINIMUM` |
| **Input sanity** | All prices, sizes, and equity must be finite positive numbers | Rejection: `INVALID_INPUT` |

## Directional Position Sentiment Monitoring

The active trade monitor (`src/monitor/trade-monitor.js`) polls every 5 minutes to evaluate position health:
1. **SUPPORTIVE**: Trend alignment intact (price > EMA20 for Longs, RSI healthy). Position continues running.
2. **WEAKENING**: Momentum slowing or adverse candle close. Triggers SSE alert in manual mode; moves stop loss to breakeven in automated mode.
3. **REVERSED**: Major indicator reversal (adverse EMA cross + RSI break). Triggers urgent SSE alert in manual mode; initiates immediate market-order exit in automated mode.

## Automated Paper Trading Daily Quota

The automated execution runner (`src/execution/auto-trader.js`) operates strictly in `PAPER` mode:
- Hard daily trade quota (`maxTradesPerDay`, default 3).
- Resets deterministically at the **00:00 UTC** calendar day boundary.
- Halts execution upon reaching daily loss limit, consecutive loss pause, or quota exhaustion.
- Master Emergency Kill Switch instantly disarms automated cycle execution and closes all open paper positions.

## Multi-Asset Universe & Session Specifications (Bitget UTA v2)

- **Crypto Perpetuals (`BTCUSDT`, `ETHUSDT`, `SOLUSDT`, etc.)**: Trade continuously 24 hours a day, 7 days a week, 365 days a year with USDT margin and 8-hour funding rate cycles. Macro market context is benchmarked against `BTCUSDT`.
- **Tokenized US Equity Perpetuals (`SPYUSDT`, `NVDAUSDT`, `TSLAUSDT`, `AAPLUSDT`, etc.)**: Official Bitget V2 Contract specifications classify these instruments under Unified Trading Account (UTA) with `isRwa: "YES"`. In accordance with official Bitget futures documentation, tokenized equity contracts are continuous 24/7 perpetual swap futures settled in USDT with standard 8-hour funding intervals. Traditional US equity exchange session hours (09:30-16:00 ET), weekend closures, and FINRA Rule 4210 Pattern Day Trader (PDT) margin regulations do NOT apply to crypto-native USDT perpetual derivatives. Macro equity market context is benchmarked against the S&P 500 ETF perpetual `SPYUSDT`.

## Dual-Market Bot & Candidate Selection Rules

- **Account-Level Gate Priority**: Account gates (`COOLDOWN_ACTIVE`, `DAILY_LOSS_LIMIT_REACHED`, `CONSECUTIVE_LOSS_PAUSE`, `PAUSED_MANUAL`) are evaluated before candidate evaluation. When an account gate is active, the bot transitions to `WAITING` status with an exact countdown and halt timestamp, without iterating or logging candidate evaluations.
- **Candidate Loop Walk**: When an individual candidate fails symbol-specific checks (e.g. `INSUFFICIENT_NET_REWARD_RISK`, `DUPLICATE_ORDER_OR_POSITION`), the bot advances sequentially to subsequent candidates rather than halting the cycle.
- **Candidate Skip Cache**: Disqualified symbols can be temporarily bypassed for `candidateSkipMinutes` (default 5 min, editable) to prevent repeated re-evaluation cycles.
- **Log De-duplication**: Identical consecutive log messages are de-duplicated with an inline counter (`×N`) to maintain high-signal activity telemetry.
- **Bot Market Modes**:
  - `stocks`: Restricts bot candidate search strictly to verified tokenized US equity perpetuals (zero crypto).
  - `crypto`: Restricts bot candidate search strictly to crypto perpetuals (zero equities).
  - `both`: Evaluates candidates across both universes according to `botCandidateOrder` (`equities_first` or `best_score`).

## Fail-Closed Design

If any parameter is missing, non-finite, stale, or contradictory, the trade is rejected immediately.
There is zero automatic fallback to unsafe defaults. Real capital mainnet order submission remains strictly intercepted with HTTP 403 on server and client.
