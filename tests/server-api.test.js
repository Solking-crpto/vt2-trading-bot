import test from 'node:test';
import assert from 'node:assert/strict';
import { VT2Server } from '../src/vt2-server.js';

test('VT2Server launches, handles API routes, and enforces mainnet security denial', async () => {
  // Use port 0 to dynamically bind to any free operating system port
  const server = new VT2Server({ port: 0, dbPath: ':memory:', forceFixtureMode: true });
  server.start();

  // Wait for listening
  await new Promise(resolve => {
    if (server.server.listening) return resolve();
    server.server.on('listening', resolve);
  });

  const address = server.server.address();
  const baseUrl = `http://localhost:${address.port}`;

  try {
    // 1. Health & Safety
    const healthRes = await fetch(`${baseUrl}/api/health`);
    assert.equal(healthRes.status, 200);
    const health = await healthRes.json();
    assert.equal(health.status, 'HEALTHY');
    assert.equal(health.environment, 'PAPER');
    assert.equal(health.mainnetExecutionAllowed, false);

    // 2. Strict Security Interception of Live Mainnet Orders
    const liveOrderRes = await fetch(`${baseUrl}/api/orders/live`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ symbol: 'BTCUSDT', side: 'LONG' }),
    });
    assert.equal(liveOrderRes.status, 403);
    const liveOrderBody = await liveOrderRes.json();
    assert.equal(liveOrderBody.error, 'MAINNET_EXECUTION_BLOCKED');
    assert.equal(liveOrderBody.securityAlert, true);

    // 3. Market Status
    const statusRes = await fetch(`${baseUrl}/api/market/status`);
    assert.equal(statusRes.status, 200);

    // 4. Market Scanner
    const scannerRes = await fetch(`${baseUrl}/api/market/scanner`);
    assert.equal(scannerRes.status, 200);
    const scanner = await scannerRes.json();
    assert.ok(Array.isArray(scanner.qualified));
    assert.ok(Array.isArray(scanner.rejected));

    // 5. Account Summary
    const accRes = await fetch(`${baseUrl}/api/account`);
    assert.equal(accRes.status, 200);
    const acc = await accRes.json();
    assert.equal(acc.environment, 'PAPER');
    assert.equal(acc.initialEquity, 10000);

    // 6. Deliberation with Multi-Agent Coordinator
    const deliberateRes = await fetch(`${baseUrl}/api/agents/deliberate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        proposal: {
          symbol: 'BTCUSDT',
          side: 'LONG',
          entryPrice: 60000,
          stopLoss: 59600,
          takeProfit: 61000,
          rewardRisk: { netRR: 2.2 },
          indicators: { price: 60000, ema50_15m: 59700, rsi_15m: 56, isVolumeSpike: true },
          reasons: ['Bullish moving average alignment'],
        },
      }),
    });
    assert.equal(deliberateRes.status, 200);
    const deliberation = await deliberateRes.json();
    assert.ok(deliberation.coordinatorVerdict);
    assert.ok(deliberation.thesis);
    assert.ok(deliberation.review);

    // 7. Submit Paper Order
    const paperOrderRes = await fetch(`${baseUrl}/api/orders/paper`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        symbol: 'BTCUSDT',
        side: 'LONG',
        entryPrice: 60000,
        stopLoss: 59600,
        takeProfit: 61000,
        quantity: 0.1,
      }),
    });
    assert.equal(paperOrderRes.status, 201);
    const paperOrder = await paperOrderRes.json();
    assert.equal(paperOrder.order.environment, 'PAPER');
    assert.equal(paperOrder.position.status, 'OPEN');

    // 8. Fetch Positions
    const posRes = await fetch(`${baseUrl}/api/positions`);
    assert.equal(posRes.status, 200);
    const posList = await posRes.json();
    assert.equal(posList.positions.length, 1);

    // 9. Close Position
    const closeRes = await fetch(`${baseUrl}/api/positions/${paperOrder.position.id}/close`, {
      method: 'POST',
    });
    assert.equal(closeRes.status, 200);

    // 10. Fetch Trade Journal
    const journalRes = await fetch(`${baseUrl}/api/journal`);
    assert.equal(journalRes.status, 200);
    const journal = await journalRes.json();
    assert.ok(Array.isArray(journal.entries));

  } finally {
    await server.stop();
  }
});
