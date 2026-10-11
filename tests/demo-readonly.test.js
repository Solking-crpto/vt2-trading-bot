import test from 'node:test';
import assert from 'node:assert/strict';

process.env.DEPLOY_MODE = 'DEMO_READONLY';

import { VT2Server, handleRequest } from '../src/server.js';
import serverlessHandler from '../api/index.js';

test('VT2Server demo-readonly mode configuration and behavior', async () => {
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

  const address = server.server.address();
  const baseUrl = `http://localhost:${address.port}`;

  try {
    // 1. Asserts no background interval or WebSocket connection started
    assert.equal(server.isDemoReadOnly, true, 'isDemoReadOnly flag must be true');
    assert.equal(server.tickInterval, null, 'Background market ticker interval must not be running');
    assert.equal(server.bitget.disableWs, true, 'WebSocket client must be disabled in demo mode');

    // 2. Asserts GET /api/market/tickers returns tickers without error
    const tickersRes = await fetch(`${baseUrl}/api/market/tickers`);
    assert.equal(tickersRes.status, 200, 'GET /api/market/tickers should return 200');
    const tickers = await tickersRes.json();
    assert.ok(tickers && typeof tickers === 'object', 'Tickers should be a valid object');

    // 3. Asserts GET /api/account returns the clean default account state with $10,000 equity
    const accRes = await fetch(`${baseUrl}/api/account`);
    assert.equal(accRes.status, 200, 'GET /api/account should return 200');
    const acc = await accRes.json();
    assert.equal(acc.equity, 10000, 'Account equity should be clean $10,000');
    assert.equal(acc.balance, 10000, 'Account balance should be clean $10,000');
    assert.equal(acc.openPositionsCount, 0, 'Open positions count should be 0');
    assert.equal(acc.demoMode, true, 'demoMode flag should be true');

    // 4. Asserts POST /api/orders/paper returns 501 DEMO_READONLY
    const paperRes = await fetch(`${baseUrl}/api/orders/paper`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ symbol: 'BTCUSDT', side: 'LONG', entryPrice: 65000, quantity: 0.1 }),
    });
    assert.equal(paperRes.status, 501, 'POST /api/orders/paper should return 501 Not Implemented in demo mode');
    const paperErr = await paperRes.json();
    assert.equal(paperErr.error, 'DEMO_READONLY');

    // 5. Asserts POST /api/positions/close-all returns 501 DEMO_READONLY
    const closeAllRes = await fetch(`${baseUrl}/api/positions/close-all`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ exitReason: 'TEST' }),
    });
    assert.equal(closeAllRes.status, 501, 'POST /api/positions/close-all should return 501 Not Implemented in demo mode');
    const closeAllErr = await closeAllRes.json();
    assert.equal(closeAllErr.error, 'DEMO_READONLY');

    // 6. Asserts POST /api/environment with target MAINNET returns 403 (mainnet guard must never be bypassed)
    const envMainnetRes = await fetch(`${baseUrl}/api/environment`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ targetEnvironment: 'MAINNET' }),
    });
    assert.equal(envMainnetRes.status, 403, 'POST /api/environment MAINNET must return 403');
    const envMainnetErr = await envMainnetRes.json();
    assert.equal(envMainnetErr.error, 'MAINNET_EXECUTION_BLOCKED');

    // 7. Asserts POST /api/orders/live returns 403
    const liveOrderRes = await fetch(`${baseUrl}/api/orders/live`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ symbol: 'BTCUSDT', side: 'LONG' }),
    });
    assert.equal(liveOrderRes.status, 403, 'POST /api/orders/live must return 403');
    const liveOrderErr = await liveOrderRes.json();
    assert.equal(liveOrderErr.error, 'MAINNET_EXECUTION_BLOCKED');

    // 8. Asserts GET /api/verify returns verification status
    const verifyRes = await fetch(`${baseUrl}/api/verify`);
    assert.equal(verifyRes.status, 200, 'GET /api/verify should return 200');
    const verifyData = await verifyRes.json();
    assert.ok(verifyData, 'Verification data returned');

    // 9. Asserts GET /api/report/alpha-factory returns report data
    const reportRes = await fetch(`${baseUrl}/api/report/alpha-factory`);
    assert.equal(reportRes.status, 200, 'GET /api/report/alpha-factory should return 200');
    const reportData = await reportRes.json();
    assert.equal(reportData.status, 'SUCCESS');
  } finally {
    await server.stop();
  }
});

test('Serverless handler in api/index.js and handleRequest respond to mock HTTP objects', async () => {
  // Test handleRequest directly with mock req and res
  let responseCode = null;
  let responseData = '';
  const mockHeaders = {};

  const mockReq = {
    method: 'GET',
    url: '/api/health',
    headers: { host: 'localhost' },
  };

  const mockRes = {
    writeHead(code, headers) {
      responseCode = code;
      Object.assign(mockHeaders, headers);
    },
    end(data) {
      responseData = data;
    },
    setHeader(k, v) {
      mockHeaders[k] = v;
    },
  };

  await handleRequest(mockReq, mockRes);
  assert.equal(responseCode, 200, 'handleRequest should return 200 for /api/health');
  const parsedHealth = JSON.parse(responseData);
  assert.equal(parsedHealth.status, 'HEALTHY');
  assert.equal(parsedHealth.deployMode, 'DEMO_READONLY');

  // Test api/index.js handler
  let sCode = null;
  let sData = '';
  const sHeaders = {};

  const sReq = {
    method: 'GET',
    url: '/api/account',
    headers: { host: 'localhost' },
  };

  const sRes = {
    writeHead(code, headers) {
      sCode = code;
      Object.assign(sHeaders, headers);
    },
    end(data) {
      sData = data;
    },
    setHeader(k, v) {
      sHeaders[k] = v;
    },
  };

  await serverlessHandler(sReq, sRes);
  assert.equal(sCode, 200, 'serverlessHandler should return 200 for /api/account');
  const parsedAcc = JSON.parse(sData);
  assert.equal(parsedAcc.equity, 10000);
});
