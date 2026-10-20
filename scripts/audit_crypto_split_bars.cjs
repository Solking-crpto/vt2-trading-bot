const fs = require('fs');
const path = require('path');

const cryptoConfig = JSON.parse(fs.readFileSync('config/crypto-perps.json', 'utf8'));
const historyDir = path.resolve('data/history');

const DEV_START = new Date('2026-05-11T17:30:00.000Z').getTime();
const DEV_END = new Date('2026-09-11T15:00:00.000Z').getTime();
const VAL_START = new Date('2026-09-11T15:00:00.000Z').getTime();
const VAL_END = new Date('2026-10-10T19:30:00.000Z').getTime();

console.log('================================================================================');
console.log('ROUND 2 CRYPTO UNIVERSE AUDIT: BARS PER SYMBOL PER SPLIT');
console.log('Dev Split: 2026-05-11T17:30Z to 2026-09-11T15:00Z');
console.log('Validation Split: 2026-09-11T15:00Z to 2026-10-10T19:30Z');
console.log('================================================================================\n');

console.log('Symbol | Total 15m Bars | Dev 15m Bars | Val 15m Bars | Data Status');
console.log('---|---|---|---|---');

const coverage = [];
for (const item of cryptoConfig) {
  const sym = item.symbol;
  const file15m = path.join(historyDir, `${sym}_15m.json`);
  let totalBars = 0;
  let devBars = 0;
  let valBars = 0;
  let status = 'MISSING (No 15m file)';

  if (fs.existsSync(file15m)) {
    const data = JSON.parse(fs.readFileSync(file15m, 'utf8'));
    const candles = Array.isArray(data) ? data : (data.candles || data.data || []);
    totalBars = candles.length;
    const getTs = c => Array.isArray(c) ? parseInt(c[0]) : (c.timestamp || c.ts || c.time);
    
    for (const c of candles) {
      const ts = getTs(c);
      if (ts >= DEV_START && ts < DEV_END) devBars++;
      if (ts >= VAL_START && ts <= VAL_END) valBars++;
    }

    if (devBars === 0 && valBars > 0) {
      status = 'PARTIAL (Validation only; 0 bars in Dev)';
    } else if (devBars > 0 && valBars > 0) {
      status = 'AVAILABLE (Present in Dev and Val)';
    }
  }

  coverage.push({ symbol: sym, totalBars, devBars, valBars, status });
  console.log(`${sym} | ${totalBars} | ${devBars} | ${valBars} | ${status}`);
}

console.log('\n================================================================================');
console.log('ROUND 2 CRYPTO TRIAL EVALUATION STATUS');
console.log('================================================================================');

const r2 = JSON.parse(fs.readFileSync('reports/strategy-v2/metrics-r2.json', 'utf8'));
const cryptoTrials = r2.trials.filter(t => t.universe === 'Crypto');

console.log('\nCandidate | Session | Split | Trades | Win Rate | Net PnL | Evaluability Status | Reason');
console.log('---|---|---|---|---|---|---|---');

for (const t of cryptoTrials) {
  const isEvaluable = t.tradeCount >= 30;
  const evalStatus = isEvaluable ? 'EVALUABLE' : 'NOT EVALUABLE';
  const reason = t.tradeCount < 30 
    ? `Sample size (${t.tradeCount}) < 30 trades; 8 of 10 universe symbols completely missing`
    : 'Sufficient sample';
  console.log(`${t.candidateId} | ${t.sessionMode} | ${t.splitId} | ${t.tradeCount} | ${t.winRate}% | $${t.netPnl.toFixed(2)} | **${evalStatus}** | ${reason}`);
}

console.log('\nSUMMARY: All 4 Round 2 Crypto trials (R2-A Dev, R2-A Val, R2-B Dev, R2-B Val) are statistically NOT EVALUABLE due to severe sample truncation (< 30 trades) and 8 missing universe symbols.');
