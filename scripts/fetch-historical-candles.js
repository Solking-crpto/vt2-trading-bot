import fs from 'node:fs';
import path from 'node:path';
import { assertCandleIntegrity } from '../src/adapters/bitget-adapter.js';

const EQUITY_PERPS_PATH = path.resolve('config/equity-perps.json');
const HISTORY_DIR = path.resolve('data/history');

if (!fs.existsSync(HISTORY_DIR)) {
  fs.mkdirSync(HISTORY_DIR, { recursive: true });
}

const rawEquities = JSON.parse(fs.readFileSync(EQUITY_PERPS_PATH, 'utf8'));
const symbolsToFetch = [
  ...rawEquities.map(e => e.symbol),
  'BTCUSDT', // Comparison benchmark
];

const MAX_DAYS = 150;
const MS_PER_DAY = 24 * 60 * 60 * 1000;
const EARLIEST_TARGET_MS = Date.now() - (MAX_DAYS * MS_PER_DAY);

async function fetchHistoryForGranularity(symbol, granularity, intervalMs) {
  let oldestTs = Date.now();
  const allCandlesMap = new Map(); // timestamp -> candle object
  let duplicateCount = 0;
  let page = 0;
  const maxPages = granularity === '15m' ? 80 : 25; // 80 * 200 = 16,000 (up to ~166 days)

  while (page < maxPages && oldestTs > EARLIEST_TARGET_MS) {
    page++;
    const bitgetG = granularity === '4h' ? '4H' : granularity;
    const url = `https://api.bitget.com/api/v2/mix/market/history-candles?symbol=${symbol}&granularity=${bitgetG}&productType=USDT-FUTURES&limit=200&endTime=${oldestTs}`;

    try {
      const res = await fetch(url, { headers: { 'Accept': 'application/json' } });
      const json = await res.json();
      if (json.code !== '00000' || !Array.isArray(json.data) || json.data.length === 0) {
        break;
      }

      const rows = json.data;
      let newEarliest = oldestTs;

      for (const r of rows) {
        const ts = Number(r[0]);
        if (allCandlesMap.has(ts)) {
          duplicateCount++;
        }
        allCandlesMap.set(ts, {
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

      if (newEarliest >= oldestTs) {
        // Did not advance backwards
        break;
      }
      oldestTs = newEarliest;

      // Rate limit buffer: 80ms
      await new Promise(r => setTimeout(r, 80));
    } catch (err) {
      console.warn(`[${symbol}] [${granularity}] fetch error on page ${page}:`, err.message);
      break;
    }
  }

  // Sort chronologically ascending
  const sorted = Array.from(allCandlesMap.values()).sort((a, b) => a.timestamp - b.timestamp);

  // Validate integrity (strict ascending order, uniqueness)
  if (sorted.length > 0) {
    assertCandleIntegrity(sorted, granularity);
  }

  // Compute gaps
  let gapCount = 0;
  for (let i = 1; i < sorted.length; i++) {
    const diff = sorted[i].timestamp - sorted[i - 1].timestamp;
    // Allow up to 1.5x interval before declaring a gap
    if (diff > intervalMs * 1.5) {
      gapCount++;
    }
  }

  return {
    candles: sorted,
    duplicateCount,
    gapCount,
    firstTs: sorted.length > 0 ? sorted[0].timestamp : null,
    lastTs: sorted.length > 0 ? sorted[sorted.length - 1].timestamp : null,
    count: sorted.length,
  };
}

async function main() {
  console.log(`Starting historical candle download for ${symbolsToFetch.length} symbols...`);
  console.log(`Endpoint: GET https://api.bitget.com/api/v2/mix/market/history-candles`);
  console.log(`Docs Reference: https://www.bitget.com/api-doc/contract/market/Get-History-Candle-Data`);
  console.log(`Target: Up to 150 days of 15m and 4h candles\n`);

  const reportRecords = [];

  for (const symbol of symbolsToFetch) {
    process.stdout.write(`Fetching ${symbol}... `);
    const startSymbolTime = Date.now();

    // 15m candles (interval = 900,000ms)
    const res15m = await fetchHistoryForGranularity(symbol, '15m', 15 * 60 * 1000);
    // 4h candles (interval = 14,400,000ms)
    const res4h = await fetchHistoryForGranularity(symbol, '4h', 4 * 60 * 60 * 1000);

    // Save caches
    fs.writeFileSync(
      path.join(HISTORY_DIR, `${symbol}_15m.json`),
      JSON.stringify({
        symbol,
        granularity: '15m',
        count: res15m.count,
        firstTs: res15m.firstTs,
        lastTs: res15m.lastTs,
        candles: res15m.candles,
      }, null, 2)
    );

    fs.writeFileSync(
      path.join(HISTORY_DIR, `${symbol}_4h.json`),
      JSON.stringify({
        symbol,
        granularity: '4h',
        count: res4h.count,
        firstTs: res4h.firstTs,
        lastTs: res4h.lastTs,
        candles: res4h.candles,
      }, null, 2)
    );

    const spanDays = res15m.firstTs && res15m.lastTs
      ? Number(((res15m.lastTs - res15m.firstTs) / MS_PER_DAY).toFixed(1))
      : 0;

    const has90Days = spanDays >= 90;
    const duration = ((Date.now() - startSymbolTime) / 1000).toFixed(1);

    console.log(`15m: ${res15m.count} bars (${spanDays}d, ${res15m.gapCount} gaps) | 4h: ${res4h.count} bars | done in ${duration}s`);

    reportRecords.push({
      symbol,
      isBenchmark: symbol === 'SPYUSDT',
      isComparisonCrypto: symbol === 'BTCUSDT',
      count15m: res15m.count,
      count4h: res4h.count,
      firstTs: res15m.firstTs,
      firstDate: res15m.firstTs ? new Date(res15m.firstTs).toISOString().split('T')[0] : 'N/A',
      lastTs: res15m.lastTs,
      lastDate: res15m.lastTs ? new Date(res15m.lastTs).toISOString().split('T')[0] : 'N/A',
      spanDays,
      gaps15m: res15m.gapCount,
      duplicates15m: res15m.duplicateCount,
      has90Days,
    });
  }

  // Save full coverage report
  const reportsDir = path.resolve('reports/alpha-factory');
  if (!fs.existsSync(reportsDir)) {
    fs.mkdirSync(reportsDir, { recursive: true });
  }

  fs.writeFileSync(
    path.join(reportsDir, 'data-coverage.json'),
    JSON.stringify(reportRecords, null, 2)
  );

  console.log('\n========================================================================================');
  console.log('HISTORICAL CANDLE COVERAGE AUDIT SUMMARY');
  console.log('========================================================================================');
  console.table(reportRecords.map(r => ({
    Symbol: r.symbol,
    '15m Bars': r.count15m,
    '4h Bars': r.count4h,
    'Start Date': r.firstDate,
    'End Date': r.lastDate,
    'Days Span': r.spanDays,
    '15m Gaps': r.gaps15m,
    Duplicates: r.duplicates15m,
    '≥90 Days': r.has90Days ? 'YES' : 'NO',
  })));

  const eligibleForHeadline = reportRecords.filter(r => !r.isComparisonCrypto && r.has90Days);
  const excludedFromHeadline = reportRecords.filter(r => !r.isComparisonCrypto && !r.has90Days);

  console.log(`Headline Universe (≥90 Days): ${eligibleForHeadline.length} contracts:`, eligibleForHeadline.map(e => e.symbol).join(', '));
  console.log(`Excluded from Headline (<90 Days): ${excludedFromHeadline.length} contracts:`, excludedFromHeadline.map(e => `${e.symbol} (${e.spanDays}d)`).join(', '));
}

main().catch(err => {
  console.error('Fatal fetch error:', err);
  process.exit(1);
});
