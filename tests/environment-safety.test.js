import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CURRENT_ENVIRONMENT,
  isMainnetExecutionAllowed,
  assertMainnetExecutionBlocked,
  validateExecutionMode,
  SafetyViolationError,
} from '../src/environment.js';

test('VT2 environment defaults to PAPER mode', () => {
  assert.equal(CURRENT_ENVIRONMENT, 'PAPER');
});

test('isMainnetExecutionAllowed strictly returns false', () => {
  assert.equal(isMainnetExecutionAllowed(), false);
});

test('assertMainnetExecutionBlocked throws SafetyViolationError when MAINNET is targeted', () => {
  assert.throws(
    () => assertMainnetExecutionBlocked('MAINNET'),
    (err) => {
      return err instanceof SafetyViolationError &&
             err.code === 'MAINNET_EXECUTION_BLOCKED' &&
             err.message.includes('Live Mainnet execution is strictly disabled');
    }
  );
});

test('validateExecutionMode approves valid PAPER orders', () => {
  const result = validateExecutionMode({
    environment: 'PAPER',
    symbol: 'BTCUSDT',
    side: 'LONG',
  });
  assert.equal(result, true);
});

test('validateExecutionMode blocks and rejects MAINNET requests', () => {
  assert.throws(
    () => validateExecutionMode({ environment: 'MAINNET', symbol: 'BTCUSDT' }),
    (err) => err.code === 'MAINNET_EXECUTION_BLOCKED'
  );
});

test('validateExecutionMode blocks unconfigured TESTNET requests', () => {
  assert.throws(
    () => validateExecutionMode({ environment: 'TESTNET', symbol: 'BTCUSDT' }),
    (err) => err.code === 'TESTNET_UNCONFIGURED'
  );
});
