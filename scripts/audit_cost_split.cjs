const fs = require('fs');
const path = require('path');

const tradesPath = path.resolve('reports/alpha-factory/trades.csv');
const raw = fs.readFileSync(tradesPath, 'utf8').trim().split('\n');
const header = raw[0].split(',').map(h => h.trim().replace(/^"|"$/g, ''));
console.log('alpha-factory trades header:', header.join(', '));

const trades = raw.slice(1).map(l => {
  const cols = l.split(',');
  const obj = {};
  header.forEach((h, idx) => {
    obj[h] = cols[idx] ? cols[idx].trim().replace(/^"|"$/g, '') : '';
  });
  return obj;
});

console.log('Total trades in alpha-factory:', trades.length);

// Prompt 11 split date: 2026-09-11T15:00:00.000Z (timestamp 1789225200000)
const splitDateStr = '2026-09-11T15:00:00.000Z';
const splitTs = new Date(splitDateStr).getTime();
console.log(`Prompt 11 Split Date: ${splitDateStr} (ts: ${splitTs})`);

// Also check Prompt 9 split date: 2026-09-10T00:00:00.000Z (timestamp 1789084800000)
const splitDatePrompt9Str = '2026-09-10T00:00:00.000Z';
const splitTsPrompt9 = new Date(splitDatePrompt9Str).getTime();

function evaluateSplit(name, conditionFn) {
  let isCount = 0, oosCount = 0;
  let isFees = 0, oosFees = 0;
  let isSlip = 0, oosSlip = 0;
  let isFund = 0, oosFund = 0;
  let isNet = 0, oosNet = 0;
  let isGross = 0, oosGross = 0;

  for (const t of trades) {
    // Determine trade timestamp. Try exitTime or entryTime
    const entryTs = parseInt(t.entryTime) || new Date(t.entryDate).getTime();
    const isIS = conditionFn(entryTs, t);

    const fees = parseFloat(t.fees) || 0;
    const slippage = parseFloat(t.slippage) || 0;
    const funding = parseFloat(t.funding) || 0;
    const net = parseFloat(t.netPnl) || 0;
    const gross = parseFloat(t.grossPnl) || 0;

    if (isIS) {
      isCount++;
      isFees += fees;
      isSlip += slippage;
      isFund += funding;
      isNet += net;
      isGross += gross;
    } else {
      oosCount++;
      oosFees += fees;
      oosSlip += slippage;
      oosFund += funding;
      oosNet += net;
      oosGross += gross;
    }
  }

  const totCount = isCount + oosCount;
  const totFees = isFees + oosFees;
  const totSlip = isSlip + oosSlip;
  const totFund = isFund + oosFund;
  const totNet = isNet + oosNet;
  const totGross = isGross + oosGross;

  console.log(`\n=== Cost Decomposition: ${name} ===`);
  console.log(`Metric | In-Sample (IS: ${isCount}) | Out-of-Sample (OOS: ${oosCount}) | Total (${totCount})`);
  console.log(`---|---|---|---`);
  console.log(`Gross PnL | $${isGross.toFixed(2)} | $${oosGross.toFixed(2)} | $${totGross.toFixed(2)}`);
  console.log(`Fees | $${isFees.toFixed(2)} | $${oosFees.toFixed(2)} | $${totFees.toFixed(2)}`);
  console.log(`Slippage | $${isSlip.toFixed(2)} | $${oosSlip.toFixed(2)} | $${totSlip.toFixed(2)}`);
  console.log(`Funding | $${isFund.toFixed(2)} | $${oosFund.toFixed(2)} | $${totFund.toFixed(2)}`);
  console.log(`Total Drag | $${(isFees+isSlip+isFund).toFixed(2)} | $${(oosFees+oosSlip+oosFund).toFixed(2)} | $${(totFees+totSlip+totFund).toFixed(2)}`);
  console.log(`Net PnL | $${isNet.toFixed(2)} | $${oosNet.toFixed(2)} | $${totNet.toFixed(2)}`);
}

// 1. By Prompt 11 Split Date (2026-09-11T15:00:00.000Z) on entryTime
evaluateSplit('Split by entryTime < 2026-09-11T15:00:00.000Z (Prompt 11)', (ts) => ts < splitTs);

// 2. By Prompt 11 Split Date (2026-09-11T15:00:00.000Z) on exitTime
evaluateSplit('Split by exitTime < 2026-09-11T15:00:00.000Z (Prompt 11)', (ts, t) => {
  const exitTs = parseInt(t.exitTime) || new Date(t.exitDate).getTime();
  return exitTs < splitTs;
});

// 3. By 2026-09-10T00:00:00.000Z on entryTime
evaluateSplit('Split by entryTime < 2026-09-10T00:00:00.000Z', (ts) => ts < splitTsPrompt9);

// Check published metrics.json in reports/alpha-factory/
const publishedMetrics = JSON.parse(fs.readFileSync('reports/alpha-factory/metrics.json', 'utf8'));
console.log('\n=== Published reports/alpha-factory/metrics.json Summary ===');
console.log('Total trades:', publishedMetrics.totalTrades);
console.log('Net PnL:', publishedMetrics.netPnl);
console.log('Total fees:', publishedMetrics.totalFees);
console.log('Total slippage:', publishedMetrics.totalSlippage);
console.log('Total funding:', publishedMetrics.totalFunding);
console.log('In-sample metrics:', publishedMetrics.inSample);
console.log('Out-of-sample metrics:', publishedMetrics.outOfSample);
