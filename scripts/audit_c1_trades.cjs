const fs = require('fs');
const path = require('path');

const csvPath = path.resolve('reports/strategy-v2/trades.csv');
const raw = fs.readFileSync(csvPath, 'utf8');
const lines = raw.trim().split('\n');
const header = lines[0].trim().split(',');

console.log('CSV Header:', header.join(', '));

const records = [];
for (let i = 1; i < lines.length; i++) {
  const line = lines[i].trim();
  if (!line) continue;
  const cols = line.split(',');
  const row = {};
  header.forEach((h, idx) => {
    row[h] = cols[idx] !== undefined ? cols[idx].trim().replace(/^"|"$/g, '') : '';
  });
  records.push(row);
}

console.log('Total records in CSV:', records.length);

// Group by candidateId, sessionMode, split
const groups = {};
for (const r of records) {
  const key = `${r.candidateId}-${r.sessionMode}-${r.split}`;
  if (!groups[key]) groups[key] = [];
  groups[key].push(r);
}
console.log('Available groups:', Object.keys(groups));

const c1e0Dev = records.filter(r => r.candidateId === 'C1' && r.sessionMode === 'E0' && r.split === 'dev');
console.log('\n--- C1-E0 dev Analysis ---');
console.log('Count:', c1e0Dev.length);

if (c1e0Dev.length > 0) {
  let wins = 0;
  let losses = 0;
  let zeros = 0;
  let grossWins = 0;
  let grossLosses = 0;
  let netPnlSum = 0;
  let grossPnlSum = 0;

  for (const t of c1e0Dev) {
    const net = parseFloat(t.netPnl);
    const gross = parseFloat(t.grossPnl);
    if (!isNaN(net)) {
      netPnlSum += net;
      if (net > 0) wins++;
      else if (net < 0) losses++;
      else zeros++;
    }
    if (!isNaN(gross)) {
      grossPnlSum += gross;
      if (gross > 0) grossWins++;
      else if (gross < 0) grossLosses++;
    }
  }

  console.log(`Net Wins: ${wins}, Net Losses: ${losses}, Net Zero: ${zeros}`);
  console.log(`Net Win Rate: ${(wins / c1e0Dev.length * 100).toFixed(2)}% (${wins}/${c1e0Dev.length})`);
  console.log(`Gross Wins: ${grossWins}, Gross Losses: ${grossLosses}`);
  console.log(`Gross Win Rate: ${(grossWins / c1e0Dev.length * 100).toFixed(2)}% (${grossWins}/${c1e0Dev.length})`);
  console.log(`Net PnL Sum: $${netPnlSum.toFixed(2)}`);
  console.log(`Gross PnL Sum: $${grossPnlSum.toFixed(2)}`);

  // Sort by netPnl ascending
  const sortedByNetPnl = [...c1e0Dev].sort((a, b) => parseFloat(a.netPnl) - parseFloat(b.netPnl));
  console.log('\n--- 10 Worst Trades by netPnl (Raw CSV Rows) ---');
  console.log(header.join(','));
  sortedByNetPnl.slice(0, 10).forEach(t => {
    console.log(header.map(h => t[h]).join(','));
  });

  // Also sort by rMultiple ascending
  const sortedByR = [...c1e0Dev].sort((a, b) => parseFloat(a.rMultiple) - parseFloat(b.rMultiple));
  console.log('\n--- 10 Worst Trades by rMultiple (Raw CSV Rows) ---');
  console.log(header.join(','));
  sortedByR.slice(0, 10).forEach(t => {
    console.log(header.map(h => t[h]).join(','));
  });
}
