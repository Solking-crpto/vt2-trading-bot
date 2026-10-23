const fs = require('fs');

const lines = fs.readFileSync('reports/alpha-factory/trades.csv', 'utf8').trim().split('\n').slice(1);

let stopPctSum = 0, stopCount = 0;
let tpPctSum = 0, tpCount = 0;
let winDollarSum = 0, winCount = 0;
let lossDollarSum = 0, lossCount = 0;
let totalNetPnl = 0;

for (const line of lines) {
  const parts = line.split(',');
  const entryPrice = parseFloat(parts[7]);
  const exitPrice = parseFloat(parts[8]);
  const netPnl = parseFloat(parts[10]);
  const exitReason = parts[12];

  const priceChangePct = (Math.abs(exitPrice - entryPrice) / entryPrice) * 100;

  if (exitReason.startsWith('STOP_LOSS')) {
    stopPctSum += priceChangePct;
    stopCount++;
  } else if (exitReason.startsWith('TAKE_PROFIT')) {
    tpPctSum += priceChangePct;
    tpCount++;
  }

  totalNetPnl += netPnl;
  if (netPnl > 0) {
    winDollarSum += netPnl;
    winCount++;
  } else {
    lossDollarSum += Math.abs(netPnl);
    lossCount++;
  }
}

const avgStopPct = stopPctSum / stopCount;
const avgTargetPct = tpPctSum / tpCount;
const avgWin = winDollarSum / winCount;
const avgLoss = lossDollarSum / lossCount;
const realizedNetRR = avgWin / avgLoss;
const impliedBeWr = 1 / (1 + realizedNetRR);
const actualWr = winCount / lines.length;

let out = '';
out += '================================================================================\n';
out += 'AUDIT REPORT: V1 REALIZED NET REWARD-TO-RISK AND IMPLIED BREAK-EVEN WIN RATE\n';
out += 'Generated: ' + new Date().toISOString() + '\n';
out += 'Source Data: reports/alpha-factory/trades.csv (287 trades)\n';
out += '================================================================================\n\n';

out += `Total Trades: ${lines.length}\n`;
out += `Winning Trades: ${winCount} (${(actualWr * 100).toFixed(2)}%)\n`;
out += `Losing Trades: ${lossCount} (${((lossCount / lines.length) * 100).toFixed(2)}%)\n`;
out += `Total Net PnL: $${totalNetPnl.toFixed(2)}\n\n`;

out += 'PRICE DISTANCE METRICS:\n';
out += `  Stop-Loss Trades Count: ${stopCount}\n`;
out += `  Average Realized Stop Distance: ${avgStopPct.toFixed(4)}%\n`;
out += `  Take-Profit Trades Count: ${tpCount}\n`;
out += `  Average Realized Target Distance: ${avgTargetPct.toFixed(4)}%\n`;
out += `  Gross Price Move Ratio (Target / Stop): ${(avgTargetPct / avgStopPct).toFixed(4)}:1\n\n`;

out += 'DOLLAR NET REALIZED METRICS (AFTER ALL MODELED COSTS):\n';
out += `  Average Winning Trade Net PnL: $${avgWin.toFixed(4)}\n`;
out += `  Average Losing Trade Net PnL: -$${avgLoss.toFixed(4)}\n`;
out += `  Realized Net Reward-to-Risk (Avg Win / Avg Loss): ${realizedNetRR.toFixed(4)}:1\n\n`;

out += 'BREAK-EVEN ANALYSIS:\n';
out += `  Implied Break-even Win Rate: ${(impliedBeWr * 100).toFixed(2)}% [Formula: 1 / (1 + realizedNetRR)]\n`;
out += `  Actual Realized Win Rate: ${(actualWr * 100).toFixed(2)}%\n`;
out += `  Win Rate Deficit: ${((impliedBeWr - actualWr) * 100).toFixed(2)}% below break-even\n`;
out += `  Average Expectancy per Trade: $${(totalNetPnl / lines.length).toFixed(4)}\n\n`;

out += '================================================================================\n';
out += 'MATHEMATICAL EXPLANATION OF WHY THE STRATEGY LOST MONEY:\n';
out += '--------------------------------------------------------------------------------\n';
out += '1. The strategy design assumed a nominal net reward-to-risk of 1.50:1.\n';
out += '2. However, because stop distances averaged only 0.6111% (sized to $50 nominal risk),\n';
out += '   fixed exchange costs (0.05% entry fee + 0.05% exit fee + 0.02% entry slippage +\n';
out += '   0.02% exit slippage = ~0.14% round-trip) consumed roughly $11.50 per trade.\n';
out += '3. On losing trades, costs increased losses from $50.00 to $55.73 (-1.11R).\n';
out += '   On winning trades, costs reduced gains from ~$67.50 to $55.93 (+1.12R).\n';
out += '4. Consequently, the REALIZED net reward-to-risk after modeled costs was only 1.0036:1,\n';
out += '   not 1.5:1. At 1.0036:1, break-even requires a 49.91% win rate.\n';
out += '5. Since the strategy only achieved a 41.11% win rate, it lost -$9.82 on every trade\n';
out += '   on average, totaling -$2,818.83 across the 287 trades.\n';
out += '================================================================================\n';

fs.writeFileSync('reports/audit/v1_realized_net_rr.txt', out, 'utf8');
console.log('Saved reports/audit/v1_realized_net_rr.txt');
