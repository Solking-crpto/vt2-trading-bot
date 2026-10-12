import test from 'node:test';
import assert from 'node:assert/strict';

import { PaperExecutionEngine } from '../src/execution/paper-engine.js';
import { AutoTrader } from '../src/execution/auto-trader.js';
import { TradeMonitor } from '../src/monitor/trade-monitor.js';
import { VT2Server, validateDemoState } from '../src/vt2-server.js';

test('1. Engine exportState() and importState() round-trips', async () => {
  // 1a. PaperExecutionEngine round-trip
  const paper1 = new PaperExecutionEngine(10000);
  const orderResult = paper1.submitOrder({
    symbol: 'SPYUSDT',
    side: 'LONG',
    entryPrice: 500,
    stopLoss: 495,
    takeProfit: 515,
    quantity: 10,
    timestamp: Date.now() - 5000,
  });
  assert.ok(orderResult.order, 'Order created');
  assert.equal(paper1.positions.length, 1, 'One position open');

  const paperExport = paper1.exportState();
  assert.equal(paperExport.positions.length, 1);
  assert.equal(paperExport.orders.length, 1);

  const paper2 = new PaperExecutionEngine(10000);
  paper2.importState(paperExport);
  assert.equal(paper2.positions.length, 1, 'Imported position count matches');
  assert.equal(paper2.positions[0].symbol, 'SPYUSDT');
  assert.equal(paper2.positions[0].entryPrice, paper1.positions[0].entryPrice);
  assert.equal(paper2.orders.length, 1);
  assert.equal(paper2.availableBalance, paper1.availableBalance);

  // 1b. AutoTrader round-trip
  const mockDb = {
    getAllSettings: () => ({}),
    getSetting: (k, d) => d,
    saveSetting: () => {},
  };
  const mockBitget = {
    getCandles: async () => ({ candles: [] }),
    getLiveUniverseCandles: async () => new Map(),
    getTickers: async () => [],
  };
  const trader1 = new AutoTrader({
    paperEngine: paper1,
    bitget: mockBitget,
    db: mockDb,
    riskConfig: {},
  });
  trader1.tradesToday = 2;
  trader1.skippedSymbols.set('BTCUSDT', Date.now() + 60000);
  trader1.activityLog.push({
    action: 'TEST_ACTION',
    symbol: 'SPYUSDT',
    details: 'Round-trip test',
    timestamp: Date.now(),
  });

  const traderExport = trader1.exportState();
  assert.equal(traderExport.tradesToday, 2);
  assert.equal(traderExport.activityLog.length, 1);
  assert.equal(traderExport.skippedSymbols.length, 1);

  const trader2 = new AutoTrader({
    paperEngine: paper2,
    bitget: mockBitget,
    db: mockDb,
    riskConfig: {},
  });
  trader2.importState(traderExport);
  assert.equal(trader2.tradesToday, 2);
  assert.equal(trader2.activityLog.length, 1);
  assert.ok(trader2.skippedSymbols.has('BTCUSDT'));

  // 1c. TradeMonitor round-trip
  const monitorDb = { db: { exec: () => {} } };
  const monitor1 = new TradeMonitor({
    paperEngine: paper1,
    bitget: mockBitget,
    db: monitorDb,
  });
  monitor1.lastCheckAt = 1700000000000;
  monitor1.nextCheckAt = 1700000300000;
  monitor1.positionSentiments.set('pos-1', 'BULLISH');
  const monitorExport = monitor1.exportState();
  assert.equal(monitorExport.lastCheckAt, 1700000000000);
  assert.equal(monitorExport.nextCheckAt, 1700000300000);

  const monitor2 = new TradeMonitor({
    paperEngine: paper2,
    bitget: mockBitget,
    db: monitorDb,
  });
  monitor2.importState(monitorExport);
  assert.equal(monitor2.lastCheckAt, 1700000000000);
  assert.equal(monitor2.nextCheckAt, 1700000300000);
  assert.equal(monitor2.positionSentiments.get('pos-1'), 'BULLISH');
});

test('2. Stateless /api/demo/order approval and rejection', async () => {
  const server = new VT2Server({
    port: 0,
    demoReadOnly: true,
    forceFixtureMode: true,
  });
  server.start();

  await new Promise((resolve) => {
    if (server.server.listening) return resolve();
    server.server.on('listening', resolve);
  });

  const baseUrl = `http://localhost:${server.server.address().port}`;

  try {
    const initialState = {
      account: {
        initialEquity: 10000,
        equity: 10000,
        availableBalance: 10000,
        usedMargin: 0,
        unrealizedPnl: 0,
        realizedPnl: 0,
        dailyLoss: 0,
        consecutiveLosses: 0,
        startOfDayEquity: 10000,
        currentEquity: 10000,
      },
      positions: [],
      orders: [],
      journal: [],
      rejectedSetups: [],
    };

    // 2a. Valid order with safe RR -> Approved
    const validRes = await fetch(`${baseUrl}/api/demo/order`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        state: initialState,
        order: {
          symbol: 'BTCUSDT',
          side: 'LONG',
          stopLoss: 60000,
          takeProfit: 120000,
          allocationPercent: 10,
        },
      }),
    });
    assert.equal(validRes.status, 200);
    const validData = await validRes.json();
    assert.equal(validData.approved, true, 'Valid order should be approved');
    assert.ok(validData.state, 'Returns updated state');
    assert.equal(validData.state.positions.length, 1, 'Position created in state');
    assert.equal(validData.events.length, 1, 'Event emitted');
    assert.equal(validData.events[0].type, 'ORDER_FILLED');

    // 2b. Invalid order (Stop Loss on wrong side: LONG with stopLoss > entry) -> Rejected
    const badOrderRes = await fetch(`${baseUrl}/api/demo/order`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        state: initialState,
        order: {
          symbol: 'BTCUSDT',
          side: 'LONG',
          stopLoss: 90000, // Stop loss above market price
          takeProfit: 100000,
          allocationPercent: 10,
        },
      }),
    });
    assert.equal(badOrderRes.status, 200);
    const badOrderData = await badOrderRes.json();
    assert.equal(badOrderData.approved, false, 'Invalid order should be rejected');
    assert.ok(badOrderData.error, 'Rejection reason returned');
    assert.ok(badOrderData.state.rejectedSetups.length > 0, 'Rejected setup logged in state');
  } finally {
    await server.stop();
  }
});

test('3. Stateless /api/demo/tick position lifecycle and exits', async () => {
  const server = new VT2Server({
    port: 0,
    demoReadOnly: true,
    forceFixtureMode: true,
  });
  server.start();

  await new Promise((resolve) => {
    if (server.server.listening) return resolve();
    server.server.on('listening', resolve);
  });

  const baseUrl = `http://localhost:${server.server.address().port}`;

  try {
    const stateWithPos = {
      account: {
        initialEquity: 10000,
        equity: 10000,
        availableBalance: 9000,
        usedMargin: 1000,
        unrealizedPnl: 0,
        realizedPnl: 0,
        dailyLoss: 0,
        consecutiveLosses: 0,
        startOfDayEquity: 10000,
        currentEquity: 10000,
      },
      positions: [{
        id: 'pos-tick-test-1',
        symbol: 'BTCUSDT',
        side: 'LONG',
        entryPrice: 65000,
        currentPrice: 65000,
        stopLoss: 64000,
        takeProfit: 70000,
        originalQuantity: 0.1,
        currentQuantity: 0.1,
        status: 'OPEN',
        openedAt: Date.now() - 10000,
        unrealizedPnl: 0,
        realizedPnl: 0,
        feesPaid: 1.3,
        breakevenTriggered: false,
        trailingStopActive: false,
        partialTpTaken: false,
      }],
      orders: [],
      journal: [],
      rejectedSetups: [],
    };

    const tickRes = await fetch(`${baseUrl}/api/demo/tick`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ state: stateWithPos }),
    });
    assert.equal(tickRes.status, 200);
    const tickData = await tickRes.json();
    assert.ok(tickData.state, 'Returns updated state');
    assert.ok(Array.isArray(tickData.events), 'Events is an array');
  } finally {
    await server.stop();
  }
});

test('4. Stateless /api/demo/bot/cycle candidate evaluation and cooldown', async () => {
  const server = new VT2Server({
    port: 0,
    demoReadOnly: true,
    forceFixtureMode: true,
  });
  server.start();

  await new Promise((resolve) => {
    if (server.server.listening) return resolve();
    server.server.on('listening', resolve);
  });

  const baseUrl = `http://localhost:${server.server.address().port}`;

  try {
    // 4a. Cooldown block: lastTradeClosedAt within cooldown
    const cooldownState = {
      account: {
        initialEquity: 10000,
        equity: 10000,
        availableBalance: 10000,
        usedMargin: 0,
        unrealizedPnl: 0,
        realizedPnl: 0,
        dailyLoss: 0,
        consecutiveLosses: 0,
        startOfDayEquity: 10000,
        currentEquity: 10000,
        lastTradeClosedAt: Date.now() - 60000, // 1 min ago (cooldown is 15 min)
      },
      positions: [],
      orders: [],
      journal: [],
      rejectedSetups: [],
      botSettings: {
        running: true,
        candidateSkipMinutes: 15,
        cooldownAfterManualClose: true,
      },
    };

    const coolRes = await fetch(`${baseUrl}/api/demo/bot/cycle`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ state: cooldownState }),
    });
    assert.equal(coolRes.status, 200);
    const coolData = await coolRes.json();
    assert.equal(coolData.status, 'WAITING', 'Status should be WAITING when in cooldown');
    assert.ok(coolData.waitingReason && coolData.waitingReason.includes('Cooldown active'), 'Waiting reason should mention cooldown');
    assert.ok(coolData.waitingResumesAt > Date.now(), 'Waiting resumes time is in the future');

    // 4b. Normal bot cycle evaluation (no cooldown)
    const activeState = {
      account: {
        initialEquity: 10000,
        equity: 10000,
        availableBalance: 10000,
        usedMargin: 0,
        unrealizedPnl: 0,
        realizedPnl: 0,
        dailyLoss: 0,
        consecutiveLosses: 0,
        startOfDayEquity: 10000,
        currentEquity: 10000,
        lastTradeClosedAt: null,
      },
      positions: [],
      orders: [],
      journal: [],
      rejectedSetups: [],
      botSettings: {
        running: true,
        botMarketMode: 'stocks',
        botCandidateOrder: 'equities_first',
      },
    };

    const cycleRes = await fetch(`${baseUrl}/api/demo/bot/cycle`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ state: activeState }),
    });
    assert.equal(cycleRes.status, 200);
    const cycleData = await cycleRes.json();
    assert.ok(cycleData.state, 'Returns updated state');
    assert.ok(['RUNNING', 'WAITING', 'IDLE'].includes(cycleData.status), 'Valid status returned');
  } finally {
    await server.stop();
  }
});

test('5. Input validation: tampered or oversized state rejected', async () => {
  const server = new VT2Server({
    port: 0,
    demoReadOnly: true,
    forceFixtureMode: true,
  });
  server.start();

  await new Promise((resolve) => {
    if (server.server.listening) return resolve();
    server.server.on('listening', resolve);
  });

  const baseUrl = `http://localhost:${server.server.address().port}`;

  try {
    // 5a. Tampered equity out of bounds (< 100)
    const badEquityState = {
      account: { initialEquity: 10, equity: 10 },
      positions: [],
    };
    const badEquityRes = await fetch(`${baseUrl}/api/demo/order`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ state: badEquityState, order: { symbol: 'BTCUSDT' } }),
    });
    assert.equal(badEquityRes.status, 400);
    const badEquityData = await badEquityRes.json();
    assert.equal(badEquityData.error, 'INVALID_STATE');

    // 5b. Position count exceeds maximum (> 10)
    const tooManyPositions = Array.from({ length: 12 }, (_, i) => ({
      id: `pos-${i}`,
      symbol: 'BTCUSDT',
      entryPrice: 60000,
      currentPrice: 60000,
      stopLoss: 59000,
      takeProfit: 62000,
      currentQuantity: 0.01,
      status: 'OPEN',
    }));
    const badPosRes = await fetch(`${baseUrl}/api/demo/tick`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        state: {
          account: { initialEquity: 10000, equity: 10000 },
          positions: tooManyPositions,
        },
      }),
    });
    assert.equal(badPosRes.status, 400);

    // 5c. Invalid contract symbol
    const badSymRes = await fetch(`${baseUrl}/api/demo/order`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        state: {
          account: { initialEquity: 10000, equity: 10000 },
          positions: [],
        },
        order: { symbol: 'FAKECOIN999USDT' },
      }),
    });
    assert.equal(badSymRes.status, 400);

    // 5d. validateDemoState direct unit check
    assert.equal(validateDemoState(null).valid, false);
    assert.equal(validateDemoState({ account: { equity: 'NaN' } }).valid, false);
    assert.equal(validateDemoState({ account: { equity: 10000 }, positions: [] }).valid, true);
  } finally {
    await server.stop();
  }
});

test('6. Security boundaries: zero mainnet bypass and public-feed only', async () => {
  const server = new VT2Server({
    port: 0,
    demoReadOnly: true,
    forceFixtureMode: true,
  });
  server.start();

  await new Promise((resolve) => {
    if (server.server.listening) return resolve();
    server.server.on('listening', resolve);
  });

  const baseUrl = `http://localhost:${server.server.address().port}`;

  try {
    // 6a. POST /api/environment MAINNET -> 403
    const envRes = await fetch(`${baseUrl}/api/environment`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ targetEnvironment: 'MAINNET' }),
    });
    assert.equal(envRes.status, 403);
    const envData = await envRes.json();
    assert.equal(envData.error, 'MAINNET_EXECUTION_BLOCKED');

    // 6b. POST /api/orders/live -> 403
    const liveRes = await fetch(`${baseUrl}/api/orders/live`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ symbol: 'BTCUSDT', side: 'LONG' }),
    });
    assert.equal(liveRes.status, 403);

    // 6c. POST /api/orders/mainnet -> 403
    const mainnetRes = await fetch(`${baseUrl}/api/orders/mainnet`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ symbol: 'BTCUSDT', side: 'LONG' }),
    });
    assert.equal(mainnetRes.status, 403);

    // 6d. POST /api/backtest -> 501 pointing to report.html
    const btRes = await fetch(`${baseUrl}/api/backtest`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ symbol: 'BTCUSDT' }),
    });
    assert.equal(btRes.status, 501);
    const btData = await btRes.json();
    assert.equal(btData.error, 'BACKTEST_SERVER_ONLY');
    assert.equal(btData.reportUrl, '/report.html');
  } finally {
    await server.stop();
  }
});
