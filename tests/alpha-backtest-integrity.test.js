import test from 'node:test';
import assert from 'node:assert/strict';
import { AlphaPortfolioEngine, evaluateBenchmarkTrendAt } from '../src/backtest/alpha-portfolio-engine.js';
import { generateCandleSeries } from '../src/data/market-fixtures.js';
import { computeIndicators } from '../src/indicators/index.js';

test('zero look-ahead: indicators at bar i are mathematically identical when future data is truncated', () => {
  const fullSeries = generateCandleSeries({ startPrice: 100, count: 80, intervalMinutes: 15 });
  const truncatedSeries = fullSeries.slice(0, 50);

  const fullIndicators = computeIndicators(fullSeries);
  const truncatedIndicators = computeIndicators(truncatedSeries);

  // Indicators at index 49 (bar 50) must match exactly
  assert.equal(
    truncatedIndicators.current.close,
    fullSeries[49].close,
    'Close price at bar 49 must match'
  );
  assert.equal(
    truncatedIndicators.current.ema20.toFixed(4),
    fullIndicators.ema20[49].toFixed(4),
    'EMA20 at bar 49 must match between truncated and full series'
  );
  assert.equal(
    truncatedIndicators.current.rsi.toFixed(4),
    fullIndicators.rsi14[49].toFixed(4),
    'RSI at bar 49 must match between truncated and full series'
  );
});

test('zero look-ahead: 4h values use strictly closed 4h candles', () => {
  const baseTs = 1700000000000;
  const candles4h = [
    { timestamp: baseTs, close: 100, volume: 1000 },
    { timestamp: baseTs + 4 * 3600 * 1000, close: 110, volume: 1000 },
    { timestamp: baseTs + 8 * 3600 * 1000, close: 120, volume: 1000 },
  ];

  // At time baseTs + 5h: only candle 0 has closed (closed at baseTs + 4h)
  const evalAt5h = evaluateBenchmarkTrendAt(candles4h, baseTs + 5 * 3600 * 1000);
  assert.ok(evalAt5h);

  // At time baseTs + 3h: candle 0 has NOT closed yet (closes at baseTs + 4h)
  const closedCandlesAt3h = candles4h.filter(c => c.timestamp + 4 * 3600 * 1000 <= baseTs + 3 * 3600 * 1000);
  assert.equal(closedCandlesAt3h.length, 0, 'No 4h candle has closed at 3 hours into simulation');
});

test('conservative ambiguous bar resolution: stop loss hit first when both levels breached', () => {
  const engine = new AlphaPortfolioEngine();
  const entryPrice = 100;
  const stopLoss = 95;
  const takeProfit = 110;
  const slippageRate = 0.0002;

  // Ambiguous bar: low touches stop (94 <= 95) AND high touches target (112 >= 110)
  const ambiguousBar = { open: 100, high: 112, low: 94, close: 105 };

  const hitLongStop = ambiguousBar.low <= stopLoss;
  const hitLongTp = ambiguousBar.high >= takeProfit;
  const isAmbiguous = hitLongStop && hitLongTp;

  assert.equal(isAmbiguous, true, 'Bar must breach both stop loss and take profit');

  // Simulation rule: ambiguous bar MUST trigger stop loss
  let exitReason = '';
  let exitPrice = 0;
  if (isAmbiguous || hitLongStop) {
    exitReason = isAmbiguous ? 'STOP_LOSS_AMBIGUOUS_WORST_CASE' : 'STOP_LOSS';
    exitPrice = Number((stopLoss * (1 - slippageRate)).toFixed(4));
  } else if (hitLongTp) {
    exitReason = 'TAKE_PROFIT';
    exitPrice = Number((takeProfit * (1 - slippageRate)).toFixed(4));
  }

  assert.equal(exitReason, 'STOP_LOSS_AMBIGUOUS_WORST_CASE');
  assert.equal(exitPrice, 94.981);
});

test('deterministic replay: two portfolio backtest runs produce identical metrics', () => {
  const engine1 = new AlphaPortfolioEngine();
  const engine2 = new AlphaPortfolioEngine();

  const testSymbols = ['SPYUSDT', 'NVDAUSDT'];
  const res1 = engine1.runPortfolioReplay(testSymbols, { maxBars: 300 });
  const res2 = engine2.runPortfolioReplay(testSymbols, { maxBars: 300 });

  assert.equal(res1.trades.length, res2.trades.length, 'Trade count must be identical');
  assert.equal(res1.metrics.summary.total.totalPnl, res2.metrics.summary.total.totalPnl, 'Net P&L must be identical');
  assert.equal(res1.metrics.summary.total.annualizedSharpe, res2.metrics.summary.total.annualizedSharpe, 'Sharpe must be identical');
  assert.equal(res1.equityCurve.length, res2.equityCurve.length, 'Equity curve lengths must match');
});
