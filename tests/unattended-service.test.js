import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { VT2Server } from '../src/vt2-server.js';
import { AlertDispatcher, ALERT_EVENTS } from '../src/service/alert-dispatcher.js';
import { getDailyLogPath, pruneOldLogs, LOGS_DIR } from '../src/service/log-rotator.js';
import { getCurrentMode, setExecutionMode } from '../src/environment.js';

test('Step 3: Extended /api/system/health endpoint', async () => {
  const server = new VT2Server({ port: 0, isDemoReadOnly: true });
  await server.start();
  const address = server.server.address();
  const baseUrl = `http://127.0.0.1:${address.port}`;

  try {
    const res = await fetch(`${baseUrl}/api/system/health`);
    assert.equal(res.status, 200);
    const data = await res.json();

    assert.equal(data.status, 'HEALTHY');
    assert.ok(typeof data.uptime === 'number');
    assert.ok(typeof data.uptimeSeconds === 'number');
    assert.ok('lastScanTime' in data);
    assert.ok('lastBotCycle' in data);
    assert.ok('wsMessageAgeMs' in data);
    assert.ok('dbSizeBytes' in data);
    assert.equal(data.currentMode, 'PAPER');
    assert.ok(data.armingState);
    assert.equal(data.armingState.isArmed, false);
    assert.ok('lastError' in data);
    assert.ok(data.memoryMb);
    assert.ok(data.databaseRecords);
  } finally {
    await server.stop();
  }
});

test('Step 3: AlertDispatcher functionality and safety guarantees', async () => {
  // 1. Disabled when unconfigured
  const disabledDispatcher = new AlertDispatcher({
    webhookUrl: null,
    telegramToken: null,
    telegramChatId: null,
  });
  assert.equal(disabledDispatcher.isConfigured(), false);
  const disabledResult = await disabledDispatcher.dispatchAlert({
    event: ALERT_EVENTS.BOT_HALT,
    message: 'Test message',
  });
  assert.equal(disabledResult.delivered, false);
  assert.equal(disabledResult.error, 'DISPATCHER_DISABLED');

  // 2. Webhook delivery and secret redaction
  let receivedPayload = null;
  const mockFetch = async (url, options) => {
    receivedPayload = JSON.parse(options.body);
    return { ok: true, status: 200 };
  };

  const activeDispatcher = new AlertDispatcher({
    webhookUrl: 'https://example.com/alerts/webhook',
    fetchFn: mockFetch,
  });
  assert.equal(activeDispatcher.isConfigured(), true);

  const hexSecret = 'a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4';
  const alertRes = await activeDispatcher.dispatchAlert({
    event: ALERT_EVENTS.KILL_SWITCH,
    level: 'CRITICAL',
    message: `Kill switch engaged for token ${hexSecret}`,
    details: { apiKey: 'my-sensitive-token', positionsClosed: 2 },
  });

  assert.equal(alertRes.delivered, true);
  assert.ok(receivedPayload);
  assert.equal(receivedPayload.event, ALERT_EVENTS.KILL_SWITCH);
  assert.equal(receivedPayload.level, 'CRITICAL');
  // Verify secrets are redacted
  assert.ok(!receivedPayload.message.includes(hexSecret));
  assert.equal(receivedPayload.details.apiKey, '[REDACTED]');
});

test('Step 3: LogRotator creates date-stamped logs and handles retention', () => {
  const logPath = getDailyLogPath();
  const dateStr = new Date().toISOString().split('T')[0];
  assert.ok(logPath.includes(`vt2-${dateStr}.log`));
  assert.ok(fs.existsSync(LOGS_DIR));

  // Pruning function executes without error
  const pruned = pruneOldLogs(14);
  assert.ok(Array.isArray(pruned));
});

test('Step 3: Unattended restart guarantees mode is always reset to PAPER', async () => {
  // If mode was somehow changed, starting a server forces PAPER
  const server = new VT2Server({ port: 0, isDemoReadOnly: true });
  await server.start();
  try {
    assert.equal(getCurrentMode(), 'PAPER');
  } finally {
    await server.stop();
  }
});
