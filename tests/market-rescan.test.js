import test from 'node:test';
import assert from 'node:assert/strict';
import { StrategyEngine } from '../src/strategy/engine.js';
import { DEFAULT_MARKET_FIXTURES } from '../src/data/market-fixtures.js';

test('market rescan with modified candle data dynamically alters opportunity rankings', () => {
  const strategy = new StrategyEngine();

  // Create deep clone of fixtures for Universe 1
  const universe1 = JSON.parse(JSON.stringify(DEFAULT_MARKET_FIXTURES));

  // Run initial scan
  const scan1 = strategy.scanUniverse(universe1);
  assert.ok(scan1.qualified.length > 0, 'Scan 1 should produce at least one qualified setup');
  const initialTopSymbol = scan1.qualified[0].symbol;
  const initialTopScore = scan1.qualified[0].score;

  // Create Universe 2 with changed market dynamics:
  // Elevate another symbol (e.g. SOLUSDT) with a massive 5m volume spike and favorable structure
  const universe2 = JSON.parse(JSON.stringify(DEFAULT_MARKET_FIXTURES));
  const competitorSymbol = initialTopSymbol === 'ETHUSDT' ? 'SOLUSDT' : 'ETHUSDT';

  // Modify competitor's 5m candles to simulate an explosive volume spike
  const competitorCandles5m = universe2[competitorSymbol].candles['5m'];
  for (let i = competitorCandles5m.length - 5; i < competitorCandles5m.length; i++) {
    competitorCandles5m[i].volume = competitorCandles5m[i].volume * 8.0; // 8x volume explosion
    competitorCandles5m[i].close = competitorCandles5m[i].close * 1.015;
  }

  // Depress the initial winner's 5m volume
  const initialWinnerCandles5m = universe2[initialTopSymbol].candles['5m'];
  for (let i = initialWinnerCandles5m.length - 5; i < initialWinnerCandles5m.length; i++) {
    initialWinnerCandles5m[i].volume = competitorCandles5m[0].volume * 0.1;
  }

  // Run second scan (simulating rescan after market tick)
  const scan2 = strategy.scanUniverse(universe2);
  assert.ok(scan2.qualified.length > 0, 'Scan 2 should produce qualified setups');

  // Verify ranking or scores have changed
  const newTopSymbol = scan2.qualified[0].symbol;
  const newTopScore = scan2.qualified[0].score;

  const rankingChanged = newTopSymbol !== initialTopSymbol;
  const scoresChanged = scan2.qualified.find(q => q.symbol === competitorSymbol)?.score !==
                        scan1.qualified.find(q => q.symbol === competitorSymbol)?.score;

  assert.ok(
    rankingChanged || scoresChanged,
    `Rescan must reflect altered market conditions. Initial top: ${initialTopSymbol} (${initialTopScore}), New top: ${newTopSymbol} (${newTopScore})`
  );
});

test('market rescan properly filters and archives disqualified setups with rejection reasons', () => {
  const strategy = new StrategyEngine();
  const universe = JSON.parse(JSON.stringify(DEFAULT_MARKET_FIXTURES));

  // Break directional alignment for XRPUSDT
  const xrp4h = universe['XRPUSDT'].candles['4h'];
  const xrp15m = universe['XRPUSDT'].candles['15m'];
  // Set 4h price way below EMA and 15m price way above EMA (divergent consolidation)
  xrp4h[xrp4h.length - 1].close = 0.20;
  xrp15m[xrp15m.length - 1].close = 0.90;

  const result = strategy.scanUniverse(universe);
  const xrpRejection = result.rejected.find(r => r.symbol === 'XRPUSDT');

  assert.ok(xrpRejection, 'XRPUSDT should be rejected due to broken alignment');
  assert.ok(xrpRejection.rejectionReason, 'Rejection must have an explicit reason code');
  assert.ok(xrpRejection.explanation, 'Rejection must have an explanation');
});
