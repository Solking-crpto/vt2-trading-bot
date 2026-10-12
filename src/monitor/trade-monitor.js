import { computeIndicators } from '../indicators/index.js';

export const SENTIMENT_STATE = Object.freeze({
  SUPPORTIVE: 'SUPPORTIVE',
  WEAKENING: 'WEAKENING',
  REVERSED: 'REVERSED',
  CHECK_FAILED: 'CHECK_FAILED',
});

/**
 * 5-Minute Trade Sentiment Monitor
 * Evaluates directional health and indicator sentiment for all open positions.
 */
export class TradeMonitor {
  constructor({ db, paperEngine, bitget, strategy, sseBroadcast, autoTrader = null, intervalMs = 300000 }) {
    this.db = db;
    this.paperEngine = paperEngine;
    this.bitget = bitget;
    this.strategy = strategy;
    this.sseBroadcast = sseBroadcast || (() => {});
    this.autoTrader = autoTrader;
    this.intervalMs = intervalMs;
    this.timer = null;
    this.lastCheckAt = null;
    this.nextCheckAt = Date.now() + this.intervalMs;
    this.positionSentiments = new Map(); // positionId -> { state, timestamp, reasons, indicators }

    this.initDb();
  }

  initDb() {
    try {
      this.db.db.exec(`
        CREATE TABLE IF NOT EXISTS position_sentiment_history (
          id TEXT PRIMARY KEY,
          position_id TEXT NOT NULL,
          timestamp INTEGER NOT NULL,
          symbol TEXT NOT NULL,
          side TEXT NOT NULL,
          sentiment_state TEXT NOT NULL,
          reasons_json TEXT,
          indicators_json TEXT,
          action_taken TEXT
        );
      `);
    } catch (err) {
      console.warn('[TradeMonitor] Warning initializing sentiment table:', err.message);
    }
  }

  start() {
    if (this.timer) clearInterval(this.timer);
    this.nextCheckAt = Date.now() + this.intervalMs;
    this.timer = setInterval(() => this.checkPositions(), this.intervalMs);
    if (this.timer?.unref) this.timer.unref();
  }

  stop() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  /**
   * Deterministically evaluates sentiment state for an open position.
   */
  evaluateSentiment(position, timeframeCandles, btcContext = null) {
    const c4h = timeframeCandles?.['4h'];
    const c15m = timeframeCandles?.['15m'];
    const c5m = timeframeCandles?.['5m'];

    if (!c4h || c4h.length < 20 || !c15m || c15m.length < 20) {
      return {
        state: SENTIMENT_STATE.CHECK_FAILED,
        reasons: ['Insufficient candle data to calculate sentiment moving averages.'],
        indicators: {},
      };
    }

    const ind4h = computeIndicators(c4h);
    const ind15m = computeIndicators(c15m);
    const ind5m = c5m ? computeIndicators(c5m) : null;

    const p4h = ind4h.current.close;
    const ema20_4h = ind4h.current.ema20;
    const p15m = ind15m.current.close;
    const ema50_15m = ind15m.current.ema50;
    const rsi15m = ind15m.current.rsi;

    const isLong = position.side === 'LONG';
    const reasons = [];

    // Long sentiment rules
    if (isLong) {
      const is4hBearish = p4h < ema20_4h;
      const is15mBearish = p15m < ema50_15m;
      const isRsiDepressed = rsi15m < 45;

      if (is4hBearish && is15mBearish) {
        reasons.push(`4h price (${p4h}) broke below EMA20 (${ema20_4h?.toFixed(2)})`);
        reasons.push(`15m price (${p15m}) broke below EMA50 (${ema50_15m?.toFixed(2)})`);
        if (btcContext?.trend === 'BEARISH') reasons.push('BTC macro trend flipped BEARISH');
        return {
          state: SENTIMENT_STATE.REVERSED,
          reasons,
          indicators: { p4h, ema20_4h, p15m, ema50_15m, rsi15m },
        };
      }

      if (is15mBearish || isRsiDepressed) {
        if (is15mBearish) reasons.push(`15m price (${p15m}) below EMA50 (${ema50_15m?.toFixed(2)})`);
        if (isRsiDepressed) reasons.push(`15m RSI (${rsi15m}) slipped below 45 momentum floor`);
        return {
          state: SENTIMENT_STATE.WEAKENING,
          reasons,
          indicators: { p4h, ema20_4h, p15m, ema50_15m, rsi15m },
        };
      }

      reasons.push(`4h price above EMA20 and 15m price above EMA50`);
      reasons.push(`15m RSI healthy at ${rsi15m}`);
      return {
        state: SENTIMENT_STATE.SUPPORTIVE,
        reasons,
        indicators: { p4h, ema20_4h, p15m, ema50_15m, rsi15m },
      };
    }

    // Short sentiment rules
    const is4hBullish = p4h > ema20_4h;
    const is15mBullish = p15m > ema50_15m;
    const isRsiElevated = rsi15m > 55;

    if (is4hBullish && is15mBullish) {
      reasons.push(`4h price (${p4h}) broke above EMA20 (${ema20_4h?.toFixed(2)})`);
      reasons.push(`15m price (${p15m}) broke above EMA50 (${ema50_15m?.toFixed(2)})`);
      if (btcContext?.trend === 'BULLISH') reasons.push('BTC macro trend flipped BULLISH');
      return {
        state: SENTIMENT_STATE.REVERSED,
        reasons,
        indicators: { p4h, ema20_4h, p15m, ema50_15m, rsi15m },
      };
    }

    if (is15mBullish || isRsiElevated) {
      if (is15mBullish) reasons.push(`15m price (${p15m}) above EMA50 (${ema50_15m?.toFixed(2)})`);
      if (isRsiElevated) reasons.push(`15m RSI (${rsi15m}) crossed above 55 momentum ceiling`);
      return {
        state: SENTIMENT_STATE.WEAKENING,
        reasons,
        indicators: { p4h, ema20_4h, p15m, ema50_15m, rsi15m },
      };
    }

    reasons.push(`4h price below EMA20 and 15m price below EMA50`);
    reasons.push(`15m RSI healthy for short at ${rsi15m}`);
    return {
      state: SENTIMENT_STATE.SUPPORTIVE,
      reasons,
      indicators: { p4h, ema20_4h, p15m, ema50_15m, rsi15m },
    };
  }

  /**
   * Runs sentiment evaluation for all currently open paper positions.
   * @param {boolean} [manualTrigger=false]
   */
  async checkPositions(manualTrigger = false) {
    this.lastCheckAt = Date.now();
    this.nextCheckAt = Date.now() + this.intervalMs;

    const openPositions = this.paperEngine.positions.filter(p => p.status === 'OPEN');
    const results = [];

    if (openPositions.length === 0) {
      return {
        timestamp: this.lastCheckAt,
        checkedCount: 0,
        results: [],
        nextCheckAt: this.nextCheckAt,
      };
    }

    // Check health
    const health = await this.bitget.checkHealth();
    if (!health.isLive && !this.bitget.forceFixtureMode) {
      // Feed failure: do not close positions silently
      for (const pos of openPositions) {
        this.positionSentiments.set(pos.id, {
          state: SENTIMENT_STATE.CHECK_FAILED,
          timestamp: this.lastCheckAt,
          reasons: ['Exchange feed offline. Sentiment check skipped.'],
          indicators: {},
        });
      }
      return {
        timestamp: this.lastCheckAt,
        checkedCount: openPositions.length,
        status: 'FEED_OFFLINE',
        results: [],
        nextCheckAt: this.nextCheckAt,
      };
    }

    // Evaluate BTC macro context
    let btcContext = null;
    try {
      const btcCandles = await this.bitget.getCandles('BTCUSDT', '4h', 50);
      btcContext = this.strategy.evaluateBtcTrend(btcCandles.candles);
    } catch {}

    for (const pos of openPositions) {
      let sentimentResult;
      try {
        const [c4h, c15m, c5m] = await Promise.all([
          this.bitget.getCandles(pos.symbol, '4h', 50),
          this.bitget.getCandles(pos.symbol, '15m', 50),
          this.bitget.getCandles(pos.symbol, '5m', 50),
        ]);

        sentimentResult = this.evaluateSentiment(pos, {
          '4h': c4h.candles,
          '15m': c15m.candles,
          '5m': c5m.candles,
        }, btcContext);
      } catch (err) {
        sentimentResult = {
          state: SENTIMENT_STATE.CHECK_FAILED,
          reasons: [`Candle query failed: ${err.message}`],
          indicators: {},
        };
      }

      let actionTaken = 'NONE';
      const isAuto = pos.mode === 'AUTO';
      const prevState = this.positionSentiments.get(pos.id)?.state;

      if (isAuto) {
        // Automated response rules
        if (sentimentResult.state === SENTIMENT_STATE.REVERSED) {
          // Market exit
          this.paperEngine.closePosition(pos.id, pos.currentPrice, 'SENTIMENT_REVERSED');
          actionTaken = 'AUTO_MARKET_EXIT';
        } else if (sentimentResult.state === SENTIMENT_STATE.WEAKENING) {
          // Tighten stop to breakeven if in profit
          const inProfit = pos.side === 'LONG' ? pos.currentPrice > pos.entryPrice : pos.currentPrice < pos.entryPrice;
          if (inProfit && !pos.isBreakevenMoved) {
            const roundTripCost = (0.0005 * 2) + (0.0002 * 2);
            pos.stopLoss = pos.side === 'LONG'
              ? Number((pos.entryPrice * (1 + roundTripCost)).toFixed(4))
              : Number((pos.entryPrice * (1 - roundTripCost)).toFixed(4));
            pos.isBreakevenMoved = true;
            actionTaken = 'AUTO_STOP_TIGHTENED_BREAKEVEN';
          }
        }
      } else {
        // Manual position: alert only via SSE
        if (prevState && prevState !== sentimentResult.state) {
          this.sseBroadcast({
            type: 'SENTIMENT_CHANGE_ALERT',
            positionId: pos.id,
            symbol: pos.symbol,
            side: pos.side,
            previousState: prevState,
            currentState: sentimentResult.state,
            reasons: sentimentResult.reasons,
          });
        }
      }

      // Persist sentiment record to SQLite
      try {
        const stmt = this.db.db.prepare(`
          INSERT INTO position_sentiment_history (
            id, position_id, timestamp, symbol, side, sentiment_state, reasons_json, indicators_json, action_taken
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `);
        stmt.run(
          `sent-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          pos.id,
          this.lastCheckAt,
          pos.symbol,
          pos.side,
          sentimentResult.state,
          JSON.stringify(sentimentResult.reasons),
          JSON.stringify(sentimentResult.indicators),
          actionTaken
        );
      } catch {}

      this.positionSentiments.set(pos.id, {
        ...sentimentResult,
        timestamp: this.lastCheckAt,
        actionTaken,
      });

      results.push({
        positionId: pos.id,
        symbol: pos.symbol,
        side: pos.side,
        mode: pos.mode || 'MANUAL',
        state: sentimentResult.state,
        reasons: sentimentResult.reasons,
        actionTaken,
      });
    }

    return {
      timestamp: this.lastCheckAt,
      checkedCount: openPositions.length,
      results,
      nextCheckAt: this.nextCheckAt,
    };
  }

  getStatus() {
    return {
      lastCheckAt: this.lastCheckAt,
      nextCheckAt: this.nextCheckAt,
      intervalMinutes: Math.round(this.intervalMs / 60000),
      activePositionsCount: this.paperEngine?.positions?.length || 0,
      activeSentiments: Object.fromEntries(this.positionSentiments),
    };
  }

  /**
   * Exports serializable sentiment state.
   * @returns {Object}
   */
  exportState() {
    return {
      lastCheckAt: this.lastCheckAt,
      nextCheckAt: this.nextCheckAt,
      positionSentiments: Array.from(this.positionSentiments.entries()),
    };
  }

  /**
   * Hydrates sentiment monitor from external state.
   * @param {Object} state
   */
  importState(state = {}) {
    if (!state || typeof state !== 'object') return;
    if (state.lastCheckAt !== undefined) this.lastCheckAt = state.lastCheckAt;
    if (state.nextCheckAt !== undefined) this.nextCheckAt = state.nextCheckAt;
    if (Array.isArray(state.positionSentiments)) {
      this.positionSentiments = new Map(state.positionSentiments);
    }
  }
}
