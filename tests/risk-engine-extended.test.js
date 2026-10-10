import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluatePaperTrade, DEFAULT_RISK_CONFIG } from '../src/risk-engine.js';

const validBaseTrade = {
  symbol: 'BTCUSDT',
  side: 'LONG',
  entryPrice: 60000,
  stopLoss: 59600, // 400 distance = 0.667% (within 0.5% - 0.8%)
  takeProfit: 61000, // 1000 reward = 2.5:1 gross R:R
  equity: 10000,
  startOfDayEquity: 10000,
  currentEquity: 10000,
};

test('evaluates valid BTCUSDT paper trade with full parameters', () => {
  const result = evaluatePaperTrade(validBaseTrade);
  assert.equal(result.allowed, true);
  assert.equal(result.riskAmount, 50); // 0.5% of 10000
  assert.equal(result.riskPerUnit, 400);
  assert.equal(result.quantity, 0.125); // 50 / 400 = 0.125 BTC
  assert.equal(result.estimatedNotional, 7500);
  assert.ok(result.rewardRisk.netRR >= 1.5);
});

test('rejects consecutive loss limit reached', () => {
  const result = evaluatePaperTrade({
    ...validBaseTrade,
    consecutiveLosses: 3,
  });
  assert.equal(result.allowed, false);
  assert.equal(result.reason, 'CONSECUTIVE_LOSS_PAUSE');
});

test('rejects trade when maximum open positions is reached', () => {
  const result = evaluatePaperTrade({
    ...validBaseTrade,
    openPositionsCount: 1,
  });
  assert.equal(result.allowed, false);
  assert.equal(result.reason, 'MAX_OPEN_POSITIONS_EXCEEDED');
});

test('rejects trade when cooldown period is still active', () => {
  const now = 1700000000000;
  const recentClose = now - (15 * 60 * 1000); // 15 mins ago (cooldown is 30 mins)
  const result = evaluatePaperTrade({
    ...validBaseTrade,
    timestamp: now,
    lastTradeClosedAt: recentClose,
  });
  assert.equal(result.allowed, false);
  assert.equal(result.reason, 'COOLDOWN_ACTIVE');
  assert.ok(result.remainingSeconds > 0);
});

test('allows trade after cooldown period has elapsed', () => {
  const now = 1700000000000;
  const oldClose = now - (35 * 60 * 1000); // 35 mins ago
  const result = evaluatePaperTrade({
    ...validBaseTrade,
    timestamp: now,
    currentTime: now,
    lastTradeClosedAt: oldClose,
  });
  assert.equal(result.allowed, true);
});

test('rejects expired signal older than 10 minutes', () => {
  const now = Date.now();
  const oldSignalTime = now - (12 * 60 * 1000); // 12 mins ago
  const result = evaluatePaperTrade({
    ...validBaseTrade,
    timestamp: oldSignalTime,
  });
  assert.equal(result.allowed, false);
  assert.equal(result.reason, 'SIGNAL_EXPIRED');
});

test('rejects duplicate pending or open order on same symbol', () => {
  const result = evaluatePaperTrade({
    ...validBaseTrade,
    existingOrders: [
      { id: 'ord-123', symbol: 'BTCUSDT', side: 'LONG', status: 'OPEN' },
    ],
  });
  assert.equal(result.allowed, false);
  assert.equal(result.reason, 'DUPLICATE_ORDER_DETECTED');
});

test('rejects ineligible contract symbol', () => {
  const result = evaluatePaperTrade({
    ...validBaseTrade,
    symbol: 'SHIB_UNKNOWN_PERP',
  });
  assert.equal(result.allowed, false);
  assert.equal(result.reason, 'INELIGIBLE_INSTRUMENT');
});

test('rejects trade with net reward-to-risk below 1.5', () => {
  // Take profit too close: reward 200, risk 400 -> gross R:R 0.5 < 1.5
  const result = evaluatePaperTrade({
    ...validBaseTrade,
    takeProfit: 60200,
  });
  assert.equal(result.allowed, false);
  assert.equal(result.reason, 'INSUFFICIENT_NET_REWARD_RISK');
});

test('enforces research stop constraints when active', () => {
  // Stop too close (< 0.5% distance): entry 60000, stop 59900 (0.16% distance)
  const tooClose = evaluatePaperTrade({
    ...validBaseTrade,
    stopLoss: 59900,
    enforceResearchConstraints: true,
  });
  assert.equal(tooClose.allowed, false);
  assert.equal(tooClose.reason, 'STOP_TOO_CLOSE');

  // Stop too far (> 0.8% distance): entry 60000, stop 59000 (1.66% distance)
  const tooFar = evaluatePaperTrade({
    ...validBaseTrade,
    stopLoss: 59000,
    enforceResearchConstraints: true,
  });
  assert.equal(tooFar.allowed, false);
  assert.equal(tooFar.reason, 'STOP_TOO_FAR');
});

test('rounds quantity to contract step size (e.g. SOLUSDT step 0.1)', () => {
  const solTrade = {
    symbol: 'SOLUSDT',
    side: 'LONG',
    entryPrice: 150,
    stopLoss: 149, // risk per unit = 1
    takeProfit: 153, // reward = 3
    equity: 10000,
    startOfDayEquity: 10000,
    currentEquity: 10000,
  };
  const result = evaluatePaperTrade(solTrade);
  assert.equal(result.allowed, true);
  // riskAmount = 50, riskPerUnit = 1 -> rawQty = 50. Step size is 0.1 -> 50.0
  assert.equal(result.quantity, 50);
});
