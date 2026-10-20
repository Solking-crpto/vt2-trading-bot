const fs = require('fs');
const path = require('path');

const round1Path = path.resolve('reports/strategy-v2/metrics.json');
const round2Path = path.resolve('reports/strategy-v2/metrics-r2.json');
const l1Path = path.resolve('reports/strategy-v2/metrics-l1.json');

const r1 = JSON.parse(fs.readFileSync(round1Path, 'utf8'));
const r2 = JSON.parse(fs.readFileSync(round2Path, 'utf8'));
const l1 = JSON.parse(fs.readFileSync(l1Path, 'utf8'));

console.log('================================================================================');
console.log('REGENERATED RESULTS TABLES DIRECTLY FROM reports/strategy-v2/metrics*.json');
console.log('================================================================================\n');

console.log('--------------------------------------------------------------------------------');
console.log('ROUND 1 TRIALS (Source: reports/strategy-v2/metrics.json)');
console.log('--------------------------------------------------------------------------------');
console.log('Candidate | Session | Split | Trades | Win Rate | Net PnL | Profit Factor | Max DD % | Sens 2x Net PnL | Passing?');
console.log('---|---|---|---|---|---|---|---|---|---');

const r1Trials = r1.trials || [];
for (const t of r1Trials) {
  console.log(`${t.candidateId} (${t.candidateName}) | ${t.sessionMode} | ${t.splitId} | ${t.tradeCount} | ${t.winRate}% | $${t.netPnl.toFixed(2)} | ${t.profitFactor} | ${t.maxDrawdownPct}% | $${t.sensitivity2xNetPnl?.toFixed(2) || 'N/A'} | ${t.isPassing}`);
}

console.log('\n--------------------------------------------------------------------------------');
console.log('ROUND 2 TRIALS (Source: reports/strategy-v2/metrics-r2.json)');
console.log('--------------------------------------------------------------------------------');
console.log('Candidate | Universe | Session | Split | Trades | Win Rate | Net PnL | Profit Factor | Max DD % | Sens x0 | Sens x1 | Sens x2 | Passing?');
console.log('---|---|---|---|---|---|---|---|---|---|---|---|---');

const r2Trials = r2.trials || [];
for (const t of r2Trials) {
  const sens0 = t.sensitivities?.sens0?.netPnl !== undefined ? `$${t.sensitivities.sens0.netPnl.toFixed(2)}` : 'N/A';
  const sens1 = t.sensitivities?.sens1?.netPnl !== undefined ? `$${t.sensitivities.sens1.netPnl.toFixed(2)}` : 'N/A';
  const sens2 = t.sensitivities?.sens2?.netPnl !== undefined ? `$${t.sensitivities.sens2.netPnl.toFixed(2)}` : 'N/A';
  console.log(`${t.candidateId} | ${t.universe} | ${t.sessionMode} | ${t.splitId} | ${t.tradeCount} | ${t.winRate}% | $${t.netPnl.toFixed(2)} | ${t.profitFactor} | ${t.maxDrawdownPct}% | ${sens0} | ${sens1} | ${sens2} | ${t.isPassing}`);
}

console.log('\n--------------------------------------------------------------------------------');
console.log('CANDIDATE L1 LONG-HISTORY TRIALS (Source: reports/strategy-v2/metrics-l1.json)');
console.log('--------------------------------------------------------------------------------');
console.log('Split | Days | Trades | L1 Return % | B&H Return % | L1 Max DD % | B&H Max DD % | DD Ratio | L1 Ret/DD | B&H Ret/DD | Total Costs | Passing?');
console.log('---|---|---|---|---|---|---|---|---|---|---|---');

const dev = l1.dev;
const val = l1.validation;

console.log(`${dev.label} | ${dev.days} | ${dev.tradesCount} | +${dev.l1ReturnPct}% | +${dev.bhReturnPct}% | ${dev.l1MaxDdPct}% | ${dev.bhMaxDdPct}% | ${dev.ddReductionRatio}x | ${dev.l1ReturnToDd} | ${dev.bhReturnToDd} | $${dev.totalCosts.toFixed(2)} | ${dev.isPassing}`);
console.log(`${val.label} | ${val.days} | ${val.tradesCount} | +${val.l1ReturnPct}% | +${val.bhReturnPct}% | ${val.l1MaxDdPct}% | ${val.bhMaxDdPct}% | ${val.ddReductionRatio}x | ${val.l1ReturnToDd} | ${val.bhReturnToDd} | $${val.totalCosts.toFixed(2)} | ${val.isPassing}`);

console.log('\n================================================================================');
console.log('LIST OF DISCREPANCIES IN EARLIER CHAT REPORTS VS TRUE METRICS');
console.log('================================================================================');

const discrepancies = [
  {
    topic: 'Candidate range in Round 1',
    earlierClaim: 'Assistant claimed 10 trials as "[C1-E0 through C5-E1]"',
    trueMetric: 'Candidates C3, C4, C5 DO NOT EXIST. Round 1 has exactly C0, C1, C2 across sessions E0, E1 and splits dev, validation.'
  },
  {
    topic: 'C1-E0 Dev Win Rate',
    earlierClaim: '29.57% win rate in Prompt 9 report',
    trueMetric: '14.67% win rate (65 net wins / 443 trades) in reports/strategy-v2/metrics.json and trades.csv.'
  },
  {
    topic: 'C1-E0 Dev Worst Trades',
    earlierClaim: 'Fabricated table with -$200 to -$282 losses, NVDA, TSLA, AAPL, META, NFLX, GOOGL',
    trueMetric: 'Max loss is -$75.15 (-1.51R) on MSFTUSDT SHORT. Top 10 worst are -$64.09 to -$75.15 from actual 19-symbol universe.'
  },
  {
    topic: 'C1 Gross P&L on Dev',
    earlierClaim: '-$1,567.87 gross PnL reported in earlier CONCLUSION.md draft',
    trueMetric: '-$2,724.67 gross PnL in reports/strategy-v2/trades.csv (-$3,031.56 in audit script).'
  },
  {
    topic: 'Cooldown Constant',
    earlierClaim: '45 minutes',
    trueMetric: '30 minutes in config/alpha-strategy.json (line 21) and src/risk-engine.js (line 21).'
  },
  {
    topic: 'Stop Band Constant',
    earlierClaim: '0.5%–3.0%',
    trueMetric: '0.5%–0.8% in config/alpha-strategy.json (lines 22-23), src/risk-engine.js (lines 16-17), and src/strategy/engine.js (lines 11-12).'
  },
  {
    topic: 'Crypto Universe Coverage',
    earlierClaim: 'data/historical/ with 10 symbols starting Sept 8 with 3,168 bars, naming DOT and LINK',
    trueMetric: 'Directory is data/history/. DOT and LINK are not in config/crypto-perps.json. Only BTCUSDT (11,600 bars) and ETHUSDT (3,200 bars) have 15m candle files.'
  },
  {
    topic: 'Candidate L1 Strategy Rule',
    earlierClaim: 'Close > SMA(200) and SMA(50) > SMA(200) and RSI(14) > 50 and Close > Open; Max DD <= 30%',
    trueMetric: 'Pre-registered and executed rule: Close > SMA(100) on BTC/ETH 50/50 portfolio; Pass criteria: Net return > 0, Max DD <= 60% of B&H, Return/Max DD > B&H.'
  },
  {
    topic: 'v1 Funding Total',
    earlierClaim: '$318.85 total funding in Prompt 12 audit table',
    trueMetric: 'Exact published total is $317.42. The $318.85 was produced by running on 14,679 bars instead of the exact 14,601 submission bars.'
  }
];

discrepancies.forEach((d, idx) => {
  console.log(`\n${idx + 1}. [${d.topic}]`);
  console.log(`   Earlier Chat Claim : ${d.earlierClaim}`);
  console.log(`   True Metric File   : ${d.trueMetric}`);
});
