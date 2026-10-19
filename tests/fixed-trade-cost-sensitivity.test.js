import test from 'node:test';
import assert from 'node:assert/strict';
import { computeFixedTradeListSensitivity } from '../src/strategy/v2/v2-portfolio-engine.js';

test('fixed-trade cost sensitivity: increasing slippage strictly decreases net P&L for every trade', () => {
  // Diverse sample trade list with long, short, winning, and losing trades
  const sampleTrades = [
    {
      tradeId: 't-1',
      symbol: 'NVDAUSDT',
      side: 'LONG',
      rawEntryPrice: 200.0,
      rawExitPrice: 205.0,
      quantity: 10,
      fundingPaid: 0.5,
      isMakerEntry: false,
      isMakerExit: false,
    },
    {
      tradeId: 't-2',
      symbol: 'TSLAUSDT',
      side: 'SHORT',
      rawEntryPrice: 300.0,
      rawExitPrice: 290.0,
      quantity: 5,
      fundingPaid: 0.2,
      isMakerEntry: false,
      isMakerExit: false,
    },
    {
      tradeId: 't-3',
      symbol: 'AAPLUSDT',
      side: 'LONG',
      rawEntryPrice: 150.0,
      rawExitPrice: 147.0,
      quantity: 20,
      fundingPaid: 0.8,
      isMakerEntry: false,
      isMakerExit: false,
    },
    {
      tradeId: 't-4',
      symbol: 'MSFTUSDT',
      side: 'SHORT',
      rawEntryPrice: 400.0,
      rawExitPrice: 408.0,
      quantity: 8,
      fundingPaid: 1.0,
      isMakerEntry: false,
      isMakerExit: false,
    },
  ];

  const sensitivity = computeFixedTradeListSensitivity(sampleTrades, {
    baseSlippageRate: 0.0002, // 2 bps base
    baseTakerFeeRate: 0.0006,
    multipliers: [0, 1, 2],
  });

  const x0 = sensitivity['x0'];
  const x1 = sensitivity['x1'];
  const x2 = sensitivity['x2'];

  assert.ok(x0, 'x0 results must exist');
  assert.ok(x1, 'x1 results must exist');
  assert.ok(x2, 'x2 results must exist');

  // 1. Portfolio-level strict monotonic decrease: Net(x0) > Net(x1) > Net(x2)
  assert.ok(
    x0.netPnl > x1.netPnl,
    `Portfolio Net P&L at x0 ($${x0.netPnl}) must be strictly greater than x1 ($${x1.netPnl})`
  );
  assert.ok(
    x1.netPnl > x2.netPnl,
    `Portfolio Net P&L at x1 ($${x1.netPnl}) must be strictly greater than x2 ($${x2.netPnl})`
  );

  // 2. Trade-level strict monotonic decrease for every single trade
  for (let i = 0; i < sampleTrades.length; i++) {
    const t0 = x0.trades[i];
    const t1 = x1.trades[i];
    const t2 = x2.trades[i];

    assert.ok(
      t0.netPnl > t1.netPnl,
      `Trade ${t0.tradeId} (${t0.symbol} ${t0.side}): Net P&L at x0 ($${t0.netPnl}) must be strictly greater than x1 ($${t1.netPnl})`
    );
    assert.ok(
      t1.netPnl > t2.netPnl,
      `Trade ${t1.tradeId} (${t1.symbol} ${t1.side}): Net P&L at x1 ($${t1.netPnl}) must be strictly greater than x2 ($${t2.netPnl})`
    );

    // Slippage cost strictly increases
    assert.ok(
      t0.slippage < t1.slippage,
      `Trade ${t0.tradeId}: Slippage at x0 must be less than x1`
    );
    assert.ok(
      t1.slippage < t2.slippage,
      `Trade ${t1.tradeId}: Slippage at x1 must be less than x2`
    );
  }
});
