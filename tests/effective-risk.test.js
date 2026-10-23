import test from 'node:test';
import assert from 'node:assert/strict';
import {
  calculateEffectiveRisk,
  validateCustomRisk,
  RISK_PRESETS,
  DEFAULT_RISK_PERCENT,
} from '../src/risk/effective-risk.js';
import { VT2Server } from '../src/vt2-server.js';

const ORIGINAL_ENV = { ...process.env };
function resetEnv(customEnv = {}) {
  for (const k of Object.keys(process.env)) {
    if (!(k in ORIGINAL_ENV)) delete process.env[k];
  }
  Object.assign(process.env, ORIGINAL_ENV, customEnv);
}

// ---------------------------------------------------------------------------
// 1. Defaults and Presets Verification
// ---------------------------------------------------------------------------
test('Task 3: Default risk percentage is strictly 0.5% and presets include required levels', () => {
  assert.equal(DEFAULT_RISK_PERCENT, 0.5, 'Default risk must stay at 0.5%');
  const requiredPresets = [1, 5, 10, 25, 50, 100];
  for (const preset of requiredPresets) {
    assert.ok(RISK_PRESETS.includes(preset), `Presets must include ${preset}%`);
  }
});

// ---------------------------------------------------------------------------
// 2. Uncapped Sizing within Normal Parameters
// ---------------------------------------------------------------------------
test('Task 3: Small risk sizing is uncapped when within margin and leverage limits', () => {
  // Balance: $10,000, Risk: 0.5% ($50), Stop: 1.0% (0.01), Leverage: 3x
  // Raw notional: $50 / 0.01 = $5,000
  // Leverage cap at 3x: $30,000
  // Margin cap at 90%: 0.90 * $10,000 * 3 = $27,000
  // $5,000 is well below $27,000 -> Uncapped
  const res = calculateEffectiveRisk({
    balance: 10000,
    riskPercent: 0.5,
    stopDistancePercent: 0.01,
    assetClass: 'crypto',
    selectedLeverage: 3,
    mode: 'PAPER',
  });

  assert.equal(res.isCapped, false);
  assert.equal(res.effectiveRiskPercent, 0.5);
  assert.equal(res.effectiveRiskDollars, 50);
  assert.equal(res.cappedNotional, 5000);
  assert.match(res.readout, /Selected 0\.5% -> effective 0\.5% \(uncapped/);
});

// ---------------------------------------------------------------------------
// 3. Leverage Cap Enforcement
// ---------------------------------------------------------------------------
test('Task 3: Effective risk is correctly bounded under leverage cap', () => {
  // Equity asset class has max leverage 3x (from profiles.json)
  // Balance: $10,000, Risk: 50% ($5,000), Stop: 0.6% (0.006)
  // Raw notional: $5,000 / 0.006 = $833,333.33
  // Profile max leverage for equity is 3x
  // Max notional by leverage: $10,000 * 3 = $30,000
  // Max notional by margin (90%): 0.90 * $10,000 * 3 = $27,000
  // Capped at $27,000 (margin/leverage cap)
  // Effective dollar risk: $27,000 * 0.006 = $162.00
  // Effective risk %: $162 / $10,000 = 1.62%
  const res = calculateEffectiveRisk({
    balance: 10000,
    riskPercent: 50,
    stopDistancePercent: 0.006,
    assetClass: 'equity',
    selectedLeverage: 3,
    mode: 'PAPER',
  });

  assert.equal(res.isCapped, true);
  assert.equal(res.effectiveLeverage, 3);
  assert.equal(res.profileMaxLeverage, 3);
  assert.equal(res.cappedNotional, 27000);
  assert.equal(res.effectiveRiskDollars, 162);
  assert.equal(res.effectiveRiskPercent, 1.62);
  assert.match(res.readout, /Selected 50% -> effective 1\.62% \(capped by leverage 3x, margin 90%, stop 0\.6%\)/);
});

// ---------------------------------------------------------------------------
// 4. Margin Cap (90% of Balance) Enforcement
// ---------------------------------------------------------------------------
test('Task 3: Effective risk ensures margin used never exceeds 90% of balance', () => {
  // Balance: $10,000, Crypto max leverage 5x
  // Selected leverage: 5x
  // Margin cap: 90% of balance -> max notional = 0.90 * $10,000 * 5 = $45,000
  // If user requests 25% risk ($2,500) with 0.5% stop (0.005):
  // Raw notional: $2,500 / 0.005 = $500,000
  // Capped at $45,000 (margin 90% at 5x)
  // Effective dollar risk: $45,000 * 0.005 = $225
  // Effective risk %: $225 / $10,000 = 2.25%
  const res = calculateEffectiveRisk({
    balance: 10000,
    riskPercent: 25,
    stopDistancePercent: 0.005,
    assetClass: 'crypto',
    selectedLeverage: 5,
    mode: 'PAPER',
  });

  assert.equal(res.isCapped, true);
  assert.equal(res.boundBy, 'MARGIN');
  assert.equal(res.cappedNotional, 45000);
  assert.equal(res.effectiveRiskPercent, 2.25);
  // Margin used = $45,000 / 5 = $9,000 which is exactly 90% of $10,000
  const marginUsed = res.cappedNotional / res.effectiveLeverage;
  assert.equal(marginUsed, 9000);
  assert.equal(marginUsed / 10000, 0.90);
});

// ---------------------------------------------------------------------------
// 5. Live-Limits Cap Enforcement in DEMO and LIVE
// ---------------------------------------------------------------------------
test('Task 3: In DEMO and LIVE mode, live-limits caps bound effective risk and show bound cap', () => {
  // In DEMO/LIVE mode, config/live-limits.json sets:
  // maxNotionalPerOrderUsd = $50, maxRiskPerTradePct = 0.0025 (0.25%)
  // Balance: $10,000, User selects 5% risk ($500), stop: 1.0% (0.01)
  // In PAPER mode: raw notional = $500 / 0.01 = $50,000 (capped by margin/leverage)
  // In DEMO mode: live-limits cap maxNotionalPerOrderUsd $50 binds!
  const resDemo = calculateEffectiveRisk({
    balance: 10000,
    riskPercent: 5,
    stopDistancePercent: 0.01,
    assetClass: 'crypto',
    selectedLeverage: 5,
    mode: 'DEMO',
  });

  assert.equal(resDemo.isCapped, true);
  // $50 max notional cap applies
  assert.ok(resDemo.cappedNotional <= 50);
  assert.ok(resDemo.bindingCap.includes('live-limits'));
  assert.match(resDemo.readout, /capped by live-limits/);

  // In LIVE mode, max risk is 0.25%
  const resLive = calculateEffectiveRisk({
    balance: 10000,
    riskPercent: 10,
    stopDistancePercent: 0.01,
    assetClass: 'crypto',
    selectedLeverage: 5,
    mode: 'LIVE',
  });
  assert.equal(resLive.isCapped, true);
  assert.ok(resLive.effectiveRiskPercent <= 0.25);
  assert.ok(resLive.bindingCap.includes('live-limits'));
});

// ---------------------------------------------------------------------------
// 6. Custom Values Validation, Clamping, and Warnings
// ---------------------------------------------------------------------------
test('Task 3: Custom values above 10% trigger warning flag, and custom values above 100% are clamped', () => {
  // Normal 5%: no warning
  const val5 = validateCustomRisk(5, 'PAPER');
  assert.equal(val5.valid, true);
  assert.equal(val5.requiresWarning, false);

  // 10%: boundary (no warning at exactly 10)
  const val10 = validateCustomRisk(10, 'PAPER');
  assert.equal(val10.valid, true);
  assert.equal(val10.requiresWarning, false);

  // 15%: above 10% triggers red warning
  const val15 = validateCustomRisk(15, 'PAPER');
  assert.equal(val15.valid, true);
  assert.equal(val15.requiresWarning, true);

  // 150%: above 100% is clamped to 100% with explanation
  const val150 = validateCustomRisk(150, 'PAPER');
  assert.equal(val150.valid, false);
  assert.equal(val150.value, 100);
  assert.equal(val150.isClamped, true);
  assert.match(val150.reason, /100%/);

  // LIVE mode clamps custom values above live cap (0.25%)
  const valLive = validateCustomRisk(2.0, 'LIVE');
  assert.equal(valLive.valid, false);
  assert.equal(valLive.value, 0.25);
  assert.equal(valLive.isClamped, true);
  assert.match(valLive.reason, /LIVE mode strictly enforces/);
});

// ---------------------------------------------------------------------------
// 7. Server API Endpoint Integration
// ---------------------------------------------------------------------------
test('Task 3: GET /api/risk/effective-risk returns computed effective risk, caps, and presets', async () => {
  resetEnv();
  const server = new VT2Server({ port: 0 });
  await server.start();
  const port = server.server.address().port;
  const baseUrl = `http://127.0.0.1:${port}`;

  try {
    const res = await fetch(`${baseUrl}/api/risk/effective-risk?riskPercent=50&leverage=3&stopDistancePercent=0.006&assetClass=equity`);
    assert.equal(res.status, 200);
    const data = await res.json();

    assert.equal(data.selectedRiskPercent, 50);
    assert.equal(data.effectiveLeverage, 3);
    assert.equal(data.effectiveRiskPercent, 1.62);
    assert.equal(data.isCapped, true);
    assert.match(data.readout, /Selected 50% -> effective 1\.62%/);
    assert.ok(Array.isArray(data.presets));
    assert.ok(data.presets.includes(0.5));
    assert.ok(data.presets.includes(50));
  } finally {
    await server.stop();
    resetEnv();
  }
});
