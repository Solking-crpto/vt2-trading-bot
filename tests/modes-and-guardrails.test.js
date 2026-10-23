import test from 'node:test';
import assert from 'node:assert/strict';

import {
  CURRENT_ENVIRONMENT,
  EXECUTION_MODES,
  getCurrentMode,
  setExecutionMode,
  isHosted,
  isLiveTradingAllowed,
  isLiveArmed,
  armLiveTrading,
  disarmLive,
  getLiveArmingStatus,
  getDemoCredentialStatus,
  getLiveCredentialStatus,
  getCredentialOverview,
  assertNoWithdrawalEndpoint,
  redactSecrets,
  assertMainnetExecutionBlocked,
  validateExecutionMode,
  SafetyViolationError,
} from '../src/environment.js';

import { BitgetTradeClient } from '../src/execution/bitget-trade-client.js';
import { loadLiveLimits, validateLiveOrderCaps } from '../src/config/live-limits.js';
import { getProfileForSymbol, getUnderlyingMarketStatus } from '../src/config/profiles.js';
import { VT2Server } from '../src/vt2-server.js';

// Clean test environment setup helper
function resetEnv(customEnv = {}) {
  delete process.env.DEPLOY_MODE;
  delete process.env.VERCEL;
  delete process.env.AWS_LAMBDA_FUNCTION_NAME;
  delete process.env.LIVE_TRADING_ENABLED;
  delete process.env.BITGET_DEMO_API_KEY;
  delete process.env.BITGET_DEMO_API_SECRET;
  delete process.env.BITGET_DEMO_PASSPHRASE;
  delete process.env.BITGET_LIVE_API_KEY;
  delete process.env.BITGET_LIVE_API_SECRET;
  delete process.env.BITGET_LIVE_API_PASSPHRASE;
  disarmLive('TEST_CLEANUP');
  setExecutionMode('PAPER', { allowUnconfiguredDemo: true });

  for (const [k, v] of Object.entries(customEnv)) {
    process.env[k] = v;
  }
}

// ---------------------------------------------------------------------------
// 1. Mode Initialization & Defaults
// ---------------------------------------------------------------------------
test('mode state machine defaults to PAPER mode and is never persisted as LIVE', () => {
  resetEnv();
  assert.equal(getCurrentMode(), 'PAPER');
  assert.equal(CURRENT_ENVIRONMENT, 'PAPER');
  assert.equal(isLiveArmed(), false);
  const status = getLiveArmingStatus();
  assert.equal(status.isArmed, false);
});

// ---------------------------------------------------------------------------
// 2. LIVE Arming Rejections (Env flag, credentials, confirmation phrase)
// ---------------------------------------------------------------------------
test('LIVE arming is refused without LIVE_TRADING_ENABLED=true in environment', () => {
  resetEnv({
    BITGET_LIVE_API_KEY: 'mock-live-key-12345678',
    BITGET_LIVE_API_SECRET: 'mock-live-secret-12345678',
    BITGET_LIVE_API_PASSPHRASE: 'mock-pass-1234',
  });

  assert.throws(
    () => armLiveTrading('ENABLE LIVE TRADING'),
    (err) => err instanceof SafetyViolationError && err.code === 'LIVE_TRADING_FLAG_DISABLED'
  );
});

test('LIVE arming is refused when live API credentials are missing', () => {
  resetEnv({
    LIVE_TRADING_ENABLED: 'true',
    // Missing live keys
  });

  assert.throws(
    () => armLiveTrading('ENABLE LIVE TRADING'),
    (err) => err instanceof SafetyViolationError && err.code === 'LIVE_CREDENTIALS_MISSING'
  );
});

test('LIVE arming is refused without exact confirmation phrase "ENABLE LIVE TRADING"', () => {
  resetEnv({
    LIVE_TRADING_ENABLED: 'true',
    BITGET_LIVE_API_KEY: 'mock-live-key-12345678',
    BITGET_LIVE_API_SECRET: 'mock-live-secret-12345678',
    BITGET_LIVE_API_PASSPHRASE: 'mock-pass-1234',
  });

  const invalidPhrases = [
    'enable live trading',
    'ENABLE LIVE',
    'ENABLE LIVE TRADING ',
    'YES',
    'true',
  ];

  for (const p of invalidPhrases) {
    assert.throws(
      () => armLiveTrading(p),
      (err) => err instanceof SafetyViolationError && err.code === 'INVALID_ARMING_PHRASE'
    );
  }
});

test('LIVE arming is refused if preflight check failed', () => {
  resetEnv({
    LIVE_TRADING_ENABLED: 'true',
    BITGET_LIVE_API_KEY: 'mock-live-key-12345678',
    BITGET_LIVE_API_SECRET: 'mock-live-secret-12345678',
    BITGET_LIVE_API_PASSPHRASE: 'mock-pass-1234',
  });

  assert.throws(
    () => armLiveTrading('ENABLE LIVE TRADING', { passed: false, error: 'Clock skew excessive' }),
    (err) => err instanceof SafetyViolationError && err.code === 'PREFLIGHT_FAILED'
  );
});

// ---------------------------------------------------------------------------
// 3. Hosted / Serverless Lockout (Vercel / DEMO_READONLY)
// ---------------------------------------------------------------------------
test('hosted serverless environment strictly locks execution to PAPER mode', () => {
  resetEnv({
    DEPLOY_MODE: 'DEMO_READONLY',
    LIVE_TRADING_ENABLED: 'true',
    BITGET_LIVE_API_KEY: 'mock-live-key-12345678',
    BITGET_LIVE_API_SECRET: 'mock-live-secret-12345678',
    BITGET_LIVE_API_PASSPHRASE: 'mock-pass-1234',
  });

  assert.equal(isHosted(), true);
  assert.equal(isLiveTradingAllowed(), false);

  // Arming is refused
  assert.throws(
    () => armLiveTrading('ENABLE LIVE TRADING'),
    (err) => err instanceof SafetyViolationError && err.code === 'HOSTED_LIVE_PROHIBITED'
  );

  // DEMO mode is refused
  assert.throws(
    () => setExecutionMode('DEMO'),
    (err) => err instanceof SafetyViolationError && err.code === 'SERVERLESS_MODE_LOCKED'
  );

  // LIVE mode is refused
  assert.throws(
    () => setExecutionMode('LIVE'),
    (err) => err instanceof SafetyViolationError && err.code === 'SERVERLESS_MODE_LOCKED'
  );

  // PAPER mode succeeds
  const mode = setExecutionMode('PAPER');
  assert.equal(mode, 'PAPER');
});

// ---------------------------------------------------------------------------
// 4. Successful Arming, Mode Switching & Auto-Disarm
// ---------------------------------------------------------------------------
test('LIVE mode activates only when armed and auto-disarms on manual trigger or kill switch', () => {
  resetEnv({
    LIVE_TRADING_ENABLED: 'true',
    BITGET_LIVE_API_KEY: 'mock-live-key-12345678',
    BITGET_LIVE_API_SECRET: 'mock-live-secret-12345678',
    BITGET_LIVE_API_PASSPHRASE: 'mock-pass-1234',
  });

  // Attempting to set LIVE before arming throws
  assert.throws(
    () => setExecutionMode('LIVE'),
    (err) => err instanceof SafetyViolationError && err.code === 'LIVE_NOT_ARMED'
  );

  // Arm successfully
  const armRes = armLiveTrading('ENABLE LIVE TRADING', { passed: true });
  assert.equal(armRes.success, true);
  assert.equal(armRes.armed, true);
  assert.equal(isLiveArmed(), true);

  // Mode switch to LIVE succeeds
  setExecutionMode('LIVE');
  assert.equal(getCurrentMode(), 'LIVE');

  // Disarm resets mode immediately to PAPER
  disarmLive('TEST_DISARM');
  assert.equal(isLiveArmed(), false);
  assert.equal(getCurrentMode(), 'PAPER');
});

// ---------------------------------------------------------------------------
// 5. Hard Caps Verification (config/live-limits.json)
// ---------------------------------------------------------------------------
test('validateLiveOrderCaps rejects orders that exceed hard caps with named cap reason', () => {
  const caps = loadLiveLimits();
  assert.equal(caps.maxNotionalPerOrderUsd, 50);
  assert.equal(caps.maxTotalOpenNotionalUsd, 100);
  assert.equal(caps.maxRiskPerTradePct, 0.0025);
  assert.equal(caps.maxDailyLossUsd, 10);
  assert.equal(caps.maxOpenPositions, 1);
  assert.equal(caps.maxLeverage.crypto, 5);
  assert.equal(caps.maxLeverage.equity, 3);
  assert.equal(caps.confirmFirstNTrades, 3);

  // 1. Order notional > $50 rejected
  const resNotional = validateLiveOrderCaps({
    symbol: 'BTCUSDT',
    entryPrice: 60000,
    quantity: 0.001, // Notional $60 > $50 cap
  });
  assert.equal(resNotional.allowed, false);
  assert.equal(resNotional.error, 'MAX_NOTIONAL_PER_ORDER_EXCEEDED');
  assert.ok(resNotional.reason.includes('maxNotionalPerOrderUsd'));

  // 2. Total open notional > $100 rejected
  const resTotalNotional = validateLiveOrderCaps({
    symbol: 'BTCUSDT',
    entryPrice: 40000,
    quantity: 0.001, // $40
  }, { currentOpenNotional: 70 }); // 70 + 40 = 110 > 100
  assert.equal(resTotalNotional.allowed, false);
  assert.equal(resTotalNotional.error, 'MAX_TOTAL_OPEN_NOTIONAL_EXCEEDED');
  assert.ok(resTotalNotional.reason.includes('maxTotalOpenNotionalUsd'));

  // 3. Max daily loss > $10 rejected
  const resDailyLoss = validateLiveOrderCaps({
    symbol: 'BTCUSDT',
    entryPrice: 20000,
    quantity: 0.001,
  }, { todayRealizedLoss: 10.5 });
  assert.equal(resDailyLoss.allowed, false);
  assert.equal(resDailyLoss.error, 'MAX_DAILY_LOSS_EXCEEDED');
  assert.ok(resDailyLoss.reason.includes('maxDailyLossUsd'));

  // 4. Max concurrent open positions >= 1 rejected
  const resOpenPos = validateLiveOrderCaps({
    symbol: 'BTCUSDT',
    entryPrice: 20000,
    quantity: 0.001,
  }, { openPositionsCount: 1 });
  assert.equal(resOpenPos.allowed, false);
  assert.equal(resOpenPos.error, 'MAX_OPEN_POSITIONS_EXCEEDED');

  // 5. Crypto leverage cap > 5x rejected
  const resCryptoLev = validateLiveOrderCaps({
    symbol: 'BTCUSDT',
    entryPrice: 20000,
    quantity: 0.001,
    leverage: 10,
  });
  assert.equal(resCryptoLev.allowed, false);
  assert.equal(resCryptoLev.error, 'MAX_LEVERAGE_EXCEEDED');

  // 6. Equity leverage cap > 3x rejected
  const resEquityLev = validateLiveOrderCaps({
    symbol: 'SPYUSDT',
    entryPrice: 500,
    quantity: 0.05,
    leverage: 5,
  });
  assert.equal(resEquityLev.allowed, false);
  assert.equal(resEquityLev.error, 'MAX_LEVERAGE_EXCEEDED');

  // 7. Disallowed symbol rejected
  const resBadSym = validateLiveOrderCaps({
    symbol: 'MEMECOIN_USDT',
    entryPrice: 1,
    quantity: 10,
  });
  assert.equal(resBadSym.allowed, false);
  assert.equal(resBadSym.error, 'SYMBOL_NOT_ALLOWED_IN_LIVE');

  // 8. Compliant order passes with manual confirm flag for first 3 trades
  const resPass = validateLiveOrderCaps({
    symbol: 'BTCUSDT',
    entryPrice: 40000,
    quantity: 0.001, // $40 notional
    leverage: 3,
  }, {
    currentOpenNotional: 0,
    openPositionsCount: 0,
    todayRealizedLoss: 0,
    completedLiveTradesCount: 1, // trade #2
  });
  assert.equal(resPass.allowed, true);
  assert.equal(resPass.requiresManualConfirm, true);
});

// ---------------------------------------------------------------------------
// 6. Asset-Class Profiles (config/profiles.json)
// ---------------------------------------------------------------------------
test('asset class profiles enforce distinct crypto and equity rules', () => {
  const cryptoProfile = getProfileForSymbol('BTCUSDT');
  assert.equal(cryptoProfile.assetClass, 'crypto');
  assert.equal(cryptoProfile.maxLeverage, 5);
  assert.equal(cryptoProfile.tradingHours, '24/7');

  const equityProfile = getProfileForSymbol('SPYUSDT');
  assert.equal(equityProfile.assetClass, 'equity');
  assert.equal(equityProfile.maxLeverage, 3);
  assert.equal(equityProfile.equityEntriesWhenUnderlyingClosed, 'ALLOW_WITH_WARNING');

  const status = getUnderlyingMarketStatus();
  assert.ok(status.timezone.includes('New_York'));
  assert.equal(typeof status.isOpen, 'boolean');
});

// ---------------------------------------------------------------------------
// 7. BitgetTradeClient: Stop-Loss Confirmation & Emergency Flatten
// ---------------------------------------------------------------------------
test('BitgetTradeClient immediately triggers emergency flatten when stop-loss protection is not confirmed', async () => {
  let emergencyFlattenCalled = false;
  let flattenOrderPayload = null;

  const mockFetch = async (url, options = {}) => {
    const urlStr = String(url);

    // Initial order placement succeeds
    if (urlStr.includes('/api/v2/mix/order/place-order')) {
      const body = JSON.parse(options.body || '{}');
      if (body.reduceOnly === 'YES') {
        emergencyFlattenCalled = true;
        flattenOrderPayload = body;
        return {
          ok: true,
          json: async () => ({ code: '00000', data: { orderId: 'flatten-123' } }),
        };
      }
      return {
        ok: true,
        json: async () => ({ code: '00000', data: { orderId: 'entry-order-123' } }),
      };
    }

    // Pending plan orders return empty (SL not registered on exchange)
    if (urlStr.includes('/api/v2/mix/order/orders-plan-pending')) {
      return {
        ok: true,
        json: async () => ({ code: '00000', data: [] }),
      };
    }

    // Positions query returns no active SL attached
    if (urlStr.includes('/api/v2/mix/position/all-position')) {
      return {
        ok: true,
        json: async () => ({ code: '00000', data: [] }),
      };
    }

    return {
      ok: true,
      json: async () => ({ code: '00000', data: {} }),
    };
  };

  const client = new BitgetTradeClient('DEMO', {
    apiKey: 'mock-demo-key-12345678',
    apiSecret: 'mock-demo-secret-12345678',
    passphrase: 'mock-passphrase',
    fetch: mockFetch,
  });

  // Verify that an order with a requested stopLoss that fails exchange confirmation triggers emergency flatten
  await assert.rejects(
    async () => {
      await client.placeOrderWithProtection({
        symbol: 'BTCUSDT',
        side: 'LONG',
        quantity: 0.01,
        entryPrice: 60000,
        stopLoss: 59000,
      });
    },
    (err) => {
      return err instanceof SafetyViolationError && err.code === 'STOP_LOSS_CONFIRMATION_FAILED';
    }
  );

  assert.equal(emergencyFlattenCalled, true, 'emergencyFlatten must be called');
  assert.equal(flattenOrderPayload?.reduceOnly, 'YES');
  assert.equal(flattenOrderPayload?.side, 'sell');
});

// ---------------------------------------------------------------------------
// 8. BitgetTradeClient: Reconciliation Mismatch Halts & Disarms LIVE
// ---------------------------------------------------------------------------
test('reconciliation mismatch halts execution and disarms LIVE mode', async () => {
  resetEnv({
    LIVE_TRADING_ENABLED: 'true',
    BITGET_LIVE_API_KEY: 'mock-live-key-12345678',
    BITGET_LIVE_API_SECRET: 'mock-live-secret-12345678',
    BITGET_LIVE_API_PASSPHRASE: 'mock-pass-1234',
  });

  armLiveTrading('ENABLE LIVE TRADING', { passed: true });
  setExecutionMode('LIVE');
  assert.equal(isLiveArmed(), true);

  // Exchange returns an unknown position that VT2 did not place
  const mockFetch = async (url) => {
    if (String(url).includes('/api/v2/mix/position/all-position')) {
      return {
        ok: true,
        json: async () => ({
          code: '00000',
          data: [
            { symbol: 'BTCUSDT', total: '0.5', holdSide: 'long' },
          ],
        }),
      };
    }
    return { ok: true, json: async () => ({ code: '00000', data: {} }) };
  };

  const client = new BitgetTradeClient('LIVE', {
    apiKey: 'mock-live-key-12345678',
    apiSecret: 'mock-live-secret-12345678',
    passphrase: 'mock-pass-1234',
    fetch: mockFetch,
    allowUnarmedForTesting: true,
  });

  const rec = await client.reconcile();
  assert.equal(rec.reconciled, false);
  assert.equal(rec.halted, true);
  assert.equal(client.isHalted, true);

  // Must disarm LIVE mode
  assert.equal(isLiveArmed(), false);
  assert.equal(getCurrentMode(), 'PAPER');

  // Any subsequent order attempt throws EXECUTION_HALTED
  await assert.rejects(
    async () => client.placeOrderWithProtection({ symbol: 'BTCUSDT', side: 'LONG', quantity: 0.001 }),
    (err) => err.code === 'EXECUTION_HALTED'
  );
});

// ---------------------------------------------------------------------------
// 9. BitgetTradeClient: Kill Switch Cancels and Flattens
// ---------------------------------------------------------------------------
test('kill switch cancels pending orders, flattens open positions, and disarms', async () => {
  resetEnv({
    LIVE_TRADING_ENABLED: 'true',
    BITGET_LIVE_API_KEY: 'mock-live-key-12345678',
    BITGET_LIVE_API_SECRET: 'mock-live-secret-12345678',
    BITGET_LIVE_API_PASSPHRASE: 'mock-pass-1234',
  });
  armLiveTrading('ENABLE LIVE TRADING', { passed: true });

  const actions = [];
  const mockFetch = async (url, options = {}) => {
    const s = String(url);
    if (s.includes('/api/v2/mix/order/orders-pending')) {
      return {
        ok: true,
        json: async () => ({
          code: '00000',
          data: [{ symbol: 'BTCUSDT', orderId: 'open-ord-1' }],
        }),
      };
    }
    if (s.includes('/api/v2/mix/order/cancel-order')) {
      actions.push('cancel-order');
      return { ok: true, json: async () => ({ code: '00000', data: {} }) };
    }
    if (s.includes('/api/v2/mix/position/all-position')) {
      return {
        ok: true,
        json: async () => ({
          code: '00000',
          data: [{ symbol: 'BTCUSDT', total: '0.1', holdSide: 'long' }],
        }),
      };
    }
    if (s.includes('/api/v2/mix/order/place-order')) {
      actions.push('flatten-position');
      return { ok: true, json: async () => ({ code: '00000', data: {} }) };
    }
    return { ok: true, json: async () => ({ code: '00000', data: {} }) };
  };

  const client = new BitgetTradeClient('LIVE', {
    apiKey: 'mock-live-key-12345678',
    apiSecret: 'mock-live-secret-12345678',
    passphrase: 'mock-pass-1234',
    fetch: mockFetch,
    allowUnarmedForTesting: true,
  });

  const res = await client.killSwitch();
  assert.equal(res.ordersCancelled, 1);
  assert.equal(res.positionsFlattened, 1);
  assert.ok(actions.includes('cancel-order'));
  assert.ok(actions.includes('flatten-position'));
  assert.equal(isLiveArmed(), false);
});

// ---------------------------------------------------------------------------
// 10. Withdrawal & Transfer Endpoints Unreachable
// ---------------------------------------------------------------------------
test('assertNoWithdrawalEndpoint blocks any endpoint with transfer/withdraw keywords', () => {
  const forbidden = [
    '/api/v2/mix/account/withdraw',
    '/api/v2/spot/wallet/transfer',
    '/api/v2/user/subaccount/transfer',
    '/api/v2/wallet/deposit-record',
    'WITHDRAW_FUNDS',
  ];

  for (const f of forbidden) {
    assert.throws(
      () => assertNoWithdrawalEndpoint(f),
      (err) => err instanceof SafetyViolationError && err.code === 'WITHDRAWAL_OPERATION_BLOCKED'
    );
  }
});

// ---------------------------------------------------------------------------
// 11. Secret Scanner & Sanitization
// ---------------------------------------------------------------------------
test('secret scanner scrubs secrets and prevents leakage in logs and responses', () => {
  const payloadWithSecrets = {
    apiKey: 'bg_live_key_999999999999',
    apiSecret: 'very_secret_private_key_string_that_must_not_leak',
    passphrase: 'super_secret_passphrase',
    accessSign: 'c2lnbmF0dXJlX2Jhc2U2NF9leGFtcGxl',
    safeField: 'BTCUSDT',
  };

  const redacted = redactSecrets(payloadWithSecrets);
  assert.equal(redacted.apiKey, '[REDACTED]');
  assert.equal(redacted.apiSecret, '[REDACTED]');
  assert.equal(redacted.passphrase, '[REDACTED]');
  assert.equal(redacted.safeField, 'BTCUSDT');

  // Verify formatDryRunOrder masks credentials
  const client = new BitgetTradeClient('DEMO', {
    apiKey: 'bg_demo_api_key_12345',
    apiSecret: 'bg_demo_secret_67890_abcdef',
    passphrase: 'passphrase123',
    allowUnarmedForTesting: true,
  });

  const dryRun = client.formatDryRunOrder({
    symbol: 'BTCUSDT',
    side: 'LONG',
    quantity: 0.001,
    entryPrice: 50000,
  });

  assert.equal(dryRun.dryRun, true);
  assert.ok(dryRun.request.headers['ACCESS-KEY'].includes('****'));
  assert.equal(dryRun.request.headers['ACCESS-PASSPHRASE'], '[REDACTED]');
  assert.ok(!dryRun.request.headers['ACCESS-SIGN'].includes('very_secret'));
  assert.equal(dryRun.orderSummary.maxLossInDollars, 1); // $50000 * 0.02 * 0.001 = $1
});

// ---------------------------------------------------------------------------
// 12. Demo Headers & Symbols vs Live Headers & Symbols
// ---------------------------------------------------------------------------
test('demo requests carry paptrading header and demo symbols, live requests never carry it', () => {
  const demoClient = new BitgetTradeClient('DEMO', {
    apiKey: 'demo-key-12345678',
    apiSecret: 'demo-secret-12345678',
    passphrase: 'demo-passphrase',
    allowUnarmedForTesting: true,
  });

  const liveClient = new BitgetTradeClient('LIVE', {
    apiKey: 'live-key-12345678',
    apiSecret: 'live-secret-12345678',
    passphrase: 'live-passphrase',
    allowUnarmedForTesting: true,
  });

  // Demo symbols mapped
  assert.equal(demoClient.resolveExchangeSymbol('BTCUSDT'), 'SBTCSUSDT');
  assert.equal(demoClient.resolveExchangeSymbol('ETHUSDT'), 'SETHSUSDT');
  assert.equal(demoClient.resolveExchangeSymbol('XRPUSDT'), 'SXRPSUSDT');

  // Equities in demo throw informative error
  assert.throws(
    () => demoClient.resolveExchangeSymbol('SPYUSDT'),
    (err) => err.code === 'EQUITY_DEMO_UNAVAILABLE' && err.message.includes('Equities: PAPER only')
  );

  // Live client keeps standard symbol
  assert.equal(liveClient.resolveExchangeSymbol('BTCUSDT'), 'BTCUSDT');
  assert.equal(liveClient.resolveExchangeSymbol('SPYUSDT'), 'SPYUSDT');

  // Dry run checks header
  const demoDry = demoClient.formatDryRunOrder({ symbol: 'BTCUSDT', side: 'LONG', quantity: 0.01 });
  assert.equal(demoDry.request.headers['paptrading'], '1');

  const liveDry = liveClient.formatDryRunOrder({ symbol: 'BTCUSDT', side: 'LONG', quantity: 0.01 });
  assert.equal(liveDry.request.headers['paptrading'], undefined);
});

// ---------------------------------------------------------------------------
// 13. Full Server API Integration
// ---------------------------------------------------------------------------
test('server mode endpoints enforce allow-list, arming, preview, and preflight', async () => {
  resetEnv();
  const server = new VT2Server({ port: 0, dbPath: ':memory:', forceFixtureMode: true });
  await server.start();
  const address = server.server.address();
  const baseUrl = `http://127.0.0.1:${address.port}`;

  try {
    // 1. GET /api/mode returns defaults
    const getRes = await fetch(`${baseUrl}/api/mode`);
    assert.equal(getRes.status, 200);
    const getMode = await getRes.json();
    assert.equal(getMode.mode, 'PAPER');
    assert.equal(getMode.isLiveArmed, false);
    assert.ok(getMode.limits.maxNotionalPerOrderUsd === 50);

    // 2. POST /api/mode with lowercase or un-armed live returns 403
    const liveFail = await fetch(`${baseUrl}/api/mode`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-control-token': server.controlToken },
      body: JSON.stringify({ mode: 'live' }),
    });
    assert.equal(liveFail.status, 403);
    const liveFailData = await liveFail.json();
    assert.equal(liveFailData.error, 'MAINNET_EXECUTION_BLOCKED');

    // 3. POST /api/mode/arm-live without flag returns 403
    const armFail = await fetch(`${baseUrl}/api/mode/arm-live`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-control-token': server.controlToken },
      body: JSON.stringify({ confirmationPhrase: 'ENABLE LIVE TRADING' }),
    });
    assert.equal(armFail.status, 403);

    // 4. POST /api/orders/preview calculates dollar loss and cap validation
    const prevRes = await fetch(`${baseUrl}/api/orders/preview`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        symbol: 'BTCUSDT',
        side: 'LONG',
        entryPrice: 60000,
        quantity: 0.0005, // $30 notional
        stopLoss: 59000,
      }),
    });
    assert.equal(prevRes.status, 200);
    const prevData = await prevRes.json();
    assert.equal(prevData.symbol, 'BTCUSDT');
    assert.equal(prevData.notionalUsd, 30);
    assert.equal(prevData.maxDollarLoss, 0.5); // (60000 - 59000) * 0.0005 = $0.50
    assert.equal(prevData.capCheck.allowed, true);

    // 5. POST /api/exchange/reconcile in PAPER mode returns paper confirmation
    const recRes = await fetch(`${baseUrl}/api/exchange/reconcile`, { method: 'POST' });
    assert.equal(recRes.status, 200);
    const recData = await recRes.json();
    assert.equal(recData.mode, 'PAPER');

  } finally {
    await server.stop();
    resetEnv();
  }
});
