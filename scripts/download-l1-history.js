import fs from 'node:fs';
import path from 'node:path';

const HISTORY_DIR = path.resolve('data/history');
if (!fs.existsSync(HISTORY_DIR)) {
  fs.mkdirSync(HISTORY_DIR, { recursive: true });
}

async function fetchFullDailyCandles(symbol) {
  console.log(`Fetching complete 1D historical candles for ${symbol}...`);
  const candlesMap = new Map();
  let oldestTs = Date.now();
  let page = 0;
  const maxPages = 40;

  while (page < maxPages) {
    page++;
    const url = `https://api.bitget.com/api/v2/mix/market/history-candles?symbol=${symbol}&granularity=1D&productType=USDT-FUTURES&limit=200&endTime=${oldestTs}`;
    const res = await fetch(url).then(r => r.json());
    if (!res.data || res.data.length === 0) break;

    let newOldest = oldestTs;
    for (const r of res.data) {
      const ts = Number(r[0]);
      candlesMap.set(ts, {
        timestamp: ts,
        date: new Date(ts).toISOString().split('T')[0],
        open: Number(r[1]),
        high: Number(r[2]),
        low: Number(r[3]),
        close: Number(r[4]),
        volume: Number(r[5]),
      });
      if (ts < newOldest) newOldest = ts;
    }

    if (newOldest >= oldestTs) break;
    oldestTs = newOldest;
    process.stdout.write(`  Page ${page}: ${candlesMap.size} bars (Earliest: ${new Date(oldestTs).toISOString().split('T')[0]})\r`);
    await new Promise(r => setTimeout(r, 80));
  }

  const sorted = Array.from(candlesMap.values()).sort((a, b) => a.timestamp - b.timestamp);
  console.log(`\n  Completed ${symbol}: ${sorted.length} bars from ${sorted[0].date} to ${sorted[sorted.length - 1].date}`);

  const targetFile = path.join(HISTORY_DIR, `${symbol}_1d_full.json`);
  fs.writeFileSync(targetFile, JSON.stringify({
    symbol,
    granularity: '1D',
    count: sorted.length,
    firstDate: sorted[0].date,
    lastDate: sorted[sorted.length - 1].date,
    candles: sorted,
  }, null, 2), 'utf8');

  return sorted;
}

async function main() {
  await fetchFullDailyCandles('BTCUSDT');
  await fetchFullDailyCandles('ETHUSDT');
  console.log('Daily historical dataset ready for Candidate L1.');
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
