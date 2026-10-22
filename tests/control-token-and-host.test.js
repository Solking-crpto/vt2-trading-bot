import test from 'node:test';
import assert from 'node:assert/strict';
import { VT2Server } from '../src/vt2-server.js';

async function startServer(server) {
  server.start();
  await new Promise(resolve => {
    if (server.server.listening) return resolve();
    server.server.on('listening', resolve);
  });
  return server.server.address();
}

test('Host Binding & Local Control Token - Default 127.0.0.1 Binding', async () => {
  const prevHost = process.env.HOST;
  try {
    delete process.env.HOST;
    const server = new VT2Server({ port: 0 });
    assert.equal(server.host, '127.0.0.1');

    const address = await startServer(server);
    assert.equal(address.address, '127.0.0.1', 'Server must bind to 127.0.0.1 by default');
    await server.stop();
  } finally {
    if (prevHost !== undefined) process.env.HOST = prevHost;
  }
});

test('Host Binding & Local Control Token - HOST Env Override', async () => {
  const prevHost = process.env.HOST;
  try {
    process.env.HOST = '127.0.0.1';
    const server = new VT2Server({ port: 0 });
    assert.equal(server.host, '127.0.0.1');

    const address = await startServer(server);
    assert.equal(address.address, '127.0.0.1');
    await server.stop();
  } finally {
    if (prevHost !== undefined) process.env.HOST = prevHost;
  }
});

test('Host Binding & Local Control Token - Random Token Generation & Console Log', async () => {
  const logs = [];
  const origLog = console.log;
  console.log = (...args) => logs.push(args.join(' '));

  try {
    const server = new VT2Server({ port: 0 });
    assert.ok(server.controlToken, 'Token must be generated');
    assert.equal(typeof server.controlToken, 'string');
    assert.ok(server.controlToken.length >= 32, 'Token must have sufficient entropy');

    await startServer(server);
    const logMatch = logs.find(l => l.includes('[VT2 Security] Local Control Token:'));
    assert.ok(logMatch, 'Token must be logged once to console on startup');
    assert.ok(logMatch.includes(server.controlToken));

    await server.stop();
  } finally {
    console.log = origLog;
  }
});

test('Host Binding & Local Control Token - Protected Endpoints Reject Without Token (401)', async () => {
  const server = new VT2Server({ port: 0 });
  const address = await startServer(server);
  const baseUrl = `http://127.0.0.1:${address.port}`;

  try {
    // 1. Arming endpoint
    const armRes = await fetch(`${baseUrl}/api/mode/arm-live`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ confirmationPhrase: 'ENABLE LIVE TRADING' }),
    });
    assert.equal(armRes.status, 401, 'POST /api/mode/arm-live without token must return 401');
    const armData = await armRes.json();
    assert.equal(armData.error, 'UNAUTHORIZED');

    // 2. Mode endpoint
    const modeRes = await fetch(`${baseUrl}/api/mode`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mode: 'DEMO' }),
    });
    assert.equal(modeRes.status, 401, 'POST /api/mode without token must return 401');

    // 3. Kill-switch endpoint
    const killRes = await fetch(`${baseUrl}/api/autotrading/kill-switch`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    assert.equal(killRes.status, 401, 'POST /api/autotrading/kill-switch without token must return 401');

    // 4. Order endpoint
    const orderRes = await fetch(`${baseUrl}/api/orders/paper`, {
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
    assert.equal(orderRes.status, 401, 'POST /api/orders/paper without token must return 401');

    // 5. AI endpoint
    const aiRes = await fetch(`${baseUrl}/api/ai/brief`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ symbol: 'BTCUSDT' }),
    });
    assert.equal(aiRes.status, 401, 'POST /api/ai/brief without token must return 401');
  } finally {
    await server.stop();
  }
});

test('Host Binding & Local Control Token - Protected Endpoints Accept With Token', async () => {
  const server = new VT2Server({ port: 0 });
  const address = await startServer(server);
  const baseUrl = `http://127.0.0.1:${address.port}`;
  const token = server.controlToken;

  try {
    // 1. Order endpoint with x-control-token
    const orderRes = await fetch(`${baseUrl}/api/orders/paper`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-control-token': token,
      },
      body: JSON.stringify({
        symbol: 'BTCUSDT',
        side: 'LONG',
        entryPrice: 60000,
        stopLoss: 59600,
        takeProfit: 61000,
        quantity: 0.1,
      }),
    });
    assert.equal(orderRes.status, 201, 'Order must succeed when control token is provided');
    const orderData = await orderRes.json();
    assert.ok(orderData.order);

    // 2. Kill-switch endpoint with x-control-token
    const killRes = await fetch(`${baseUrl}/api/autotrading/kill-switch`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-control-token': token,
      },
      body: JSON.stringify({}),
    });
    assert.equal(killRes.status, 200, 'Kill-switch must succeed with control token');
  } finally {
    await server.stop();
  }
});

test('Host Binding & Local Control Token - Browser UI Injected Script & Loopback Retrieval', async () => {
  const server = new VT2Server({ port: 0 });
  const address = await startServer(server);
  const baseUrl = `http://127.0.0.1:${address.port}`;

  try {
    // 1. GET / serves HTML with injected window.VT2_CONTROL_TOKEN and cookie
    const htmlRes = await fetch(`${baseUrl}/`);
    assert.equal(htmlRes.status, 200);
    const setCookie = htmlRes.headers.get('set-cookie');
    assert.ok(setCookie && setCookie.includes('vt2_control_token='));
    const html = await htmlRes.text();
    assert.ok(html.includes(`window.VT2_CONTROL_TOKEN = "${server.controlToken}"`));

    // 2. GET /api/control/token returns token to loopback caller
    const tokenRes = await fetch(`${baseUrl}/api/control/token`);
    assert.equal(tokenRes.status, 200);
    const tokenData = await tokenRes.json();
    assert.equal(tokenData.controlToken, server.controlToken);

    // 3. Request with Cookie authentication succeeds
    const cookieOrderRes = await fetch(`${baseUrl}/api/orders/paper`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Cookie': `vt2_control_token=${server.controlToken}`,
      },
      body: JSON.stringify({
        symbol: 'ETHUSDT',
        side: 'LONG',
        entryPrice: 3000,
        stopLoss: 2980,
        takeProfit: 3050,
        quantity: 1,
      }),
    });
    assert.equal(cookieOrderRes.status, 201, 'Request with valid cookie must succeed');
  } finally {
    await server.stop();
  }
});
