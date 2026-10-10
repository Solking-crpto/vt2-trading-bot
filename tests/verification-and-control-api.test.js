import test from 'node:test';
import assert from 'node:assert/strict';
import { VT2Server } from '../src/server.js';

test('VT2Server exposes Verification, Monitor, Auto-trading, and Market Mode endpoints', async () => {
  const server = new VT2Server({ port: 0, dbPath: ':memory:', forceFixtureMode: true, disableMonitor: true });
  server.start();

  await new Promise(resolve => {
    if (server.server.listening) return resolve();
    server.server.on('listening', resolve);
  });

  const address = server.server.address();
  const baseUrl = `http://localhost:${address.port}`;

  try {
    // 1. Verification Suite status & run-all
    const verifStatusRes = await fetch(`${baseUrl}/api/verification/status`);
    assert.equal(verifStatusRes.status, 200);
    const verifStatus = await verifStatusRes.json();
    assert.equal(verifStatus.summary.total, 9);
    assert.equal(verifStatus.summary.passed, 9);

    // 2. Verification single check
    const singleRunRes = await fetch(`${baseUrl}/api/verification/run`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ checkKey: 'hmacSha256Signature' }),
    });
    assert.equal(singleRunRes.status, 200);
    const singleCheck = await singleRunRes.json();
    assert.equal(singleCheck.name, 'Bitget HMAC-SHA256 Canonical Signature');
    assert.equal(singleCheck.passed, true);

    // 3. Trade Monitor status & check-now
    const monStatusRes = await fetch(`${baseUrl}/api/monitor/status`);
    assert.equal(monStatusRes.status, 200);
    const monStatus = await monStatusRes.json();
    assert.ok(monStatus.activePositionsCount !== undefined);

    const checkNowRes = await fetch(`${baseUrl}/api/monitor/check-now`, { method: 'POST' });
    assert.equal(checkNowRes.status, 200);
    const checkNow = await checkNowRes.json();
    assert.equal(checkNow.success, true);

    // 4. Market Mode (Crypto | Stocks) Switcher
    const modeGetRes = await fetch(`${baseUrl}/api/market/mode`);
    assert.equal(modeGetRes.status, 200);
    const modeGet = await modeGetRes.json();
    assert.equal(modeGet.activeMode, 'crypto');
    assert.equal(modeGet.cryptoSession.sessionState, 'OPEN_24_7');

    const modeSwitchRes = await fetch(`${baseUrl}/api/market/mode`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mode: 'stocks' }),
    });
    assert.equal(modeSwitchRes.status, 200);
    const modeSwitch = await modeSwitchRes.json();
    assert.equal(modeSwitch.activeMode, 'stocks');
    assert.ok(modeSwitch.stocksSession.market);

    // 5. Automated Trading Lifecycle
    const autoStatusRes = await fetch(`${baseUrl}/api/autotrading/status`);
    assert.equal(autoStatusRes.status, 200);
    const autoStatus = await autoStatusRes.json();
    assert.equal(autoStatus.status, 'OFF');

    const autoStartRes = await fetch(`${baseUrl}/api/autotrading/start`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ maxTradesPerDay: 5 }),
    });
    assert.equal(autoStartRes.status, 200);
    const autoStarted = await autoStartRes.json();
    assert.equal(autoStarted.status, 'RUNNING');
    assert.equal(autoStarted.config.maxTradesPerDay, 5);

    const autoStopRes = await fetch(`${baseUrl}/api/autotrading/stop`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ reason: 'TEST_STOP' }),
    });
    assert.equal(autoStopRes.status, 200);
    const autoStopped = await autoStopRes.json();
    assert.equal(autoStopped.status, 'STOPPED');

    // 6. Multi-Position Support & Close All
    // Open two paper trades
    await fetch(`${baseUrl}/api/orders/paper-test`, { method: 'POST' });
    // Increase concurrent setting to 2 to open second position
    await fetch(`${baseUrl}/api/settings`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ maxConcurrentPositions: 2 }),
    });
    await fetch(`${baseUrl}/api/orders/paper-test`, { method: 'POST' });

    const posRes = await fetch(`${baseUrl}/api/positions`);
    const posData = await posRes.json();
    assert.equal(posData.positions.length, 2);

    // Close all positions
    const closeAllRes = await fetch(`${baseUrl}/api/positions/close-all`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ exitReason: 'TEST_CLOSE_ALL' }),
    });
    assert.equal(closeAllRes.status, 200);
    const closeAllData = await closeAllRes.json();
    assert.equal(closeAllData.closedPositionsCount, 2);

    const posAfterRes = await fetch(`${baseUrl}/api/positions`);
    const posAfter = await posAfterRes.json();
    assert.equal(posAfter.positions.length, 0);

  } finally {
    await server.stop();
  }
});
