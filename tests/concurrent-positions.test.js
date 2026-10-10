import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluatePaperTrade } from '../src/risk-engine.js';

const baseEquity = 10000;

test('rejects N+1 position beyond maxConcurrentPositions cap', () => {
  const existingPositions = [
    {
      id: 'pos-1',
      symbol: 'BTCUSDT',
      side: 'LONG',
      entryPrice: 80000,
      stopLoss: 79600, // 0.5% stop distance
      currentQuantity: 0.05, // $20 risk
      status: 'OPEN',
    },
    {
      id: 'pos-2',
      symbol: 'ETHUSDT',
      side: 'LONG',
      entryPrice: 3000,
      stopLoss: 2985, // 0.5% stop distance
      currentQuantity: 1.0, // $15 risk
      status: 'OPEN',
    },
  ];

  // When maxConcurrentPositions = 2, adding a 3rd position must be rejected
  const result = evaluatePaperTrade({
    symbol: 'SOLUSDT',
    side: 'LONG',
    entryPrice: 150,
    stopLoss: 149,
    takeProfit: 153,
    equity: baseEquity,
    startOfDayEquity: baseEquity,
    currentEquity: baseEquity,
    existingPositions,
  }, {
    maxConcurrentPositions: 2,
    riskPerTrade: 0.005,
  });

  assert.equal(result.allowed, false);
  assert.equal(result.reason, 'MAX_OPEN_POSITIONS_EXCEEDED');
});

test('allows concurrent positions up to maxConcurrentPositions limit', () => {
  const existingPositions = [
    {
      id: 'pos-1',
      symbol: 'BTCUSDT',
      side: 'LONG',
      entryPrice: 80000,
      stopLoss: 79600, // $20 risk
      currentQuantity: 0.05,
      status: 'OPEN',
    },
  ];

  // When maxConcurrentPositions = 2, opening a 2nd position (ETHUSDT) is approved
  const result = evaluatePaperTrade({
    symbol: 'ETHUSDT',
    side: 'LONG',
    entryPrice: 3000,
    stopLoss: 2985, // risk per unit = 15
    takeProfit: 3045, // reward per unit = 45 -> 3:1 R:R
    equity: baseEquity,
    startOfDayEquity: baseEquity,
    currentEquity: baseEquity,
    existingPositions,
  }, {
    maxConcurrentPositions: 2,
    riskPerTrade: 0.005, // 0.5% = $50 risk
    maxAggregateOpenRiskPercent: 0.01, // 1.0% = $100 aggregate cap ($20 + $50 = $70 <= $100)
  });

  assert.equal(result.allowed, true);
  assert.equal(result.reason, 'RISK_CHECKS_PASSED');
  assert.equal(result.maxConcurrentPositions, 2);
});

test('rejects trade when aggregate open risk exceeds aggregate open-risk cap', () => {
  // Existing position consumes $80 of stop-loss risk (0.80% equity)
  const existingPositions = [
    {
      id: 'pos-1',
      symbol: 'BTCUSDT',
      side: 'LONG',
      entryPrice: 80000,
      stopLoss: 78400, // risk per unit = 1600
      currentQuantity: 0.05, // 0.05 * 1600 = $80 risk
      status: 'OPEN',
    },
  ];

  // Proposed trade requests $50 risk (0.50% equity). Total risk would be $80 + $50 = $130 (1.30%), exceeding 1.0% cap ($100)
  const result = evaluatePaperTrade({
    symbol: 'ETHUSDT',
    side: 'LONG',
    entryPrice: 3000,
    stopLoss: 2985,
    takeProfit: 3045,
    equity: baseEquity,
    startOfDayEquity: baseEquity,
    currentEquity: baseEquity,
    existingPositions,
  }, {
    maxConcurrentPositions: 3,
    riskPerTrade: 0.005,
    maxAggregateOpenRiskPercent: 0.01, // 1.0% equity cap ($100)
  });

  assert.equal(result.allowed, false);
  assert.equal(result.reason, 'AGGREGATE_OPEN_RISK_EXCEEDED');
});

test('rejects duplicate position on same symbol', () => {
  const existingPositions = [
    {
      id: 'pos-1',
      symbol: 'BTCUSDT',
      side: 'LONG',
      entryPrice: 80000,
      stopLoss: 79600,
      currentQuantity: 0.05,
      status: 'OPEN',
    },
  ];

  const result = evaluatePaperTrade({
    symbol: 'BTCUSDT',
    side: 'LONG',
    entryPrice: 81000,
    stopLoss: 80500,
    takeProfit: 82500,
    equity: baseEquity,
    startOfDayEquity: baseEquity,
    currentEquity: baseEquity,
    existingPositions,
  }, {
    maxConcurrentPositions: 3,
  });

  assert.equal(result.allowed, false);
  assert.equal(result.reason, 'DUPLICATE_SYMBOL_POSITION');
});
