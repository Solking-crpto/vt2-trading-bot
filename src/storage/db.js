import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';

export class Database {
  constructor(dbPath = 'data/vt2.db') {
    this.dbPath = dbPath;
    this.db = null;
  }

  init() {
    if (this.dbPath !== ':memory:') {
      const dir = path.dirname(this.dbPath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
    }

    this.db = new DatabaseSync(this.dbPath);
    this.createTables();
    return this;
  }

  createTables() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        updated_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS orders (
        id TEXT PRIMARY KEY,
        position_id TEXT,
        environment TEXT NOT NULL,
        symbol TEXT NOT NULL,
        side TEXT NOT NULL,
        requested_price REAL NOT NULL,
        fill_price REAL NOT NULL,
        quantity REAL NOT NULL,
        notional REAL NOT NULL,
        fee REAL NOT NULL,
        status TEXT NOT NULL,
        submitted_at INTEGER NOT NULL,
        filled_at INTEGER,
        is_simulated INTEGER NOT NULL DEFAULT 1
      );

      CREATE TABLE IF NOT EXISTS positions (
        id TEXT PRIMARY KEY,
        order_id TEXT NOT NULL,
        environment TEXT NOT NULL,
        symbol TEXT NOT NULL,
        side TEXT NOT NULL,
        entry_price REAL NOT NULL,
        current_price REAL NOT NULL,
        original_quantity REAL NOT NULL,
        current_quantity REAL NOT NULL,
        stop_loss REAL NOT NULL,
        take_profit REAL NOT NULL,
        partial_take_profit_price REAL,
        is_partial_closed INTEGER NOT NULL DEFAULT 0,
        is_breakeven_moved INTEGER NOT NULL DEFAULT 0,
        is_trailing_active INTEGER NOT NULL DEFAULT 0,
        trailing_stop REAL,
        unrealized_pnl REAL NOT NULL DEFAULT 0,
        realized_pnl REAL NOT NULL DEFAULT 0,
        fees_paid REAL NOT NULL DEFAULT 0,
        status TEXT NOT NULL,
        opened_at INTEGER NOT NULL,
        closed_at INTEGER,
        last_updated_at INTEGER NOT NULL,
        exit_reason TEXT,
        exit_price REAL,
        is_simulated INTEGER NOT NULL DEFAULT 1
      );

      CREATE TABLE IF NOT EXISTS trade_journal (
        id TEXT PRIMARY KEY,
        position_id TEXT,
        timestamp INTEGER NOT NULL,
        environment TEXT NOT NULL,
        symbol TEXT NOT NULL,
        side TEXT NOT NULL,
        strategy_version TEXT NOT NULL,
        entry_price REAL NOT NULL,
        exit_price REAL NOT NULL,
        quantity REAL NOT NULL,
        realized_pnl REAL NOT NULL,
        roi_percent REAL NOT NULL,
        holding_time_ms INTEGER NOT NULL,
        fees_paid REAL NOT NULL,
        exit_reason TEXT NOT NULL,
        thesis_json TEXT,
        review_json TEXT,
        risk_result_json TEXT,
        is_simulated INTEGER NOT NULL DEFAULT 1
      );

      CREATE TABLE IF NOT EXISTS rejected_setups (
        id TEXT PRIMARY KEY,
        timestamp INTEGER NOT NULL,
        symbol TEXT NOT NULL,
        rejection_reason TEXT NOT NULL,
        explanation TEXT,
        net_rr REAL,
        score REAL,
        details_json TEXT
      );

      CREATE TABLE IF NOT EXISTS backtest_runs (
        id TEXT PRIMARY KEY,
        timestamp INTEGER NOT NULL,
        symbol TEXT NOT NULL,
        timeframe TEXT NOT NULL,
        start_time INTEGER NOT NULL,
        end_time INTEGER NOT NULL,
        total_trades INTEGER NOT NULL,
        win_rate REAL NOT NULL,
        net_pnl REAL NOT NULL,
        profit_factor REAL NOT NULL,
        max_drawdown_percent REAL NOT NULL,
        expectancy REAL NOT NULL,
        avg_holding_time_ms INTEGER NOT NULL,
        parameters_json TEXT NOT NULL,
        trades_json TEXT NOT NULL
      );
    `);
  }

  saveSetting(key, value) {
    const stmt = this.db.prepare(`
      INSERT INTO settings (key, value, updated_at)
      VALUES (?, ?, ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
    `);
    stmt.run(key, JSON.stringify(value), Date.now());
  }

  getSetting(key, defaultValue = null) {
    const stmt = this.db.prepare('SELECT value FROM settings WHERE key = ?');
    const row = stmt.get(key);
    if (!row) return defaultValue;
    try {
      return JSON.parse(row.value);
    } catch {
      return row.value;
    }
  }

  getAllSettings() {
    const stmt = this.db.prepare('SELECT key, value FROM settings');
    const rows = stmt.all();
    const result = {};
    for (const r of rows) {
      try {
        result[r.key] = JSON.parse(r.value);
      } catch {
        result[r.key] = r.value;
      }
    }
    return result;
  }

  saveAccountState(state) {
    this.saveSetting('account_state', state);
  }

  getAccountState() {
    return this.getSetting('account_state', null);
  }

  saveOrder(order) {
    const stmt = this.db.prepare(`
      INSERT INTO orders (
        id, position_id, environment, symbol, side,
        requested_price, fill_price, quantity, notional, fee,
        status, submitted_at, filled_at, is_simulated
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        status = excluded.status,
        fill_price = excluded.fill_price,
        filled_at = excluded.filled_at
    `);
    stmt.run(
      order.id, order.positionId || null, order.environment || 'PAPER',
      order.symbol, order.side, order.requestedPrice, order.fillPrice || order.requestedPrice,
      order.quantity, order.notional || (order.quantity * order.requestedPrice),
      order.fee || 0, order.status, order.submittedAt || Date.now(),
      order.filledAt || null, order.isSimulated !== false ? 1 : 0
    );
  }

  getOrders(limit = 100) {
    const stmt = this.db.prepare('SELECT * FROM orders ORDER BY submitted_at DESC LIMIT ?');
    return stmt.all(limit);
  }

  savePosition(pos) {
    const stmt = this.db.prepare(`
      INSERT INTO positions (
        id, order_id, environment, symbol, side, entry_price, current_price,
        original_quantity, current_quantity, stop_loss, take_profit, partial_take_profit_price,
        is_partial_closed, is_breakeven_moved, is_trailing_active, trailing_stop,
        unrealized_pnl, realized_pnl, fees_paid, status, opened_at, closed_at,
        last_updated_at, exit_reason, exit_price, is_simulated
      ) VALUES (
        ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
      )
      ON CONFLICT(id) DO UPDATE SET
        current_price = excluded.current_price,
        current_quantity = excluded.current_quantity,
        stop_loss = excluded.stop_loss,
        is_partial_closed = excluded.is_partial_closed,
        is_breakeven_moved = excluded.is_breakeven_moved,
        is_trailing_active = excluded.is_trailing_active,
        trailing_stop = excluded.trailing_stop,
        unrealized_pnl = excluded.unrealized_pnl,
        realized_pnl = excluded.realized_pnl,
        fees_paid = excluded.fees_paid,
        status = excluded.status,
        closed_at = excluded.closed_at,
        last_updated_at = excluded.last_updated_at,
        exit_reason = excluded.exit_reason,
        exit_price = excluded.exit_price
    `);

    stmt.run(
      pos.id,
      pos.orderId || pos.order_id || null,
      pos.environment || 'PAPER',
      pos.symbol,
      pos.side,
      pos.entryPrice,
      pos.currentPrice,
      pos.originalQuantity,
      pos.currentQuantity,
      pos.stopLoss,
      pos.takeProfit,
      pos.partialTakeProfitPrice ?? null,
      pos.isPartialClosed ? 1 : 0,
      pos.isBreakevenMoved ? 1 : 0,
      pos.isTrailingActive ? 1 : 0,
      pos.trailingStop ?? null,
      pos.unrealizedPnl ?? 0,
      pos.realizedPnl ?? 0,
      pos.feesPaid ?? 0,
      pos.status || 'OPEN',
      pos.openedAt ?? Date.now(),
      pos.closedAt ?? null,
      pos.lastUpdatedAt ?? Date.now(),
      pos.exitReason ?? null,
      pos.exitPrice ?? null,
      1
    );
  }

  getActivePositions() {
    const stmt = this.db.prepare("SELECT * FROM positions WHERE status = 'OPEN' ORDER BY opened_at DESC");
    return stmt.all();
  }

  saveJournalEntry(entry) {
    const stmt = this.db.prepare(`
      INSERT INTO trade_journal (
        id, position_id, timestamp, environment, symbol, side,
        strategy_version, entry_price, exit_price, quantity, realized_pnl,
        roi_percent, holding_time_ms, fees_paid, exit_reason,
        thesis_json, review_json, risk_result_json, is_simulated
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)
    `);

    stmt.run(
      entry.id, entry.positionId, entry.timestamp, entry.environment || 'PAPER',
      entry.symbol, entry.side, entry.strategyVersion || 'v1.0.0',
      entry.entryPrice, entry.exitPrice, entry.quantity, entry.realizedPnl,
      entry.roiPercent, entry.holdingTimeMs || 0, entry.feesPaid, entry.exitReason,
      JSON.stringify(entry.thesis || {}), JSON.stringify(entry.review || {}),
      JSON.stringify(entry.riskResult || {})
    );
  }

  getJournalEntries(limit = 100) {
    const stmt = this.db.prepare('SELECT * FROM trade_journal ORDER BY timestamp DESC LIMIT ?');
    return stmt.all(limit).map(row => ({
      ...row,
      thesis: JSON.parse(row.thesis_json || '{}'),
      review: JSON.parse(row.review_json || '{}'),
      riskResult: JSON.parse(row.risk_result_json || '{}'),
    }));
  }

  saveRejectedSetup(setup) {
    const stmt = this.db.prepare(`
      INSERT INTO rejected_setups (
        id, timestamp, symbol, rejection_reason, explanation, net_rr, score, details_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);
    stmt.run(
      setup.id || `rej-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      setup.timestamp || Date.now(),
      setup.symbol,
      setup.rejectionReason,
      setup.explanation || '',
      setup.netRR || null,
      setup.score || null,
      JSON.stringify(setup.details || {})
    );
  }

  getRejectedSetups(limit = 100) {
    const stmt = this.db.prepare('SELECT * FROM rejected_setups ORDER BY timestamp DESC LIMIT ?');
    return stmt.all(limit).map(row => ({
      ...row,
      details: JSON.parse(row.details_json || '{}'),
    }));
  }

  saveBacktestRun(bt) {
    const stmt = this.db.prepare(`
      INSERT INTO backtest_runs (
        id, timestamp, symbol, timeframe, start_time, end_time,
        total_trades, win_rate, net_pnl, profit_factor,
        max_drawdown_percent, expectancy, avg_holding_time_ms,
        parameters_json, trades_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    stmt.run(
      bt.id, bt.timestamp, bt.symbol, bt.timeframe, bt.startTime, bt.endTime,
      bt.totalTrades, bt.winRate, bt.netPnl, bt.profitFactor,
      bt.maxDrawdownPercent, bt.expectancy, bt.avgHoldingTimeMs,
      JSON.stringify(bt.parameters || {}),
      JSON.stringify(bt.trades || [])
    );
  }

  getBacktestRuns(limit = 20) {
    const stmt = this.db.prepare('SELECT * FROM backtest_runs ORDER BY timestamp DESC LIMIT ?');
    return stmt.all(limit).map(row => ({
      ...row,
      parameters: JSON.parse(row.parameters_json || '{}'),
      trades: JSON.parse(row.trades_json || '[]'),
    }));
  }

  close() {
    if (this.db) {
      this.db.close();
      this.db = null;
    }
  }
}
