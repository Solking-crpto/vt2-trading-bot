import test from 'node:test';
import assert from 'node:assert/strict';
import {
  calculateSMA,
  calculateEMA,
  calculateRSI,
  calculateATR,
  calculateRelativeVolume,
  computeIndicators,
} from '../src/indicators/index.js';
import { StrategyEngine } from '../src/strategy/engine.js';
import { DEFAULT_MARKET_FIXTURES, generateCandleSeries } from '../src/data/market-fixtures.js';

test('calculates SMA correctly with null padding for initial periods', () => {
  const values = [10, 20, 30, 40, 50];
  const sma3 = calculateSMA(values, 3);
  assert.equal(sma3[0], null);
  assert.equal(sma3[1], null);
  assert.equal(sma3[2], 20); // (10 + 20 + 30) / 3 = 20
  assert.equal(sma3[3], 30); // (20 + 30 + 40) / 3 = 30
  assert.equal(sma3[4], 40); // (30 + 40 + 50) / 3 = 40
});

test('calculates EMA with initial SMA seeding', () => {
  const values = [10, 11, 12, 13, 14, 15];
  const ema3 = calculateEMA(values, 3);
  assert.equal(ema3[0], null);
  assert.equal(ema3[1], null);
  assert.equal(ema3[2], 11); // Initial SMA of first 3
  assert.ok(ema3[3] > 11 && ema3[3] < 14);
});

test('calculates RSI bounded between 0 and 100', () => {
  const upwardCloses = Array.from({ length: 30 }, (_, i) => 100 + i * 2);
  const rsi = calculateRSI(upwardCloses, 14);
  const lastRsi = rsi[rsi.length - 1];
  assert.ok(lastRsi !== null);
  assert.ok(lastRsi >= 0 && lastRsi <= 100);
  assert.ok(lastRsi > 70, `Expected strong bullish RSI, got ${lastRsi}`);
});

test('calculates ATR correctly from candle high/low/close', () => {
  const candles = Array.from({ length: 30 }, (_, i) => ({
    high: 105 + i,
    low: 95 + i,
    close: 100 + i,
  }));
  const atr = calculateATR(candles, 14);
  const lastAtr = atr[atr.length - 1];
  assert.ok(lastAtr !== null);
  assert.ok(lastAtr >= 10);
});

test('calculates relative volume and identifies volume spikes', () => {
  const volumes = [100, 100, 100, 100, 100, 100, 100, 100, 100, 100, 100, 100, 100, 100, 100, 100, 100, 100, 100, 100, 250];
  const rvol = calculateRelativeVolume(volumes, 20, 1.5);
  const last = rvol[rvol.length - 1];
  assert.equal(last.avgVolume, 100);
  assert.equal(last.relativeVolume, 2.5);
  assert.equal(last.isSpike, true);
});

test('strategy engine scans universe and produces qualified or rejected outputs with explicit reasons', () => {
  const engine = new StrategyEngine();
  const scanResult = engine.scanUniverse(DEFAULT_MARKET_FIXTURES);

  assert.ok(Array.isArray(scanResult.qualified));
  assert.ok(Array.isArray(scanResult.rejected));
  assert.ok(scanResult.btcContext !== null);

  // Every rejected record must have a rejectionReason and explanation
  for (const item of scanResult.rejected) {
    assert.ok(item.rejectionReason, 'Missing rejectionReason on rejected setup');
    assert.ok(item.explanation, 'Missing explanation on rejected setup');
  }

  // Every qualified record must have rewardRisk >= 1.5
  for (const item of scanResult.qualified) {
    assert.ok(item.rewardRisk.netRR >= 1.5, `Qualified setup netRR must be >= 1.5, got ${item.rewardRisk.netRR}`);
    assert.ok(item.score > 0);
    assert.ok(['LONG', 'SHORT'].includes(item.side));
  }
});

test('strategy engine rejects setup when candles are insufficient', () => {
  const engine = new StrategyEngine();
  const shortCandles = {
    '4h': generateCandleSeries({ startPrice: 100, count: 10, intervalMinutes: 240 }),
    '15m': generateCandleSeries({ startPrice: 100, count: 10, intervalMinutes: 15 }),
    '5m': generateCandleSeries({ startPrice: 100, count: 10, intervalMinutes: 5 }),
  };

  const result = engine.analyzeInstrument({
    symbol: 'BTCUSDT',
    timeframeCandles: shortCandles,
  });

  assert.equal(result.qualified, false);
  assert.equal(result.rejectionReason, 'INSUFFICIENT_CANDLE_DATA');
});
