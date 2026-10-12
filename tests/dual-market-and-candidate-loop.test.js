import test from 'node:test';
import assert from 'node:assert/strict';
import { VT2Server } from '../src/vt2-server.js';
import { AutoTrader, BOT_STATUS } from '../src/execution/auto-trader.js';
import { Database } from '../src/storage/db.js';
import { PaperExecutionEngine } from '../src/execution/paper-engine.js';
import { StrategyEngine } from '../src/strategy/engine.js';
import { MultiAgentCoordinator } from '../src/agents/index.js';
import {
  isEquityContract,
  isCryptoContract,
  classifyInstrument,
  ALL_EQUITY_SYMBOLS,
} from '../src/config/contracts.js';

test('contracts.js dynamically classifies Bitget tokenized US equities with isRwa YES', () => {
  assert.ok(ALL_EQUITY_SYMBOLS.length > 0, 'Expected non-empty equity symbols universe');
  assert.ok(ALL_EQUITY_SYMBOLS.includes('SPYUSDT'));
  assert.ok(ALL_EQUITY_SYMBOLS.includes('NVDAUSDT'));
  assert.ok(ALL_EQUITY_SYMBOLS.includes('TSLAUSDT'));
  assert.ok(ALL_EQUITY_SYMBOLS.includes('MSTRUSDT'));

  // Test classification functions with static and live contracts
  assert.equal(isEquityContract('NVDAUSDT'), true);
  assert.equal(isCryptoContract('NVDAUSDT'), false);
  assert.equal(classifyInstrument('NVDAUSDT'), 'EQUITY');

  // Test dynamic classification with live isRwa flag
  const dynamicRwaContract = { symbol: 'NEWSTOCKUSDT', isRwa: 'YES', minTradeNum: '0.01' };
  assert.equal(classifyInstrument('NEWSTOCKUSDT', dynamicRwaContract), 'EQUITY');
  assert.equal(isEquityContract('NEWSTOCKUSDT', dynamicRwaContract), true);

  assert.equal(isEquityContract('BTCUSDT'), false);
  assert.equal(isCryptoContract('BTCUSDT'), true);
  assert.equal(classifyInstrument('BTCUSDT'), 'CRYPTO');
});

test('StrategyEngine uses SPYUSDT stock benchmark for equities without crypto references', () => {
  const strategy = new StrategyEngine();
  const markets = {
    SPYUSDT: {
      symbol: 'SPYUSDT',
      '4h': Array.from({ length: 60 }, (_, i) => ({
        timestamp: Date.now() - (60 - i) * 240 * 60 * 1000,
        open: 580, high: 585, low: 579, close: 582, volume: 10000, isClosed: true,
      })),
    },
    NVDAUSDT: {
      symbol: 'NVDAUSDT',
      '4h': Array.from({ length: 60 }, (_, i) => ({
        timestamp: Date.now() - (60 - i) * 240 * 60 * 1000,
        open: 120, high: 125, low: 119, close: 124, volume: 20000, isClosed: true,
      })),
      '15m': Array.from({ length: 80 }, (_, i) => ({
        timestamp: Date.now() - (80 - i) * 15 * 60 * 1000,
        open: 122, high: 124.5, low: 121.5, close: 124, volume: 5000, isClosed: true,
      })),
      '5m': Array.from({ length: 100 }, (_, i) => ({
        timestamp: Date.now() - (100 - i) * 5 * 60 * 1000,
        open: 123.5, high: 124.2, low: 123.3, close: 124, volume: 2000, isClosed: true,
      })),
    },
  };

  const scan = strategy.scanUniverse(markets);
  assert.ok(scan.stockContext);
  assert.equal(scan.stockContext.benchmark, 'SPY');

  // Verify that any thesis or reason for NVDA does NOT contain Bitcoin/crypto terms
  const nvdaResult = [...scan.qualified, ...scan.rejected].find(r => r.symbol === 'NVDAUSDT');
  if (nvdaResult) {
    const allReasons = (nvdaResult.reasons || [nvdaResult.explanation || '']).join(' ');
    assert.equal(/bitcoin|btc|altcoin/i.test(allReasons), false, 'Equities must not cite Bitcoin or altcoins');
  }
});

test('AutoTrader halts immediately on account-level cooldown without iterating candidates', async () => {
  const db = new Database(':memory:').init();
  const paper = new PaperExecutionEngine(10000);
  const strategy = new StrategyEngine();
  const coordinator = new MultiAgentCoordinator();

  let scanCount = 0;
  const mockBitget = {
    getLiveUniverseCandles: async () => {
      scanCount++;
      return {};
    },
  };

  const bot = new AutoTrader({
    db,
    paperEngine: paper,
    bitget: mockBitget,
    strategy,
    coordinator,
  });

  // Simulate Kill Switch or position closure 5 minutes ago (30-minute cooldown active)
  const fiveMinutesAgo = Date.now() - (5 * 60 * 1000);
  paper.lastTradeClosedAt = fiveMinutesAgo;

  bot.start({ maxTradesPerDay: 5, maxConcurrentPositions: 1 });
  await bot.runCycle();

  // Bot MUST be in WAITING state, not iterating candidates
  assert.equal(bot.status, BOT_STATUS.WAITING);
  assert.ok(bot.waitingReason.includes('Cooldown active'));
  assert.ok(bot.waitingResumesAt > Date.now());
  assert.equal(scanCount, 0, 'Must NOT scan universe when account gate is blocked');

  // Run cycle again: consecutive logs should be deduplicated
  await bot.runCycle();
  const logs = bot.activityLog.filter(l => l.action === 'BOT_WAITING');
  assert.equal(logs.length, 1, 'Consecutive identical waiting states must be deduplicated in log');

  bot.stop();
});

test('AutoTrader candidate loop walks past failing symbol rules to find passing candidate', async () => {
  const db = new Database(':memory:').init();
  const paper = new PaperExecutionEngine(10000);
  const strategy = new StrategyEngine();
  const coordinator = new MultiAgentCoordinator();

  // Create 3 candidates:
  // Candidate 1: NVDAUSDT -> fails deliberation or risk
  // Candidate 2: TSLAUSDT -> fails deliberation or risk
  // Candidate 3: AAPLUSDT -> passes and opens
  const mockBitget = {
    checkHealth: async () => ({ isLive: true }),
    forceFixtureMode: true,
    getLiveUniverseCandles: async () => ({
      NVDAUSDT: { symbol: 'NVDAUSDT' },
      TSLAUSDT: { symbol: 'TSLAUSDT' },
      AAPLUSDT: { symbol: 'AAPLUSDT' },
    }),
  };

  const bot = new AutoTrader({
    db,
    paperEngine: paper,
    bitget: mockBitget,
    strategy,
    coordinator,
  });

  // Mock strategy scan returning 3 qualified setups
  strategy.scanUniverse = () => ({
    qualified: [
      { symbol: 'NVDAUSDT', side: 'LONG', score: 85, entryPrice: 120, stopLoss: 119.2, takeProfit: 123, rewardRisk: { netRR: 2.1 } },
      { symbol: 'TSLAUSDT', side: 'LONG', score: 80, entryPrice: 240, stopLoss: 238.4, takeProfit: 246, rewardRisk: { netRR: 2.0 } },
      { symbol: 'AAPLUSDT', side: 'LONG', score: 75, entryPrice: 220, stopLoss: 218.5, takeProfit: 225, rewardRisk: { netRR: 2.2 } },
    ],
    rejected: [],
    stockContext: { trend: 'BULLISH', benchmark: 'SPY' },
  });

  // Mock coordinator: reject NVDA and TSLA, approve AAPL
  coordinator.deliberate = async ({ proposal }) => {
    if (proposal.symbol === 'NVDAUSDT') {
      return { isApproved: false, coordinatorVerdict: 'VETOED_BY_RISK_ENGINE', coordinatorReason: 'STOP_TOO_CLOSE' };
    }
    if (proposal.symbol === 'TSLAUSDT') {
      return { isApproved: false, coordinatorVerdict: 'VETOED_BY_RISK_ENGINE', coordinatorReason: 'LEVERAGE_NOTIONAL_CAP_EXCEEDED' };
    }
    return {
      isApproved: true,
      coordinatorVerdict: 'APPROVED_FOR_PAPER_EXECUTION',
      coordinatorReason: 'Passed all deterministic checks',
      riskResult: { quantity: 1, estimatedNotional: 220, allowed: true },
      contract: { baseCoin: 'AAPL' },
    };
  };

  bot.start({ botMarketMode: 'stocks', maxTradesPerDay: 5, maxConcurrentPositions: 1 });
  await bot.runCycle();

  // Candidate walk should have evaluated NVDA (skipped), TSLA (skipped), and FILLED AAPL!
  assert.equal(paper.positions.length, 1);
  assert.equal(paper.positions[0].symbol, 'AAPLUSDT');
  assert.ok(bot.isSymbolSkipped('NVDAUSDT'));
  assert.ok(bot.isSymbolSkipped('TSLAUSDT'));
  assert.equal(bot.tradesToday, 1);

  bot.stop();
});

test('MultiAgentCoordinator detects account cooldown and returns accountGateBlocked', async () => {
  const coordinator = new MultiAgentCoordinator();
  const proposal = {
    symbol: 'NVDAUSDT',
    side: 'LONG',
    entryPrice: 120,
    stopLoss: 119.2,
    takeProfit: 123,
    rewardRisk: { netRR: 2.1 },
  };

  const accountState = {
    equity: 10000,
    startOfDayEquity: 10000,
    currentEquity: 10000,
    consecutiveLosses: 0,
    openPositionsCount: 0,
    lastTradeClosedAt: Date.now() - (10 * 60 * 1000), // 10 mins ago -> 20 mins remaining
    existingOrders: [],
  };

  const result = await coordinator.deliberate({
    proposal,
    accountState,
    riskConfig: { cooldownMinutes: 30 },
  });

  assert.equal(result.isApproved, false);
  assert.equal(result.accountGateBlocked, true);
  assert.equal(result.accountGateReason, 'COOLDOWN_ACTIVE');
  assert.ok(result.cooldownResumesAt > Date.now());
  assert.equal(result.cooldownRemainingMinutes, 20);
  assert.ok(result.analysisConfidence > 0);
  assert.ok(result.coordinatorReason.includes('Cooldown active'));
});

test('VT2Server /api/market/scanner strictly enforces zero crypto in stocks mode and zero equities in crypto mode', async () => {
  const server = new VT2Server({
    port: 0,
    dbPath: ':memory:',
    forceFixtureMode: true,
    disableMonitor: true,
  });
  server.start();

  await new Promise(resolve => {
    if (server.server.listening) return resolve();
    server.server.on('listening', resolve);
  });

  const address = server.server.address();
  const baseUrl = `http://localhost:${address.port}`;

  try {
    // 1. In stocks mode: STRICTLY zero crypto symbols
    const stocksRes = await fetch(`${baseUrl}/api/market/scanner?mode=stocks`);
    assert.equal(stocksRes.status, 200);
    const stocksData = await stocksRes.json();
    assert.equal(stocksData.marketMode, 'stocks');
    assert.equal(stocksData.counts.crypto, 0, 'Stocks mode must contain zero crypto');
    for (const q of stocksData.qualified) {
      assert.equal(isCryptoContract(q.symbol), false, `${q.symbol} is crypto in stocks mode!`);
    }

    // 2. In crypto mode: zero equity symbols
    const cryptoRes = await fetch(`${baseUrl}/api/market/scanner?mode=crypto`);
    assert.equal(cryptoRes.status, 200);
    const cryptoData = await cryptoRes.json();
    assert.equal(cryptoData.marketMode, 'crypto');
    assert.equal(cryptoData.counts.equity, 0, 'Crypto mode must contain zero equities');
    for (const q of cryptoData.qualified) {
      assert.equal(isEquityContract(q.symbol), false, `${q.symbol} is equity in crypto mode!`);
    }

    // 3. Equity Universe Table endpoint
    const universeRes = await fetch(`${baseUrl}/api/market/equity-universe`);
    assert.equal(universeRes.status, 200);
    const universeData = await universeRes.json();
    assert.equal(universeData.success, true);
    assert.equal(universeData.totalCount, 24);
    assert.ok(universeData.universe.some(u => u.symbol === 'SPYUSDT'));
    assert.ok(universeData.universe.some(u => u.symbol === 'NVDAUSDT'));
  } finally {
    await server.stop();
  }
});
