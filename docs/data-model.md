# Data Model & Storage Schema

VT2 utilizes the native Node.js v26 SQLite engine (`node:sqlite` / `DatabaseSync`) storing data durably at `data/vt2.db`.

## SQLite Tables

### 1. `settings`
- `key` (TEXT, PK): Unique configuration identifier.
- `value` (TEXT): JSON-serialized setting value.
- `updated_at` (INTEGER): Timestamp of last change.

### 2. `positions`
- `id` (TEXT, PK): Unique simulated position identifier (`paper-pos-xxxx`).
- `order_id` (TEXT): Associated entry order ID.
- `environment` (TEXT): Immutable `'PAPER'`.
- `symbol` (TEXT): e.g. `'BTCUSDT'`.
- `side` (TEXT): `'LONG'` or `'SHORT'`.
- `entry_price` (REAL): Executed fill price.
- `current_price` (REAL): Last market tick.
- `original_quantity` (REAL): Initial position size.
- `current_quantity` (REAL): Current position size after partial exits.
- `stop_loss` (REAL): Active stop price.
- `take_profit` (REAL): Final target price.
- `partial_take_profit_price` (REAL): Level for 50% partial exit (+1.1%).
- `is_partial_closed` (INTEGER): 0 or 1.
- `is_breakeven_moved` (INTEGER): 0 or 1.
- `is_trailing_active` (INTEGER): 0 or 1.
- `trailing_stop` (REAL): Active trailing stop level.
- `unrealized_pnl` (REAL): Current floating P&L.
- `realized_pnl` (REAL): Closed P&L.
- `fees_paid` (REAL): Total cumulative fees.
- `status` (TEXT): `'OPEN'` or `'CLOSED'`.
- `opened_at` (INTEGER): Timestamp.
- `closed_at` (INTEGER): Timestamp.
- `last_updated_at` (INTEGER): Timestamp.
- `exit_reason` (TEXT): Reason position was closed.
- `exit_price` (REAL): Executed close price.
- `is_simulated` (INTEGER): 1.

### 3. `trade_journal`
- Durable historical log of every closed position with full AI deliberation records (`thesis_json`, `review_json`, `risk_result_json`).

### 4. `rejected_setups`
- Archive of every disqualified candidate setup, including symbol, rejection reason, explanation, and indicator snapshot.

### 5. `backtest_runs`
- Historical backtest run records, parameters, win rate, net P&L, profit factor, drawdown, and individual trade list.
