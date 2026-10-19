import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { assertCandleIntegrity } from '../src/adapters/bitget-adapter.js';

const EQUITY_PERPS_PATH = path.resolve('config/equity-perps.json');
const HISTORY_DIR = path.resolve('data/history');
const OUTPUT_DIR = path.resolve('reports/strategy-v2');

if (!fs.existsSync(OUTPUT_DIR)) {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
}

const rawEquities = JSON.parse(fs.readFileSync(EQUITY_PERPS_PATH, 'utf8'));
const symbolsToFetch = [
  ...rawEquities.map(e => e.symbol),
  'BTCUSDT',
];

const OCT_10_TS = new Date('2026-10-10T00:00:00.000Z').getTime();

function curlBitgetHistory(symbol, granularity, endTime) {
  const bitgetG = granularity === '4h' ? '4H' : granularity;
  const url = `https://api.bitget.com/api/v2/mix/market/history-candles?symbol=${symbol}&granularity=${bitgetG}&productType=USDT-FUTURES&limit=200&endTime=${endTime}`;
  try {
    const raw = execFileSync('curl.exe', ['-s', '--max-time', '10', url], { encoding: 'utf8' });
    const json = JSON.parse(raw);
    if (json.code === '00000' && Array.isArray(json.data)) {
      return json.data;
    }
  } catch (err) {
    console.warn(`[${symbol}] [${granularity}] curl fetch error:`, err.message);
  }
  return [];
}

async function fetchRecentCandles(symbol, granularity) {
  const candlesMap = new Map();
  let oldestTs = Date.now();
  let page = 0;
  const maxPages = granularity === '15m' ? 10 : 3;

  while (page < maxPages && oldestTs > OCT_10_TS) {
    page++;
    const rows = curlBitgetHistory(symbol, granularity, oldestTs);
    if (!rows || rows.length === 0) break;

    let newEarliest = oldestTs;
    for (const r of rows) {
      const ts = Number(r[0]);
      candlesMap.set(ts, {
        timestamp: ts,
        open: Number(r[1]),
        high: Number(r[2]),
        low: Number(r[3]),
        close: Number(r[4]),
        volume: Number(r[5]),
      });
      if (ts < newEarliest) {
        newEarliest = ts;
      }
    }

    if (newEarliest >= oldestTs) break;
    oldestTs = newEarliest;
    // Rate limit buffer: 80ms
    await new Promise(r => setTimeout(r, 80));
  }

  return Array.from(candlesMap.values());
}

async function main() {
  console.log(`========================================================================`);
  console.log(`Fetching Forward Holdout Candles (2026-10-10 to Present) for ${symbolsToFetch.length} symbols`);
  console.log(`Target: data/history/*_{15m,4h}.json`);
  console.log(`========================================================================\n`);

  const report = [];

  for (const symbol of symbolsToFetch) {
    process.stdout.write(`Processing ${symbol}... `);
    const file15m = path.join(HISTORY_DIR, `${symbol}_15m.json`);
    const file4h = path.join(HISTORY_DIR, `${symbol}_4h.json`);

    // 15m
    let existing15m = [];
    if (fs.existsSync(file15m)) {
      const parsed = JSON.parse(fs.readFileSync(file15m, 'utf8'));
      existing15m = parsed.candles || [];
    }

    const recent15m = await fetchRecentCandles(symbol, '15m');
    const merged15mMap = new Map();
    for (const c of existing15m) merged15mMap.set(c.timestamp, c);
    for (const c of recent15m) merged15mMap.set(c.timestamp, c);

    const sorted15m = Array.from(merged15mMap.values()).sort((a, b) => a.timestamp - b.timestamp);
    if (sorted15m.length > 0) {
      assertCandleIntegrity(sorted15m, '15m');
    }

    fs.writeFileSync(file15m, JSON.stringify({
      symbol,
      granularity: '15m',
      count: sorted15m.length,
      firstTs: sorted15m[0]?.timestamp || null,
      lastTs: sorted15m[sorted15m.length - 1]?.timestamp || null,
      candles: sorted15m,
    }, null, 2));

    // 4h
    let existing4h = [];
    if (fs.existsSync(file4h)) {
      const parsed = JSON.parse(fs.readFileSync(file4h, 'utf8'));
      existing4h = parsed.candles || [];
    }

    const recent4h = await fetchRecentCandles(symbol, '4h');
    const merged4hMap = new Map();
    for (const c of existing4h) merged4hMap.set(c.timestamp, c);
    for (const c of recent4h) merged4hMap.set(c.timestamp, c);

    const sorted4h = Array.from(merged4hMap.values()).sort((a, b) => a.timestamp - b.timestamp);
    if (sorted4h.length > 0) {
      assertCandleIntegrity(sorted4h, '4h');
    }

    fs.writeFileSync(file4h, JSON.stringify({
      symbol,
      granularity: '4h',
      count: sorted4h.length,
      firstTs: sorted4h[0]?.timestamp || null,
      lastTs: sorted4h[sorted4h.length - 1]?.timestamp || null,
      candles: sorted4h,
    }, null, 2));

    const lastDate15m = sorted15m.length > 0 ? new Date(sorted15m[sorted15m.length - 1].timestamp).toISOString() : 'N/A';
    console.log(`15m total: ${sorted15m.length} bars (up to ${lastDate15m}) | 4h: ${sorted4h.length} bars`);

    report.push({
      symbol,
      total15m: sorted15m.length,
      total4h: sorted4h.length,
      lastTs: sorted15m[sorted15m.length - 1]?.timestamp,
      lastDate: lastDate15m,
    });
  }

  fs.writeFileSync(
    path.join(OUTPUT_DIR, 'forward-data-coverage.json'),
    JSON.stringify(report, null, 2)
  );

  console.log(`\nCoverage updated successfully. Saved report to reports/strategy-v2/forward-data-coverage.json.`);
}

main().catch(err => {
  console.error('Fatal fetch error:', err);
  process.exit(1);
});
