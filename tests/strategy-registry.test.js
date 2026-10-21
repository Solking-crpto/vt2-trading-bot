import test from 'node:test';
import assert from 'node:assert/strict';
import {
  STRATEGY_REGISTRY,
  getActiveStrategy,
  getStrategyValidationStatus,
  getValidationWarningBlock,
  REQUIRED_VALIDATION_PHRASE,
} from '../src/strategy/registry.js';
import { VT2Server } from '../src/vt2-server.js';

test('Strategy Registry - S0 metadata and unvalidated status', () => {
  const s0 = getActiveStrategy('S0');
  assert.ok(s0, 'S0 must exist in strategy registry');
  assert.equal(s0.id, 'S0');
  assert.equal(s0.isValidated, false);
  assert.equal(s0.status, 'UNVALIDATED: failed pre-registered replay (trial 35)');
  assert.equal(s0.trialNumber, 35);
  assert.equal(s0.verdict, 'FAIL');
  assert.ok(s0.conclusionStatement.includes('no demonstrated edge'));
  assert.equal(s0.metrics.dev.trades, 348);
  assert.equal(s0.metrics.dev.netPnl, -154.41);
  assert.equal(s0.metrics.validation.trades, 34);
  assert.equal(s0.metrics.validation.netPnl, -647.91);
});

test('Strategy Registry - Status string and warning block helpers', () => {
  const status = getStrategyValidationStatus();
  assert.equal(status, 'UNVALIDATED: failed pre-registered replay (trial 35)');

  const warning = getValidationWarningBlock();
  assert.equal(warning.isValidated, false);
  assert.equal(warning.trial, 35);
  assert.equal(warning.verdict, 'FAIL');
  assert.equal(warning.requiredAcknowledgment, REQUIRED_VALIDATION_PHRASE);
  assert.equal(REQUIRED_VALIDATION_PHRASE, 'I UNDERSTAND THIS STRATEGY HAS NOT PASSED VALIDATION');
});

test('Strategy Registry - Server API endpoints expose validation status', async () => {
  const server = new VT2Server({ port: 0, isDemoReadOnly: true });
  await server.start();
  const address = server.server.address();
  const baseUrl = `http://127.0.0.1:${address.port}`;

  try {
    // 1. GET /api/strategy/status
    const stratRes = await fetch(`${baseUrl}/api/strategy/status`);
    assert.equal(stratRes.status, 200);
    const stratData = await stratRes.json();
    assert.equal(stratData.status, 'UNVALIDATED: failed pre-registered replay (trial 35)');
    assert.equal(stratData.strategy.id, 'S0');
    assert.equal(stratData.strategy.isValidated, false);
    assert.equal(stratData.warning.requiredAcknowledgment, REQUIRED_VALIDATION_PHRASE);

    // 2. GET /api/health includes strategyStatus
    const healthRes = await fetch(`${baseUrl}/api/health`);
    assert.equal(healthRes.status, 200);
    const healthData = await healthRes.json();
    assert.equal(healthData.strategyStatus, 'UNVALIDATED: failed pre-registered replay (trial 35)');
    assert.ok(healthData.strategy);

    // 3. GET /api/mode includes strategyStatus and validationWarning
    const modeRes = await fetch(`${baseUrl}/api/mode`);
    assert.equal(modeRes.status, 200);
    const modeData = await modeRes.json();
    assert.equal(modeData.strategyStatus, 'UNVALIDATED: failed pre-registered replay (trial 35)');
    assert.ok(modeData.validationWarning);

    // 4. POST /api/orders/preview includes strategyStatus and validationWarning
    const prevRes = await fetch(`${baseUrl}/api/orders/preview`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        symbol: 'BTCUSDT',
        side: 'LONG',
        entryPrice: 60000,
        quantity: 0.0005,
        stopLoss: 59000,
      }),
    });
    assert.equal(prevRes.status, 200);
    const prevData = await prevRes.json();
    assert.equal(prevData.strategyStatus, 'UNVALIDATED: failed pre-registered replay (trial 35)');
    assert.ok(prevData.validationWarning);
  } finally {
    await server.stop();
  }
});
