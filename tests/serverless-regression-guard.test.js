import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';

// Set VERCEL environment flag
process.env.VERCEL = '1';
process.env.DEPLOY_MODE = 'DEMO_READONLY';

import serverlessHandler from '../api/index.js';
import { isHosted } from '../src/environment.js';

function createMockReqRes({ method = 'GET', url = '/', body = null, headers = {} }) {
  const req = new EventEmitter();
  req.method = method;
  req.url = url;
  req.headers = { host: 'vt2-trading-bot.vercel.app', ...headers };

  let statusCode = 200;
  const resHeaders = {};
  let bodyData = '';

  const res = {
    writeHead(code, h = {}) {
      statusCode = code;
      Object.assign(resHeaders, h);
    },
    setHeader(k, v) {
      resHeaders[k.toLowerCase()] = v;
    },
    getHeader(k) {
      return resHeaders[k.toLowerCase()];
    },
    end(chunk) {
      if (chunk) bodyData += chunk;
      res.emit?.('finish');
    },
    get statusCode() {
      return statusCode;
    },
    set statusCode(code) {
      statusCode = code;
    },
    get body() {
      try {
        return JSON.parse(bodyData);
      } catch {
        return bodyData;
      }
    },
    get rawBody() {
      return bodyData;
    },
  };

  process.nextTick(() => {
    if (body) {
      req.emit('data', typeof body === 'string' ? body : JSON.stringify(body));
    }
    req.emit('end');
  });

  return { req, res };
}

async function invokeHandler(method, url, body = null, headers = {}) {
  const { req, res } = createMockReqRes({ method, url, body, headers });
  await serverlessHandler(req, res);
  return res;
}

test('Task 0.3 Serverless Regression Guard: isHosted() detects VERCEL=1', () => {
  assert.equal(isHosted(), true, 'isHosted() must return true when VERCEL=1');
});

test('Task 0.3 Serverless Regression Guard: stateless /api/demo/* never returns 401', async () => {
  const validState = {
    account: { initialEquity: 10000, equity: 10000, balance: 10000, freeMargin: 10000, usedMargin: 0 },
    positions: [],
    tradeHistory: [],
    activityLog: [],
    settings: { stopLossPercent: 1.0, takeProfitPercent: 2.0 },
  };

  // 1. /api/demo/order with empty body returns 400 (validation), NEVER 401
  const emptyOrderRes = await invokeHandler('POST', '/api/demo/order', {});
  assert.notEqual(emptyOrderRes.statusCode, 401, 'POST /api/demo/order must never return 401 in serverless');
  assert.equal(emptyOrderRes.statusCode, 400, 'Expected 400 validation error for empty body');

  // 2. /api/demo/order with valid payload returns 200
  const orderRes = await invokeHandler('POST', '/api/demo/order', {
    state: validState,
    order: { symbol: 'BTCUSDT', side: 'LONG', allocationPercent: 5, stopLoss: 60000, takeProfit: 75000 },
  });
  assert.notEqual(orderRes.statusCode, 401, 'POST /api/demo/order must never return 401 in serverless');
  assert.equal(orderRes.statusCode, 200, 'POST /api/demo/order should return 200 with valid paper state');

  // 3. /api/demo/tick returns 200, never 401
  const tickRes = await invokeHandler('POST', '/api/demo/tick', { state: validState });
  assert.notEqual(tickRes.statusCode, 401, 'POST /api/demo/tick must never return 401 in serverless');
  assert.equal(tickRes.statusCode, 200, 'POST /api/demo/tick should return 200');

  // 4. /api/demo/close with empty body returns 400, never 401
  const closeEmptyRes = await invokeHandler('POST', '/api/demo/close', {});
  assert.notEqual(closeEmptyRes.statusCode, 401, 'POST /api/demo/close must never return 401 in serverless');
  assert.equal(closeEmptyRes.statusCode, 400);

  // 5. /api/demo/close-all returns 200, never 401
  const closeAllRes = await invokeHandler('POST', '/api/demo/close-all', { state: validState });
  assert.notEqual(closeAllRes.statusCode, 401, 'POST /api/demo/close-all must never return 401 in serverless');
  assert.equal(closeAllRes.statusCode, 200, 'POST /api/demo/close-all should return 200');
});

test('Task 0.3 Serverless Regression Guard: /api/mode refuses DEMO and LIVE in serverless', async () => {
  // DEMO attempt
  const demoModeRes = await invokeHandler('POST', '/api/mode', { mode: 'DEMO' });
  assert.equal(demoModeRes.statusCode, 403, 'POST /api/mode DEMO must return 403 in serverless');
  assert.equal(demoModeRes.body.error, 'SERVERLESS_MODE_LOCKED');

  // LIVE attempt
  const liveModeRes = await invokeHandler('POST', '/api/mode', { mode: 'LIVE' });
  assert.equal(liveModeRes.statusCode, 403, 'POST /api/mode LIVE must return 403 in serverless');
  assert.ok(['SERVERLESS_MODE_LOCKED', 'MAINNET_EXECUTION_BLOCKED'].includes(liveModeRes.body.error));

  // PAPER is allowed
  const paperModeRes = await invokeHandler('POST', '/api/mode', { mode: 'PAPER' });
  assert.equal(paperModeRes.statusCode, 200, 'POST /api/mode PAPER must return 200');
});

test('Task 0.3 Serverless Regression Guard: AI endpoints report disabled in serverless', async () => {
  // /api/ai/status
  const aiStatusRes = await invokeHandler('GET', '/api/ai/status');
  assert.equal(aiStatusRes.statusCode, 200);
  assert.equal(aiStatusRes.body.enabled, false);
  assert.match(aiStatusRes.body.reason, /hosted/i);

  // /api/ai/brief returns disabled error (never 401)
  const aiBriefRes = await invokeHandler('POST', '/api/ai/brief', { symbol: 'BTCUSDT' });
  assert.notEqual(aiBriefRes.statusCode, 401, 'POST /api/ai/brief must never return 401 in serverless');
  assert.equal(aiBriefRes.statusCode, 400);
  assert.match(aiBriefRes.body.error, /hosted/i);
});

test('Task 0.3 Serverless Regression Guard: /api/orders/live and non-PAPER /api/environment return 403', async () => {
  // /api/orders/live
  const liveOrderRes = await invokeHandler('POST', '/api/orders/live', { symbol: 'BTCUSDT' });
  assert.equal(liveOrderRes.statusCode, 403, 'POST /api/orders/live must return 403');
  assert.equal(liveOrderRes.body.error, 'MAINNET_EXECUTION_BLOCKED');

  // non-PAPER /api/environment
  const envLiveRes = await invokeHandler('POST', '/api/environment', { targetEnvironment: 'LIVE' });
  assert.equal(envLiveRes.statusCode, 403, 'POST /api/environment LIVE must return 403');
  assert.ok(['SERVERLESS_MODE_LOCKED', 'MAINNET_EXECUTION_BLOCKED'].includes(envLiveRes.body.error));
});

test('Task 0.3 Serverless Regression Guard: HOST and 127.0.0.1 do not affect serverless build', async () => {
  process.env.HOST = '0.0.0.0';
  const pingRes = await invokeHandler('GET', '/api/ping');
  assert.equal(pingRes.statusCode, 200);
  assert.equal(pingRes.body.ok, true);
});
