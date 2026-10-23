const fs = require('fs');
const lines = fs.readFileSync('reports/strategy-v2/trades.csv', 'utf8').trim().split('\n');
const header = lines[0].split(',').map(h => h.trim());
const records = lines.slice(1).map(l => {
  const c = l.split(',');
  const obj = {};
  header.forEach((h, i) => obj[h] = c[i] ? c[i].trim().replace(/^"|"$/g, '') : '');
  return obj;
});
const groups = {};
for (const r of records) {
  const k = r.candidateId + '-' + r.sessionMode + '-' + r.split;
  if (!groups[k]) groups[k] = [];
  groups[k].push(r);
}
console.log('Group | Trades | NetWins | NetWin% | GrossWins | GrossWin% | TP_Exits | TP%');
for (const [k, arr] of Object.entries(groups)) {
  const netWins = arr.filter(t => parseFloat(t.netPnl) > 0).length;
  const grossWins = arr.filter(t => parseFloat(t.grossPnl) > 0).length;
  const tpFinal = arr.filter(t => t.exitReason && t.exitReason.includes('TAKE_PROFIT')).length;
  console.log(`${k} | ${arr.length} | ${netWins} | ${(netWins/arr.length*100).toFixed(2)}% | ${grossWins} | ${(grossWins/arr.length*100).toFixed(2)}% | ${tpFinal} | ${(tpFinal/arr.length*100).toFixed(2)}%`);
}

// Check where 29.57% came from
// 443 * 0.2957 = 130.995 => 131 wins!
console.log('\nSearching for 131 wins or 29.57% in C1-E0-dev...');
const c1 = groups['C1-E0-dev'];
console.log('C1-E0-dev trades count:', c1.length);
console.log('Trades with netPnl > 0:', c1.filter(t => parseFloat(t.netPnl) > 0).length);
console.log('Trades with grossPnl > 0:', c1.filter(t => parseFloat(t.grossPnl) > 0).length);
console.log('Trades with exitReason == TAKE_PROFIT_FINAL:', c1.filter(t => t.exitReason === 'TAKE_PROFIT_FINAL').length);
console.log('Trades with exitReason includes TAKE_PROFIT:', c1.filter(t => t.exitReason.includes('TAKE_PROFIT')).length);
console.log('Trades with roiPct > 0:', c1.filter(t => parseFloat(t.roiPct) > 0).length);
console.log('Trades with rMultiple > 0:', c1.filter(t => parseFloat(t.rMultiple) > 0).length);

// Also check metrics.json in reports/strategy-v2/
if (fs.existsSync('reports/strategy-v2/metrics.json')) {
  console.log('\n--- metrics.json in reports/strategy-v2/ ---');
  const metrics = JSON.parse(fs.readFileSync('reports/strategy-v2/metrics.json', 'utf8'));
  console.log(JSON.stringify(metrics, null, 2));
}
