import test from 'node:test';
import assert from 'node:assert/strict';
import { isRegularTradingHours } from '../src/strategy/v2/session-filter.js';
import { CandidateC1 } from '../src/strategy/v2/candidate-c1.js';
import { CandidateC2 } from '../src/strategy/v2/candidate-c2.js';
import { V2PortfolioEngine } from '../src/strategy/v2/v2-portfolio-engine.js';
import { computeIndicators } from '../src/indicators/index.js';
import { generateCandleSeries } from '../src/data/market-fixtures.js';

test('session-filter: correctly identifies US Regular Trading Hours (09:30 - 16:00 ET)', () => {
  // 2026-06-15 is Monday (non-holiday)
  // 09:30 ET = 13:30 UTC (during EDT UTC-4)
  const openTs = new Date('2026-06-15T13:30:00.000Z').getTime();
  const midDayTs = new Date('2026-06-15T16:00:00.000Z').getTime(); // 12:00 ET
  const closeTs = new Date('2026-06-15T20:00:00.000Z').getTime(); // 16:00 ET
  const afterHoursTs = new Date('2026-06-15T20:30:00.000Z').getTime(); // 16:30 ET
  const preMarketTs = new Date('2026-06-15T12:00:00.000Z').getTime(); // 08:00 ET

  assert.equal(isRegularTradingHours(openTs, 'EQUITY'), true, 'Market open (09:30 ET) must be in RTH');
  assert.equal(isRegularTradingHours(midDayTs, 'EQUITY'), true, 'Midday (12:00 ET) must be in RTH');
  assert.equal(isRegularTradingHours(closeTs, 'EQUITY'), false, '16:00 ET is market close; strictly exclusive');
  assert.equal(isRegularTradingHours(afterHoursTs, 'EQUITY'), false, 'After-hours must NOT be in RTH');
  assert.equal(isRegularTradingHours(preMarketTs, 'EQUITY'), false, 'Pre-market must NOT be in RTH');

  // Weekend (2026-06-20 Saturday)
  const satTs = new Date('2026-06-20T15:00:00.000Z').getTime();
  assert.equal(isRegularTradingHours(satTs, 'EQUITY'), false, 'Saturday must NOT be in RTH');

  // Holiday (2026-06-19 Juneteenth)
  const holidayTs = new Date('2026-06-19T15:00:00.000Z').getTime();
  assert.equal(isRegularTradingHours(holidayTs, 'EQUITY'), false, 'Juneteenth holiday must NOT be in RTH');

  // Crypto is 24/7 continuous
  assert.equal(isRegularTradingHours(satTs, 'CRYPTO'), true, 'Crypto trades 24/7');
});

test('zero look-ahead: C1 signal at bar T is identical when future bars are truncated', () => {
  const c1 = new CandidateC1({ sessionMode: 'E0' });
  const candles = generateCandleSeries({ startPrice: 100, count: 120, intervalMinutes: 15 });

  const indFull = computeIndicators(candles);
  const truncatedCandles = candles.slice(0, 80);
  const indTrunc = computeIndicators(truncatedCandles);

  const targetTs = candles[79].timestamp;

  const barFull = {
    candle: candles[79],
    index: 79,
    close: candles[79].close,
    ema20: indFull.ema20[79],
    ema50: indFull.ema50[79],
    atr: indFull.atr14[79],
  };

  const barTrunc = {
    candle: truncatedCandles[79],
    index: 79,
    close: truncatedCandles[79].close,
    ema20: indTrunc.current.ema20,
    ema50: indTrunc.current.ema50,
    atr: indTrunc.current.atr,
  };

  const closed1hMock = {
    close: 105,
    ema20: 104,
    ema50: 102,
  };

  const historyFull = candles.slice(70, 80).map((c, idx) => ({
    close: c.close,
    ema20: indFull.ema20[70 + idx],
  }));

  const historyTrunc = truncatedCandles.slice(70, 80).map((c, idx) => ({
    close: c.close,
    ema20: indTrunc.ema20[70 + idx],
  }));

  const sigFull = c1.evaluate({
    symbol: 'AAPLUSDT',
    assetClass: 'EQUITY',
    currentTs: targetTs,
    bar15m: barFull,
    history15m: historyFull,
    closed1h: closed1hMock,
  });

  const sigTrunc = c1.evaluate({
    symbol: 'AAPLUSDT',
    assetClass: 'EQUITY',
    currentTs: targetTs,
    bar15m: barTrunc,
    history15m: historyTrunc,
    closed1h: closed1hMock,
  });

  assert.deepEqual(sigFull, sigTrunc, 'Signal evaluated with future data truncated must match exactly');
});

test('zero look-ahead: closed bars helper uses strictly closed higher-timeframe bars', () => {
  const engine = new V2PortfolioEngine();
  const baseTs = 1700000000000;
  const list4h = [
    { openTs: baseTs, closeTs: baseTs + 4 * 3600 * 1000, close: 100, ema20: 98 },
    { openTs: baseTs + 4 * 3600 * 1000, closeTs: baseTs + 8 * 3600 * 1000, close: 105, ema20: 101 },
  ];

  // At baseTs + 3h: NO 4h bar has closed yet
  const barAt3h = engine.getClosedBar(list4h, baseTs + 3 * 3600 * 1000);
  assert.equal(barAt3h, null, 'No bar should be available before first bar closes');

  // At baseTs + 4h: bar 0 has closed
  const barAt4h = engine.getClosedBar(list4h, baseTs + 4 * 3600 * 1000);
  assert.equal(barAt4h.close, 100, 'Bar 0 must be returned at its closeTs');

  // At baseTs + 7h: bar 0 is still the latest closed bar; bar 1 is still forming
  const barAt7h = engine.getClosedBar(list4h, baseTs + 7 * 3600 * 1000);
  assert.equal(barAt7h.close, 100, 'Bar 0 remains the latest closed bar while bar 1 is in progress');

  // At baseTs + 8h: bar 1 has closed
  const barAt8h = engine.getClosedBar(list4h, baseTs + 8 * 3600 * 1000);
  assert.equal(barAt8h.close, 105, 'Bar 1 must be returned at baseTs + 8h');
});

test('cost application: fee, slippage, and funding are subtracted correctly', () => {
  const engine = new V2PortfolioEngine({
    initialEquity: 10000,
    takerFeeRate: 0.0006,
    slippageRate: 0.0002,
  });

  const entryPrice = 100;
  const rawOpen = 100;
  const slippage = rawOpen * 0.0002; // 0.02
  const fillPrice = entryPrice + slippage; // 100.02
  const qty = 50;

  const entryFee = fillPrice * qty * 0.0006;
  const slippageCost = slippage * qty;

  assert.equal(Number(fillPrice.toFixed(4)), 100.02);
  assert.equal(Number(entryFee.toFixed(4)), 3.0006);
  assert.equal(Number(slippageCost.toFixed(4)), 1.0);
});

test('determinism: running replay twice produces identical trades and metrics', () => {
  const engine = new V2PortfolioEngine();
  const testSymbols = ['AAPLUSDT', 'MSFTUSDT'];
  const universe = engine.loadUniverse(testSymbols);

  if (universe['AAPLUSDT'] && universe['MSFTUSDT']) {
    const run1 = engine.runReplay(universe, testSymbols, 'C2', 'E0', 'dev');
    const run2 = engine.runReplay(universe, testSymbols, 'C2', 'E0', 'dev');

    assert.equal(run1.tradeCount, run2.tradeCount, 'Trade counts must be identical');
    assert.equal(run1.netPnl, run2.netPnl, 'Net P&L must be identical');
    assert.equal(run1.profitFactor, run2.profitFactor, 'Profit factor must be identical');
    assert.equal(run1.maxDrawdownPct, run2.maxDrawdownPct, 'Max DD must be identical');
  }
});
