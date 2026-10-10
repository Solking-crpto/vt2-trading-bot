import test from 'node:test';
import assert from 'node:assert/strict';
import { TradeMonitor, SENTIMENT_STATE } from '../src/monitor/trade-monitor.js';
import { PaperExecutionEngine } from '../src/execution/paper-engine.js';
import { StrategyEngine } from '../src/strategy/engine.js';
import { Database } from '../src/storage/db.js';

function createMockCandles({ p4h, ema20_4h, p15m, ema50_15m, rsi15m }) {
  const c4h = [];
  for (let i = 0; i < 60; i++) {
    c4h.push({
      time: i * 4 * 3600000,
      open: ema20_4h,
      high: Math.max(p4h, ema20_4h) * 1.01,
      low: Math.min(p4h, ema20_4h) * 0.99,
      close: i === 59 ? p4h : ema20_4h,
      volume: 100,
    });
  }

  const c15m = [];
  for (let i = 0; i < 60; i++) {
    c15m.push({
      time: i * 15 * 60000,
      open: ema50_15m,
      high: Math.max(p15m, ema50_15m) * 1.01,
      low: Math.min(p15m, ema50_15m) * 0.99,
      close: i === 59 ? p15m : ema50_15m,
      volume: 100,
    });
  }

  return { '4h': c4h, '15m': c15m };
}

test('TradeMonitor evaluates sentiment correctly as SUPPORTIVE, WEAKENING, and REVERSED', () => {
  const db = new Database(':memory:').init();
  const paper = new PaperExecutionEngine(10000);
  const monitor = new TradeMonitor({ db, paperEngine: paper, bitget: {}, strategy: new StrategyEngine() });

  const longPos = { id: 'p1', symbol: 'BTCUSDT', side: 'LONG', entryPrice: 60000, stopLoss: 59600, currentPrice: 60500 };

  // Case 1: Supportive - 4h price > EMA20, 15m price > EMA50
  const supportiveCandles = createMockCandles({ p4h: 62000, ema20_4h: 60000, p15m: 60800, ema50_15m: 60200, rsi15m: 58 });
  const evalSupportive = monitor.evaluateSentiment(longPos, supportiveCandles);
  assert.equal(evalSupportive.state, SENTIMENT_STATE.SUPPORTIVE);

  // Case 2: Weakening - 15m price breaks below EMA50 while 4h is still above EMA20
  const weakeningCandles = createMockCandles({ p4h: 62000, ema20_4h: 60000, p15m: 59800, ema50_15m: 60200, rsi15m: 44 });
  const evalWeakening = monitor.evaluateSentiment(longPos, weakeningCandles);
  assert.equal(evalWeakening.state, SENTIMENT_STATE.WEAKENING);

  // Case 3: Reversed - Both 4h and 15m prices break below moving averages
  const reversedCandles = createMockCandles({ p4h: 58000, ema20_4h: 60000, p15m: 58500, ema50_15m: 60200, rsi15m: 32 });
  const evalReversed = monitor.evaluateSentiment(longPos, reversedCandles);
  assert.equal(evalReversed.state, SENTIMENT_STATE.REVERSED);
});

test('sentiment state change triggers SSE notification in manual mode and market exit in auto mode', async () => {
  const db = new Database(':memory:').init();
  const paper = new PaperExecutionEngine(10000);

  // 1. Manual position
  const manualPos = {
    id: 'pos-manual-1',
    symbol: 'BTCUSDT',
    side: 'LONG',
    entryPrice: 60000,
    currentPrice: 58000,
    currentQuantity: 0.05,
    stopLoss: 57000,
    takeProfit: 63000,
    status: 'OPEN',
    mode: 'MANUAL',
  };

  // 2. Automated position
  const autoPos = {
    id: 'pos-auto-1',
    symbol: 'ETHUSDT',
    side: 'LONG',
    entryPrice: 3000,
    currentPrice: 2800,
    currentQuantity: 1.0,
    stopLoss: 2700,
    takeProfit: 3300,
    status: 'OPEN',
    mode: 'AUTO',
  };

  paper.positions = [manualPos, autoPos];

  const sseEvents = [];
  const sseBroadcast = (msg) => sseEvents.push(msg);

  // Mock Bitget returning reversed candles for both
  const reversedCandles = createMockCandles({ p4h: 50000, ema20_4h: 60000, p15m: 50000, ema50_15m: 60000, rsi15m: 30 });
  const mockBitget = {
    checkHealth: async () => ({ isLive: true }),
    getCandles: async (sym, tf) => ({ candles: reversedCandles[tf] || reversedCandles['15m'], isLive: true }),
    forceFixtureMode: false,
  };

  const monitor = new TradeMonitor({
    db,
    paperEngine: paper,
    bitget: mockBitget,
    strategy: new StrategyEngine(),
    sseBroadcast,
  });

  // Seed initial previous state as SUPPORTIVE
  monitor.positionSentiments.set('pos-manual-1', { state: SENTIMENT_STATE.SUPPORTIVE });
  monitor.positionSentiments.set('pos-auto-1', { state: SENTIMENT_STATE.SUPPORTIVE });

  // Run check
  const report = await monitor.checkPositions();

  // Assertions:
  // 1. Manual position should trigger SSE alert and remain OPEN (never auto-closed)
  assert.equal(sseEvents.length, 1);
  assert.equal(sseEvents[0].type, 'SENTIMENT_CHANGE_ALERT');
  assert.equal(sseEvents[0].positionId, 'pos-manual-1');
  assert.equal(sseEvents[0].currentState, SENTIMENT_STATE.REVERSED);

  const manualInEngine = paper.positions.find(p => p.id === 'pos-manual-1');
  assert.ok(manualInEngine, 'Manual position must never be closed automatically by monitor');
  assert.equal(manualInEngine.status, 'OPEN');

  // 2. Auto position must be exited at market due to SENTIMENT_REVERSED
  const autoInEngine = paper.positions.find(p => p.id === 'pos-auto-1');
  assert.equal(autoInEngine, undefined, 'Automated position should be removed from active positions on exit');

  const closedTrade = paper.tradeHistory.find(p => p.id === 'pos-auto-1');
  assert.ok(closedTrade, 'Automated position must be recorded in trade history');
  assert.equal(closedTrade.exitReason, 'SENTIMENT_REVERSED');
});

test('feed failure triggers neither notification nor automatic exit', async () => {
  const db = new Database(':memory:').init();
  const paper = new PaperExecutionEngine(10000);
  const autoPos = {
    id: 'pos-auto-2',
    symbol: 'BTCUSDT',
    side: 'LONG',
    entryPrice: 60000,
    currentPrice: 60000,
    currentQuantity: 0.05,
    stopLoss: 59000,
    takeProfit: 63000,
    status: 'OPEN',
    mode: 'AUTO',
  };
  paper.positions = [autoPos];

  const sseEvents = [];
  const offlineBitget = {
    checkHealth: async () => ({ isLive: false, status: 'OFFLINE' }),
    forceFixtureMode: false,
  };

  const monitor = new TradeMonitor({
    db,
    paperEngine: paper,
    bitget: offlineBitget,
    strategy: new StrategyEngine(),
    sseBroadcast: (msg) => sseEvents.push(msg),
  });

  const report = await monitor.checkPositions();

  assert.equal(report.status, 'FEED_OFFLINE');
  assert.equal(sseEvents.length, 0, 'No notification should fire on feed failure');
  assert.equal(paper.positions.length, 1, 'Position must remain open safely during feed outage');
  assert.equal(paper.positions[0].status, 'OPEN');
});
