import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluatePaperTrade } from '../src/risk-engine.js';

const baseTrade = {
  side: 'LONG',
  entryPrice: 100,
  stopLoss: 98,
  equity: 10000,
  startOfDayEquity: 10000,
  currentEquity: 10000,
};

test('sizes a valid paper trade at 0.5% risk', () => {
  const result = evaluatePaperTrade(baseTrade);

  assert.equal(result.allowed, true);
  assert.equal(result.riskAmount, 50);
  assert.equal(result.riskPerUnit, 2);
  assert.equal(result.quantity, 25);
  assert.equal(result.estimatedNotional, 2500);
});

test('rejects a stop loss on the wrong side for a long', () => {
  const result = evaluatePaperTrade({
    ...baseTrade,
    stopLoss: 101,
  });

  assert.equal(result.allowed, false);
  assert.equal(result.reason, 'INVALID_STOP_LOSS');
});

test('rejects a stop loss on the wrong side for a short', () => {
  const result = evaluatePaperTrade({
    ...baseTrade,
    side: 'SHORT',
    stopLoss: 98,
  });

  assert.equal(result.allowed, false);
  assert.equal(result.reason, 'INVALID_STOP_LOSS');
});

test('rejects a trade when daily loss reaches 2%', () => {
  const result = evaluatePaperTrade({
    ...baseTrade,
    currentEquity: 9800,
  });

  assert.equal(result.allowed, false);
  assert.equal(result.reason, 'DAILY_LOSS_LIMIT_REACHED');
});

test('rejects invalid equity', () => {
  const result = evaluatePaperTrade({
    ...baseTrade,
    equity: -100,
  });

  assert.equal(result.allowed, false);
  assert.equal(result.reason, 'INVALID_INPUT');
});

test('rejects an unknown trade direction', () => {
  const result = evaluatePaperTrade({
    ...baseTrade,
    side: 'BUY',
  });

  assert.equal(result.allowed, false);
  assert.equal(result.reason, 'INVALID_SIDE');
});
