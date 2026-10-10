import test from 'node:test';
import assert from 'node:assert/strict';
import { PaperExecutionEngine } from '../src/execution/paper-engine.js';
import { Database } from '../src/storage/db.js';

test('PaperExecutionEngine restores state correctly after simulated server restart', () => {
  // Step 1: Simulate active session with trades and positions
  const db = new Database(':memory:').init();
  const engine1 = new PaperExecutionEngine({ initialEquity: 10000 });

  // Submit order in engine1
  const orderResult = engine1.submitOrder({
    symbol: 'BTCUSDT',
    side: 'LONG',
    entryPrice: 60000,
    stopLoss: 59600,
    takeProfit: 60800,
    quantity: 0.1,
    partialTakeProfitPrice: 60660,
  });

  // Save to database
  db.saveOrder(orderResult.order);
  db.savePosition(orderResult.position);

  // Simulate market price move that creates unrealized PnL
  engine1.updateMarketTick({
    symbol: 'BTCUSDT',
    price: 60300,
    timestamp: Date.now(),
  });

  const summary1 = engine1.getAccountSummary();
  db.saveAccountState(summary1);

  // Verify engine1 state (equity reflects $3 simulated entry fee deduction)
  assert.equal(summary1.openPositionsCount, 1);
  assert.equal(summary1.initialEquity, 10000);
  assert.equal(summary1.currentEquity, 9997);

  // Step 2: "Restart" the server by creating a fresh PaperExecutionEngine instance
  const engine2 = new PaperExecutionEngine(10000);
  const savedState = db.getAccountState();
  const savedPositions = db.getActivePositions();

  engine2.restoreState(savedState, savedPositions);

  const summary2 = engine2.getAccountSummary();

  // Verify engine2 restored the exact state
  assert.equal(summary2.initialEquity, 10000);
  assert.equal(summary2.startOfDayEquity, 10000);
  assert.equal(summary2.currentEquity, 9997);
  assert.equal(summary2.openPositionsCount, 1);
  assert.equal(engine2.positions.length, 1);
  assert.equal(engine2.positions[0].symbol, 'BTCUSDT');
  assert.equal(engine2.positions[0].currentQuantity, 0.1);
  assert.equal(engine2.positions[0].stopLoss, 59600);
  assert.equal(engine2.positions[0].takeProfit, 60800);

  db.close();
});

test('PaperExecutionEngine preserves daily loss lock status across restarts', () => {
  const db = new Database(':memory:').init();

  // Simulate state where daily loss limit was reached ($250 loss on $10,000 SOD equity >= 2.0% limit of $200)
  const lockedState = {
    initialEquity: 10000,
    startOfDayEquity: 10000,
    currentEquity: 9750,
    realizedPnl: -250,
    totalFeesPaid: 15,
    consecutiveLosses: 2,
    lastTradeClosedAt: Date.now() - 5000,
  };

  db.saveAccountState(lockedState);

  // New engine on restart
  const restartedEngine = new PaperExecutionEngine({ initialEquity: 10000 });
  restartedEngine.restoreState(db.getAccountState(), []);

  const summary = restartedEngine.getAccountSummary();
  assert.equal(summary.equity, 9750);
  assert.equal(summary.dailyLoss, 250);
  assert.equal(summary.isDailyLossLocked, true);
  assert.equal(summary.consecutiveLosses, 2);

  db.close();
});
