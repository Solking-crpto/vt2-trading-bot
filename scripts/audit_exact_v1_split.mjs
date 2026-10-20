import { AlphaPortfolioEngine } from '../src/backtest/alpha-portfolio-engine.js';
import fs from 'fs';
import path from 'path';

const HEADLINE_SYMBOLS = [
  'SPYUSDT', 'QQQUSDT', 'NVDAUSDT', 'TSLAUSDT', 'AAPLUSDT',
  'MSFTUSDT', 'AMZNUSDT', 'PLTRUSDT', 'SOXLUSDT', 'SQQQUSDT',
  'MUUSDT', 'AMDUSDT', 'SNDKUSDT', 'SMCIUSDT', 'AVGOUSDT',
  'QCOMUSDT', 'WMTUSDT', 'COSTUSDT', 'RKLBUSDT',
];

console.log('Running AlphaPortfolioEngine on full universe...');
const engine = new AlphaPortfolioEngine();
const result = engine.runPortfolioReplay(HEADLINE_SYMBOLS, { maxBars: 14679 });

console.log('Total trades:', result.trades.length);
console.log('Metrics Costs Object:');
console.log(JSON.stringify(result.metrics.costs, null, 2));

const isTrades = result.trades.filter(t => !t.isOos);
const oosTrades = result.trades.filter(t => t.isOos);

console.log('\n=== Trade-by-Trade Sum of Fees, Slippage, Funding ===');
const sumCosts = (tradeList) => {
  let fee = 0, slip = 0, fund = 0, net = 0;
  for (const t of tradeList) {
    fee += t.fees || 0;
    slip += t.slippage || 0;
    fund += t.funding || 0;
    net += t.netPnl || 0;
  }
  return { fee, slip, fund, total: fee + slip + fund, net };
};

const isSum = sumCosts(isTrades);
const oosSum = sumCosts(oosTrades);
const totalSum = sumCosts(result.trades);

console.log(`Split Date used by Engine: 2026-09-11T15:00:00.000Z (30 days before endTs)`);
console.log(`IS Trades: ${isTrades.length}`);
console.log(`  Fees: $${isSum.fee.toFixed(2)}`);
console.log(`  Slippage: $${isSum.slip.toFixed(2)}`);
console.log(`  Funding: $${isSum.fund.toFixed(2)}`);
console.log(`  Total Cost: $${isSum.total.toFixed(2)}`);
console.log(`  Net PnL: $${isSum.net.toFixed(2)}`);

console.log(`\nOOS Trades: ${oosTrades.length}`);
console.log(`  Fees: $${oosSum.fee.toFixed(2)}`);
console.log(`  Slippage: $${oosSum.slip.toFixed(2)}`);
console.log(`  Funding: $${oosSum.fund.toFixed(2)}`);
console.log(`  Total Cost: $${oosSum.total.toFixed(2)}`);
console.log(`  Net PnL: $${oosSum.net.toFixed(2)}`);

console.log(`\nTotal Trades: ${result.trades.length}`);
console.log(`  Fees: $${totalSum.fee.toFixed(2)}`);
console.log(`  Slippage: $${totalSum.slip.toFixed(2)}`);
console.log(`  Funding: $${totalSum.fund.toFixed(2)}`);
console.log(`  Total Cost: $${totalSum.total.toFixed(2)}`);
console.log(`  Net PnL: $${totalSum.net.toFixed(2)}`);

console.log('\n=== Verification against Published Totals ($2,223.72 fees, $889.52 slippage, $317.42 funding) ===');
console.log(`Fee difference: $${(totalSum.fee - 2223.72).toFixed(2)}`);
console.log(`Slippage difference: $${(totalSum.slip - 889.52).toFixed(2)}`);
console.log(`Funding difference: $${(totalSum.fund - 317.42).toFixed(2)}`);
console.log(`Net PnL difference: $${(totalSum.net - (-2818.83)).toFixed(2)}`);
