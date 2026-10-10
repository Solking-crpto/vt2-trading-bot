import test from 'node:test';
import assert from 'node:assert/strict';
import { Database } from '../src/storage/db.js';

test('in-memory database initializes schema cleanly', () => {
  const db = new Database(':memory:').init();
  assert.ok(db.db !== null);
  db.close();
});

test('persists and retrieves user settings', () => {
  const db = new Database(':memory:').init();
  db.saveSetting('riskPerTrade', 0.005);
  db.saveSetting('executionMode', 'PAPER');

  assert.equal(db.getSetting('riskPerTrade'), 0.005);
  assert.equal(db.getSetting('executionMode'), 'PAPER');
  assert.equal(db.getSetting('nonExistentKey', 'defaultVal'), 'defaultVal');
  db.close();
});

test('persists, updates, and fetches active positions', () => {
  const db = new Database(':memory:').init();
  const pos = {
    id: 'pos-test-1',
    orderId: 'ord-test-1',
    environment: 'PAPER',
    symbol: 'BTCUSDT',
    side: 'LONG',
    entryPrice: 60000,
    currentPrice: 60000,
    originalQuantity: 0.1,
    currentQuantity: 0.1,
    stopLoss: 59600,
    takeProfit: 61000,
    partialTakeProfitPrice: 60660,
    isPartialClosed: false,
    isBreakevenMoved: false,
    isTrailingActive: false,
    trailingStop: null,
    unrealizedPnl: 0,
    realizedPnl: 0,
    feesPaid: 3.0,
    status: 'OPEN',
    openedAt: Date.now(),
    lastUpdatedAt: Date.now(),
  };

  db.savePosition(pos);
  let active = db.getActivePositions();
  assert.equal(active.length, 1);
  assert.equal(active[0].id, 'pos-test-1');
  assert.equal(active[0].status, 'OPEN');

  // Update position
  pos.currentPrice = 60500;
  pos.unrealizedPnl = 50;
  db.savePosition(pos);

  active = db.getActivePositions();
  assert.equal(active[0].current_price, 60500);
  assert.equal(active[0].unrealized_pnl, 50);

  db.close();
});

test('saves and retrieves trade journal entries with parsed JSON structures', () => {
  const db = new Database(':memory:').init();
  const entry = {
    id: 'jrn-test-1',
    positionId: 'pos-test-1',
    timestamp: Date.now(),
    environment: 'PAPER',
    symbol: 'BTCUSDT',
    side: 'LONG',
    strategyVersion: 'v1.0.0',
    entryPrice: 60000,
    exitPrice: 61000,
    quantity: 0.1,
    realizedPnl: 94.0,
    roiPercent: 1.57,
    holdingTimeMs: 1800000,
    feesPaid: 6.0,
    exitReason: 'TAKE_PROFIT_FINAL',
    thesis: { primaryHypothesis: 'Long breakout' },
    review: { verdict: 'CHALLENGE_SURVIVED' },
    riskResult: { allowed: true },
  };

  db.saveJournalEntry(entry);
  const journal = db.getJournalEntries();
  assert.equal(journal.length, 1);
  assert.equal(journal[0].id, 'jrn-test-1');
  assert.equal(journal[0].realized_pnl, 94.0);
  assert.equal(journal[0].thesis.primaryHypothesis, 'Long breakout');
  assert.equal(journal[0].review.verdict, 'CHALLENGE_SURVIVED');

  db.close();
});

test('saves and retrieves rejected setups archive', () => {
  const db = new Database(':memory:').init();
  db.saveRejectedSetup({
    id: 'rej-test-1',
    symbol: 'SOLUSDT',
    rejectionReason: 'INSUFFICIENT_NET_RR',
    explanation: 'Net R:R is 1.2, minimum required is 1.5',
    netRR: 1.2,
    score: 45.0,
  });

  const rejected = db.getRejectedSetups();
  assert.equal(rejected.length, 1);
  assert.equal(rejected[0].symbol, 'SOLUSDT');
  assert.equal(rejected[0].rejection_reason, 'INSUFFICIENT_NET_RR');

  db.close();
});
