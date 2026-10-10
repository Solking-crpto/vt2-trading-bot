import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { BitgetAuthenticatedClient } from '../src/adapters/bitget-authenticated.js';

test('BitgetAuthenticatedClient reports credential configuration safely without exposing secrets', () => {
  const unconfigured = new BitgetAuthenticatedClient({});
  assert.deepEqual(unconfigured.getCredentialStatus(), {
    hasKey: false,
    hasSecret: false,
    hasPassphrase: false,
    isConfigured: false,
  });

  const configured = new BitgetAuthenticatedClient({
    apiKey: 'bg_agent_key_12345',
    apiSecret: 'bg_agent_secret_67890',
    passphrase: 'securePassphrase123',
  });
  assert.deepEqual(configured.getCredentialStatus(), {
    hasKey: true,
    hasSecret: true,
    hasPassphrase: true,
    isConfigured: true,
  });
});

test('BitgetAuthenticatedClient generates official HMAC-SHA256 signature matching canonical standard', () => {
  const secret = 'bitget_demo_secret_key_abcdef';
  const client = new BitgetAuthenticatedClient({
    apiKey: 'test_key',
    apiSecret: secret,
    passphrase: 'test_passphrase',
  });

  const timestamp = '1710000000000';
  const method = 'GET';
  const path = '/api/v2/mix/market/contracts?productType=USDT-FUTURES';
  const body = '';

  const signature = client.generateSignature(timestamp, method, path, body);

  // Independently compute expected HMAC-SHA256 Base64
  const expectedPreHash = `${timestamp}${method}${path}${body}`;
  const expectedSig = crypto
    .createHmac('sha256', secret)
    .update(expectedPreHash)
    .digest('base64');

  assert.equal(signature, expectedSig);
  assert.ok(signature.length > 20);
});

test('BitgetAuthenticatedClient throws when generating signature without apiSecret', () => {
  const client = new BitgetAuthenticatedClient({
    apiKey: 'test_key',
  });

  assert.throws(
    () => client.generateSignature('123456789', 'GET', '/api/v2/test'),
    /BITGET_AUTH_ERROR: API secret is not configured/
  );
});

test('BitgetAuthenticatedClient rejects requests when credentials are incomplete', async () => {
  const client = new BitgetAuthenticatedClient({});
  await assert.rejects(
    async () => client.request('GET', '/api/v2/mix/account/accounts'),
    /BITGET_CREDENTIALS_MISSING/
  );
});
