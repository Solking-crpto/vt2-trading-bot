import test from 'node:test';
import assert from 'node:assert/strict';
import { PaperExecutionEngine, EXIT_REASON } from '../src/execution/paper-engine.js';

test('submits paper order and deducts simulated fee', () => {
  const engine = new PaperExecutionEngine(10000);
  const proposal = {
    symbol: 'BTCUSDT',
    side: 'LONG',
    entryPrice: 60000,
    stopLoss: 59600,
    takeProfit: 61000,
    quantity: 0.1,
  };

  const { order, position } = engine.submitOrder(proposal);

  assert.equal(order.status, 'FILLED');
  assert.equal(position.status, 'OPEN');
  assert.equal(engine.positions.length, 1);
  assert.ok(engine.totalFeesPaid > 0);
  assert.ok(engine.currentEquity < 10000); // reduced by entry fee
});

test('triggers stop loss on downward tick for long position', () => {
  const engine = new PaperExecutionEngine(10000);
  engine.submitOrder({
    symbol: 'BTCUSDT',
    side: 'LONG',
    entryPrice: 60000,
    stopLoss: 59600,
    takeProfit: 61000,
    quantity: 0.1,
  });

  const events = engine.updateMarketTick({
    symbol: 'BTCUSDT',
    price: 59590, // breaches stop loss
    timestamp: Date.now(),
  });

  assert.equal(events.length, 1);
  assert.equal(events[0].type, 'POSITION_CLOSED');
  assert.equal(events[0].reason, EXIT_REASON.STOP_LOSS);
  assert.equal(engine.positions.length, 0);
  assert.equal(engine.consecutiveLosses, 1);
  assert.ok(events[0].pnl < 0);
});

test('triggers final take profit on upward tick for long position', () => {
  const engine = new PaperExecutionEngine(10000);
  engine.submitOrder({
    symbol: 'BTCUSDT',
    side: 'LONG',
    entryPrice: 60000,
    stopLoss: 59600,
    takeProfit: 61000,
    quantity: 0.1,
  });

  const events = engine.updateMarketTick({
    symbol: 'BTCUSDT',
    price: 61050, // breaches take profit
    timestamp: Date.now(),
  });

  assert.equal(events.length, 1);
  assert.equal(events[0].type, 'POSITION_CLOSED');
  assert.equal(events[0].reason, EXIT_REASON.TAKE_PROFIT_FINAL);
  assert.equal(engine.positions.length, 0);
  assert.equal(engine.consecutiveLosses, 0);
  assert.ok(events[0].pnl > 0);
});

test('executes partial take-profit at +1.1% ROI and moves stop to breakeven', () => {
  const engine = new PaperExecutionEngine(10000);
  const { position } = engine.submitOrder({
    symbol: 'BTCUSDT',
    side: 'LONG',
    entryPrice: 60000,
    stopLoss: 59600,
    takeProfit: 62000,
    quantity: 0.1,
  });

  const partialPrice = position.partialTakeProfitPrice;

  const events = engine.updateMarketTick({
    symbol: 'BTCUSDT',
    price: partialPrice + 10,
    timestamp: Date.now(),
  });

  assert.equal(events.length, 1);
  assert.equal(events[0].type, 'PARTIAL_TAKE_PROFIT_EXECUTED');
  assert.equal(position.isPartialClosed, true);
  assert.equal(position.isBreakevenMoved, true);
  assert.ok(position.stopLoss > position.entryPrice); // breakeven + round-trip costs
  assert.equal(position.currentQuantity, 0.05); // 50% remains
});

test('activates trailing stop following 5m EMA20 after 10% ROI', () => {
  const engine = new PaperExecutionEngine(10000);
  const { position } = engine.submitOrder({
    symbol: 'BTCUSDT',
    side: 'LONG',
    entryPrice: 50000,
    stopLoss: 49500,
    takeProfit: 60000,
    quantity: 0.1,
  });

  // Current price at 56000 = 12% ROI (exceeds 10% threshold)
  const events = engine.updateMarketTick({
    symbol: 'BTCUSDT',
    price: 56000,
    ema20_5m: 55800,
    atr_5m: 200,
    timestamp: Date.now(),
  });

  assert.equal(position.isTrailingActive, true);
  assert.ok(position.trailingStop !== null);
  // trailingStop = 55800 - (0.5 * 200) = 55700
  assert.equal(position.trailingStop, 55700);
});

test('executes early exit when RSI reverses', () => {
  const engine = new PaperExecutionEngine(10000);
  engine.submitOrder({
    symbol: 'BTCUSDT',
    side: 'LONG',
    entryPrice: 60000,
    stopLoss: 59600,
    takeProfit: 62000,
    quantity: 0.1,
  });

  // Long position with slight profit (ROI > 0.005) but 15m RSI crashes below 45
  const events = engine.updateMarketTick({
    symbol: 'BTCUSDT',
    price: 60400,
    rsi_15m: 42, // < 45 condition
    timestamp: Date.now(),
  });

  assert.equal(events.length, 1);
  assert.equal(events[0].type, 'POSITION_CLOSED');
  assert.equal(events[0].reason, EXIT_REASON.EARLY_EXIT_RSI);
});
