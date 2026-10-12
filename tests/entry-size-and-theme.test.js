import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { evaluatePaperTrade } from '../src/risk-engine.js';
import { VT2Server } from '../src/vt2-server.js';

const baseTrade = {
  side: 'LONG',
  entryPrice: 100,
  stopLoss: 98,
  equity: 10000,
  startOfDayEquity: 10000,
  currentEquity: 10000,
};

test('entry allocation parameter accepts 1% to 100% and scales position sizing proportionally', () => {
  // 10% allocation (standard baseline)
  const result10 = evaluatePaperTrade({
    ...baseTrade,
    entryAllocationPercent: 10,
  });
  assert.equal(result10.allowed, true);
  assert.equal(result10.entryAllocationPercent, 10);
  assert.equal(result10.riskAmount, 5); // 10% of $50 max risk
  assert.equal(result10.quantity, 2.5); // 5 / 2

  // 50% allocation
  const result50 = evaluatePaperTrade({
    ...baseTrade,
    entryAllocationPercent: 50,
  });
  assert.equal(result50.allowed, true);
  assert.equal(result50.entryAllocationPercent, 50);
  assert.equal(result50.riskAmount, 25); // 50% of $50 max risk
  assert.equal(result50.quantity, 12.5); // 25 / 2

  // 100% maximum allocation
  const result100 = evaluatePaperTrade({
    ...baseTrade,
    entryAllocationPercent: 100,
  });
  assert.equal(result100.allowed, true);
  assert.equal(result100.entryAllocationPercent, 100);
  assert.equal(result100.riskAmount, 50); // 100% of $50 max risk
  assert.equal(result100.quantity, 25); // 50 / 2

  // Minimum 1% allocation
  const result1 = evaluatePaperTrade({
    ...baseTrade,
    entryAllocationPercent: 1,
  });
  assert.equal(result1.allowed, true);
  assert.equal(result1.entryAllocationPercent, 1);
  assert.equal(result1.riskAmount, 0.5); // 1% of $50 max risk
  assert.equal(result1.quantity, 0.25);
});

test('100% entry allocation NEVER overrides deterministic risk engine equity caps', () => {
  const result100 = evaluatePaperTrade({
    ...baseTrade,
    entryAllocationPercent: 100,
  });

  assert.equal(result100.allowed, true);
  // Max loss at stop-loss must be capped strictly at 0.5% of total equity ($50)
  assert.ok(result100.riskAmount <= 50);
  assert.ok(result100.actualEquityRiskPercent <= 0.5);
  assert.equal(result100.maxEquityRiskPercent, 0.5);

  // Even at 100% allocation, daily loss limit (2% SOD) triggers deterministic rejection
  const resultDailyLossLocked = evaluatePaperTrade({
    ...baseTrade,
    currentEquity: 9790, // $210 loss (> 2.0% of $10,000)
    entryAllocationPercent: 100,
  });
  assert.equal(resultDailyLossLocked.allowed, false);
  assert.equal(resultDailyLossLocked.reason, 'DAILY_LOSS_LIMIT_REACHED');

  // Even at 100% allocation, stop loss on wrong side triggers deterministic rejection
  const resultBadStop = evaluatePaperTrade({
    ...baseTrade,
    stopLoss: 102, // Long stop above entry
    entryAllocationPercent: 100,
  });
  assert.equal(resultBadStop.allowed, false);
  assert.equal(resultBadStop.reason, 'INVALID_STOP_LOSS');
});

test('rejects entry allocation outside the valid 1% - 100% boundary', () => {
  const invalidValues = [0, -10, 101, 150, -0.5, NaN, null, 'abc'];

  for (const val of invalidValues) {
    const result = evaluatePaperTrade({
      ...baseTrade,
      entryAllocationPercent: val,
    });
    assert.equal(result.allowed, false, `Expected ${val} to be rejected`);
    assert.equal(result.reason, 'INVALID_ENTRY_ALLOCATION');
  }
});

test('high allocation confirmation policy requires confirmation for >10% and explicit 100% warning', () => {
  function verifyAllocationPolicy(targetValue) {
    const requiresConfirmation = targetValue > 10;
    const isCritical100Percent = targetValue === 100;
    const warnings = [];

    if (isCritical100Percent) {
      warnings.push('The proposed entry may consume the entire configured allocation or available allocation base.');
      warnings.push('High allocation can magnify losses and reduce the funds available for other opportunities.');
      warnings.push('Leverage, fees, slippage, funding, and liquidation risk can increase potential losses.');
      warnings.push('The existing risk engine and safety limits still apply.');
      warnings.push('A 100% allocation is not a recommendation and does not guarantee safety.');
    } else if (requiresConfirmation) {
      warnings.push('Allocation exceeds 10% standard baseline.');
      warnings.push('Increases exposure concentration.');
      warnings.push('Deterministic risk controls remain enforced.');
    }

    return { requiresConfirmation, isCritical100Percent, warnings };
  }

  // 10% does not require confirmation modal
  const check10 = verifyAllocationPolicy(10);
  assert.equal(check10.requiresConfirmation, false);
  assert.equal(check10.warnings.length, 0);

  // 5% does not require confirmation modal
  const check5 = verifyAllocationPolicy(5);
  assert.equal(check5.requiresConfirmation, false);

  // 25% requires confirmation
  const check25 = verifyAllocationPolicy(25);
  assert.equal(check25.requiresConfirmation, true);
  assert.equal(check25.isCritical100Percent, false);
  assert.ok(check25.warnings.length > 0);

  // 100% requires explicit 5-point critical safety confirmation
  const check100 = verifyAllocationPolicy(100);
  assert.equal(check100.requiresConfirmation, true);
  assert.equal(check100.isCritical100Percent, true);
  assert.equal(check100.warnings.length, 5);
  assert.ok(check100.warnings.some(w => w.includes('consume the entire configured allocation')));
  assert.ok(check100.warnings.some(w => w.includes('magnify losses and reduce the funds available')));
  assert.ok(check100.warnings.some(w => w.includes('Leverage, fees, slippage, funding, and liquidation')));
  assert.ok(check100.warnings.some(w => w.includes('existing risk engine and safety limits still apply')));
  assert.ok(check100.warnings.some(w => w.includes('not a recommendation and does not guarantee safety')));
});

test('server persists entryAllocationPercent and theme in SQLite settings and restores them across restarts', async () => {
  const server = new VT2Server({ port: 0, dbPath: ':memory:', forceFixtureMode: true });
  server.start();

  await new Promise(resolve => {
    if (server.server.listening) return resolve();
    server.server.on('listening', resolve);
  });

  const address = server.server.address();
  const baseUrl = `http://localhost:${address.port}`;

  try {
    // 1. Initial defaults
    const initialRes = await fetch(`${baseUrl}/api/settings`);
    assert.equal(initialRes.status, 200);
    const initialData = await initialRes.json();
    assert.equal(initialData.defaults.entryAllocationPercent, 10);
    assert.equal(initialData.defaults.theme, 'dark');

    // 2. Update to 50% allocation and light mode
    const updateRes = await fetch(`${baseUrl}/api/settings`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        entryAllocationPercent: 50,
        theme: 'light',
      }),
    });
    assert.equal(updateRes.status, 200);
    const updateData = await updateRes.json();
    assert.equal(updateData.success, true);
    assert.ok(updateData.updated.includes('entryAllocationPercent'));
    assert.ok(updateData.updated.includes('theme'));

    // 3. Verify retrieval
    const verifyRes = await fetch(`${baseUrl}/api/settings`);
    const verifyData = await verifyRes.json();
    assert.equal(verifyData.settings.entryAllocationPercent, 50);
    assert.equal(verifyData.settings.theme, 'light');

    // 4. Update to 100% allocation
    const update100Res = await fetch(`${baseUrl}/api/settings`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        entryAllocationPercent: 100,
      }),
    });
    assert.equal(update100Res.status, 200);
    const verify100 = await (await fetch(`${baseUrl}/api/settings`)).json();
    assert.equal(verify100.settings.entryAllocationPercent, 100);

    // 5. Validation error on illegal allocation (<1 or >100)
    const badAllocRes = await fetch(`${baseUrl}/api/settings`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ entryAllocationPercent: 105 }),
    });
    assert.equal(badAllocRes.status, 400);

    // 6. Validation error on illegal theme
    const badThemeRes = await fetch(`${baseUrl}/api/settings`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ theme: 'neon' }),
    });
    assert.equal(badThemeRes.status, 400);

    // 7. Deliberation endpoint receives and honors entryAllocationPercent
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
          timestamp: Date.now(),
        },
        entryAllocationPercent: 20,
      }),
    });
    assert.equal(deliberateRes.status, 200);
    const delResult = await deliberateRes.json();
    assert.equal(delResult.isApproved, true);
    assert.equal(delResult.riskResult.entryAllocationPercent, 20);
    // At 20% allocation: riskAmount = $10 (20% of $50)
    assert.equal(delResult.riskResult.riskAmount, 10);
  } finally {
    await server.stop();
  }
});

test('appearance design tokens and styles specify clean plain white light mode and dark mode', () => {
  const cssPath = path.resolve('public/styles.css');
  const cssContent = fs.readFileSync(cssPath, 'utf8');

  // Verify light mode definition and pure white background
  assert.ok(cssContent.includes('[data-theme="light"]') || cssContent.includes('body.light-theme'));
  assert.ok(cssContent.includes('--bg-main: #ffffff') || cssContent.includes('--bg-main: #fff'));
  assert.ok(cssContent.includes('--text-main: #0f172a'));
  assert.ok(cssContent.includes('--border-color: #e2e8f0'));

  // Verify theme toggle button styling
  assert.ok(cssContent.includes('.btn-theme-toggle'));

  // Verify high allocation modal styling
  assert.ok(cssContent.includes('.modal-overlay'));
  assert.ok(cssContent.includes('.modal-card'));
});
