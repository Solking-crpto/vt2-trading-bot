import test from 'node:test';
import assert from 'node:assert/strict';
import { BitgetAdapter, assertCandleIntegrity } from '../src/adapters/bitget-adapter.js';

test('assertCandleIntegrity detects and throws on descending or duplicate timestamps', () => {
  // Valid ascending series
  const valid = [
    { timestamp: 1000, close: 10 },
    { timestamp: 2000, close: 11 },
    { timestamp: 3000, close: 12 },
  ];
  assert.doesNotThrow(() => assertCandleIntegrity(valid, '15m'));

  // Duplicate timestamp
  const duplicate = [
    { timestamp: 1000, close: 10 },
    { timestamp: 2000, close: 11 },
    { timestamp: 2000, close: 12 },
  ];
  assert.throws(
    () => assertCandleIntegrity(duplicate, '15m'),
    /CANDLE_INTEGRITY_VIOLATION: Duplicate candle timestamp 2000/
  );

  // Reversed / descending timestamp
  const reversed = [
    { timestamp: 3000, close: 12 },
    { timestamp: 2000, close: 11 },
    { timestamp: 1000, close: 10 },
  ];
  assert.throws(
    () => assertCandleIntegrity(reversed, '15m'),
    /CANDLE_INTEGRITY_VIOLATION: Non-ascending \/ reversed candles detected/
  );
});

test('live Bitget candles are strictly ascending, unique, and fresh within one interval', async () => {
  const adapter = new BitgetAdapter({ forceFixtureMode: false });
  try {
    const symbols = ['SPYUSDT', 'BTCUSDT'];

    for (const sym of symbols) {
      const res = await adapter.getCandles(sym, '15m', 60, true);
      assert.equal(res.isLive, true, `Expected live Bitget feed for ${sym}`);
      assert.ok(Array.isArray(res.candles), `Expected candles array for ${sym}`);
      assert.ok(res.candles.length >= 10, `Expected at least 10 candles for ${sym}`);

      const candles = res.candles;
      for (let i = 1; i < candles.length; i++) {
        assert.ok(
          candles[i].timestamp > candles[i - 1].timestamp,
          `Candle at index ${i} (${candles[i].timestamp}) must be strictly greater than index ${i - 1} (${candles[i - 1].timestamp})`
        );
      }

      const lastCandle = candles[candles.length - 1];
      const now = Date.now();
      const intervalMs = 15 * 60 * 1000;
      const ageMs = now - lastCandle.timestamp;

      // The current open candle must have opened within the last 15 minutes (plus small network/clock buffer)
      assert.ok(
        ageMs >= 0,
        `Last candle timestamp cannot be in the future (${ageMs}ms ahead)`
      );
      assert.ok(
        ageMs <= intervalMs + 60000,
        `Last candle timestamp is stale: ${ageMs}ms ago (max allowed: ${intervalMs + 60000}ms)`
      );

      // Call integrity assertion directly
      assert.doesNotThrow(() => assertCandleIntegrity(candles, '15m'));
    }
  } finally {
    adapter.close();
  }
});
