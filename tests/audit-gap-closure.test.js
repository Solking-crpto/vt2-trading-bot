import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluatePaperTrade } from '../src/risk-engine.js';
import { StockMarketProvider } from '../src/adapters/market-provider.js';
import { CORRELATION_GROUPS, getCorrelationGroup, getLeveragedProductInfo } from '../src/config/contracts.js';
import { VT2Server } from '../src/vt2-server.js';

test('risk engine rejects opposite exposure inside correlation group (Long TQQQ + Long SQQQ)', () => {
  const existingPositions = [
    {
      id: 'pos-1',
      symbol: 'TQQQUSDT',
      side: 'LONG', // Bullish Nasdaq (3x leveraged)
      entryPrice: 80.0,
      currentQuantity: 10,
      stopLoss: 78.0,
      status: 'OPEN',
    },
  ];

  // Proposed trade: Long SQQQ (Bearish Nasdaq - 3x inverse)
  const result = evaluatePaperTrade({
    symbol: 'SQQQUSDT',
    side: 'LONG',
    entryPrice: 20.0,
    stopLoss: 19.5,
    takeProfit: 21.5,
    equity: 10000,
    startOfDayEquity: 10000,
    currentEquity: 10000,
    existingPositions,
  }, { maxConcurrentPositions: 2 });

  assert.equal(result.allowed, false);
  assert.equal(result.reason, 'CORRELATED_OPPOSITE_EXPOSURE');
  assert.equal(result.correlationGroup, 'NASDAQ_100');
});

test('risk engine allows same-direction exposure within correlation group', () => {
  const existingPositions = [
    {
      id: 'pos-1',
      symbol: 'TQQQUSDT',
      side: 'LONG', // Bullish Nasdaq (3x leveraged)
      entryPrice: 80.0,
      currentQuantity: 1,
      stopLoss: 79.5, // 0.5 risk
      status: 'OPEN',
    },
  ];

  // Proposed trade: Short SQQQ (Bullish Nasdaq - selling inverse)
  const result = evaluatePaperTrade({
    symbol: 'SQQQUSDT',
    side: 'SHORT', // Bullish Nasdaq
    entryPrice: 20.0,
    stopLoss: 20.14,
    takeProfit: 19.5,
    equity: 10000,
    startOfDayEquity: 10000,
    currentEquity: 10000,
    existingPositions,
  }, {
    maxConcurrentPositions: 2,
    maxAggregateOpenRiskPercent: 0.02,
  });

  assert.equal(result.allowed, true);
  assert.equal(result.reason, 'RISK_CHECKS_PASSED');
});

test('StockMarketProvider uses contract step rules for fractional orders without whole-share truncation', () => {
  const provider = new StockMarketProvider();

  // SPYUSDT has stepSize 0.01 on Bitget
  assert.equal(provider.formatQuantity(12.3456, 'SPYUSDT'), 12.34);
  assert.equal(provider.formatQuantity(0.015, 'SPYUSDT'), 0.01);

  // NVDAUSDT has stepSize 0.01 on Bitget
  assert.equal(provider.formatQuantity(0.854, 'NVDAUSDT'), 0.85);

  // Leveraged/inverse metadata labels
  const tqqqInfo = getLeveragedProductInfo('TQQQUSDT');
  assert.equal(tqqqInfo.isLeveragedOrInverse, true);
  assert.equal(tqqqInfo.label, '3x Leveraged Long');

  const sqqqInfo = getLeveragedProductInfo('SQQQUSDT');
  assert.equal(sqqqInfo.isLeveragedOrInverse, true);
  assert.equal(sqqqInfo.label, '3x Inverse Short');

  const spyInfo = getLeveragedProductInfo('SPYUSDT');
  assert.equal(spyInfo.isLeveragedOrInverse, false);
});

test('risk engine enforces equityEntriesWhenUnderlyingClosed policy', () => {
  const baseTrade = {
    symbol: 'SPYUSDT',
    side: 'LONG',
    entryPrice: 580.0,
    stopLoss: 576.0,
    takeProfit: 590.0,
    equity: 10000,
    startOfDayEquity: 10000,
    currentEquity: 10000,
    underlyingMarketClosed: true,
  };

  // 1. Policy BLOCK
  const blockedResult = evaluatePaperTrade(baseTrade, {
    equityEntriesWhenUnderlyingClosed: 'BLOCK',
  });
  assert.equal(blockedResult.allowed, false);
  assert.equal(blockedResult.reason, 'UNDERLYING_MARKET_CLOSED');

  // 2. Policy ALLOW_WITH_WARNING (default)
  const allowedResult = evaluatePaperTrade(baseTrade, {
    equityEntriesWhenUnderlyingClosed: 'ALLOW_WITH_WARNING',
  });
  assert.equal(allowedResult.allowed, true);
  assert.ok(allowedResult.warnings.some(w => w.includes('Underlying US market is closed')));
});

test('server strictly enforces environment allow-list rejecting all live/mainnet variants with 403', async () => {
  const server = new VT2Server({ port: 0, forceFixtureMode: true });
  await server.start();
  const address = server.server.address();
  const baseUrl = `http://127.0.0.1:${address.port}`;

  try {
    const testCases = [
      { body: { environment: 'MAINNET' }, desc: 'explicit MAINNET' },
      { body: { targetEnvironment: 'MAINNET' }, desc: 'targetEnvironment MAINNET' },
      { body: { env: 'mainnet' }, desc: 'lowercase mainnet' },
      { body: { mode: 'live' }, desc: 'lowercase live' },
      { body: { target: 'prod' }, desc: 'lowercase prod' },
      { body: { setting: 'real' }, desc: 'lowercase real' },
      { body: { environment: ['MAINNET'] }, desc: 'array environment' },
      { body: { nested: { env: 'mainnet' } }, desc: 'nested mainnet' },
      { body: { environment: '   MaInNeT   ' }, desc: 'whitespace mixed-case mainnet' },
    ];

    for (const tc of testCases) {
      const res = await fetch(`${baseUrl}/api/environment`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(tc.body),
      });
      assert.equal(res.status, 403, `Expected 403 for ${tc.desc}, got ${res.status}`);
      const data = await res.json();
      assert.equal(data.error, 'MAINNET_EXECUTION_BLOCKED');
    }

    // PAPER environment is accepted
    const paperRes = await fetch(`${baseUrl}/api/environment`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ environment: 'PAPER' }),
    });
    assert.equal(paperRes.status, 200);
    const paperData = await paperRes.json();
    assert.equal(paperData.success, true);
    assert.equal(paperData.environment, 'PAPER');

  } finally {
    await server.stop();
  }
});
