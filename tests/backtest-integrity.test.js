import test from 'node:test';
import assert from 'node:assert/strict';
import { BacktestEngine } from '../src/backtest/engine.js';
import { generateCandleSeries } from '../src/data/market-fixtures.js';

test('runs backtest with chronological walk-forward execution', () => {
  const candles = generateCandleSeries({
    startPrice: 60000,
    count: 100,
    intervalMinutes: 15,
    volatility: 0.008,
    trendBias: 0.0004,
  });

  const engine = new BacktestEngine();
  const report = engine.run({
    symbol: 'BTCUSDT',
    candles,
  });

  assert.equal(report.symbol, 'BTCUSDT');
  assert.equal(report.periodCandles, 100);
  assert.ok(typeof report.winRate === 'number');
  assert.ok(typeof report.netPnl === 'number');
  assert.ok(typeof report.maxDrawdownPercent === 'number');
  assert.ok(Array.isArray(report.trades));

  // Verify chronological ordering of trades
  for (let i = 1; i < report.trades.length; i++) {
    assert.ok(
      report.trades[i].entryTime >= report.trades[i - 1].exitTime,
      'Trades must execute chronologically without overlap (max 1 position)'
    );
  }
});

test('resolves ambiguous candle conservatively by assuming stop loss hit first', () => {
  const engine = new BacktestEngine();

  // Create 55 initial warmup candles
  const initialCandles = generateCandleSeries({
    startPrice: 60000,
    count: 55,
    intervalMinutes: 15,
    volatility: 0.002,
    trendBias: 0.0002,
  });

  const lastPrice = initialCandles[initialCandles.length - 1].close;

  // Add an extreme spike candle where high breaches target and low breaches stop
  const ambiguousCandle = {
    timestamp: initialCandles[initialCandles.length - 1].timestamp + (15 * 60 * 1000),
    open: lastPrice,
    high: lastPrice * 1.05, // huge upside
    low: lastPrice * 0.95,  // huge downside
    close: lastPrice,
    volume: 5000,
    isClosed: true,
  };

  const candles = [...initialCandles, ambiguousCandle];

  const report = engine.run({
    symbol: 'BTCUSDT',
    candles,
  });

  const ambiguousTrades = report.trades.filter(t => t.exitReason.includes('AMBIGUOUS'));
  for (const t of ambiguousTrades) {
    assert.ok(t.pnl < 0, 'Ambiguous trade must conservatively assume loss');
  }
});

test('throws error if candle series is shorter than minimum warmup', () => {
  const shortCandles = generateCandleSeries({
    startPrice: 60000,
    count: 20,
    intervalMinutes: 15,
  });

  const engine = new BacktestEngine();
  assert.throws(
    () => engine.run({ symbol: 'BTCUSDT', candles: shortCandles }),
    /Insufficient candle history/
  );
});
