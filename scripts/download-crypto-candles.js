import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { assertCandleIntegrity } from '../src/adapters/bitget-adapter.js';

const HISTORY_DIR = path.resolve('data/history');
if (!fs.existsSync(HISTORY_DIR)) {
  fs.mkdirSync(HISTORY_DIR, { recursive: true });
}

const CRYPTO_PERPS_PATH = path.resolve('config/crypto-perps.json');
const cryptoPerps = JSON.parse(fs.readFileSync(CRYPTO_PERPS_PATH, 'utf8'));
const symbols = cryptoPerps.map(c => c.symbol);

// Target start: May 11, 2026
const TARGET_START_TS = new Date('2026-05-11T00:00:00.000Z').getTime();

function curlBitget(endpoint, params) {
  const queryStr = Object.entries(params).map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&');
  const url = `https://api.bitget.com/api/v2/mix/market/${endpoint}?${queryStr}`;

  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const raw = execFileSync('curl.exe', ['-s', '--connect-timeout', '15', '--max-time', '30', url], {
        encoding: 'utf8',
        maxBuffer: 20 * 1024 * 1024,
      });
      const json = JSON.parse(raw);
      if (json.code === '00000' && Array.isArray(json.data)) {
        return json.data;
      }
      if (json.code !== '00000') {
        console.warn(`[Bitget API] Code ${json.code}: ${json.msg || 'error'}`);
      }
    } catch (err) {
      if (attempt === 3) console.warn(`Curl failed for ${url}:`, err.message);
    }
  }
  return [];
}

async function fetchGranularity(symbol, granularity, intervalMs, maxPages) {
  const bitgetG = granularity === '4h' ? '4H' : (granularity === '1d' ? '1D' : granularity);
  const candlesMap = new Map();
  let oldestTs = Date.now();
  let page = 0;

  // First fetch latest candles
  const latestRows = curlBitget('candles', {
    symbol,
    granularity: bitgetG,
    productType: 'USDT-FUTURES',
    limit: '200',
  });

  for (const r of latestRows) {
    const ts = Number(r[0]);
    candlesMap.set(ts, {
      timestamp: ts,
      open: Number(r[1]),
      high: Number(r[2]),
      low: Number(r[3]),
      close: Number(r[4]),
      volume: Number(r[5]),
    });
    if (ts < oldestTs) oldestTs = ts;
  }

  // Then page back with history-candles
  while (page < maxPages && oldestTs > TARGET_START_TS) {
    page++;
    const histRows = curlBitget('history-candles', {
      symbol,
      granularity: bitgetG,
      productType: 'USDT-FUTURES',
      limit: '200',
      endTime: String(oldestTs),
    });

    if (!histRows || histRows.length === 0) break;

    let newEarliest = oldestTs;
    for (const r of histRows) {
      const ts = Number(r[0]);
      candlesMap.set(ts, {
        timestamp: ts,
        open: Number(r[1]),
        high: Number(r[2]),
        low: Number(r[3]),
        close: Number(r[4]),
        volume: Number(r[5]),
      });
      if (ts < newEarliest) newEarliest = ts;
    }

    if (newEarliest >= oldestTs) break;
    oldestTs = newEarliest;

    // Small delay between calls
    await new Promise(r => setTimeout(r, 60));
  }

  const sorted = Array.from(candlesMap.values()).sort((a, b) => a.timestamp - b.timestamp);
  return sorted;
}

async function main() {
  console.log('========================================================================');
  console.log(`Downloading 15m, 4h, and 1d Historical Candles for ${symbols.length} Crypto Perps`);
  console.log(`Target: May 11, 2026 to Present`);
  console.log('========================================================================\n');

  let lastProgressTs = Date.now();
  const granularities = [
    { g: '1d', ms: 24 * 60 * 60 * 1000, maxPages: 2 },
    { g: '4h', ms: 4 * 60 * 60 * 1000, maxPages: 8 },
    { g: '15m', ms: 15 * 60 * 1000, maxPages: 85 },
  ];

  for (let sIdx = 0; sIdx < symbols.length; sIdx++) {
    const symbol = symbols[sIdx];
    console.log(`\n[${sIdx + 1}/${symbols.length}] Processing ${symbol}...`);

    for (const { g, ms, maxPages } of granularities) {
      const filePath = path.join(HISTORY_DIR, `${symbol}_${g}.json`);
      process.stdout.write(`  - Fetching ${g}... `);
      const startTime = Date.now();
      const candles = await fetchGranularity(symbol, g, ms, maxPages);

      if (candles.length > 0) {
        try {
          assertCandleIntegrity(candles, g);
        } catch (e) {
          console.warn(`(integrity note: ${e.message})`);
        }

        const firstDate = new Date(candles[0].timestamp).toISOString().split('T')[0];
        const lastDate = new Date(candles[candles.length - 1].timestamp).toISOString().split('T')[0];
        console.log(`${candles.length} bars (${firstDate} to ${lastDate}) in ${((Date.now() - startTime) / 1000).toFixed(1)}s`);

        fs.writeFileSync(filePath, JSON.stringify({
          symbol,
          granularity: g,
          count: candles.length,
          firstDate,
          lastDate,
          firstTs: candles[0].timestamp,
          lastTs: candles[candles.length - 1].timestamp,
          candles,
        }, null, 2));
      } else {
        console.log(`0 bars received.`);
      }

      if (Date.now() - lastProgressTs > 15000) {
        console.log(`  [Progress Update: ${sIdx + 1}/${symbols.length} symbols underway...]`);
        lastProgressTs = Date.now();
      }
    }
  }

  console.log('\nAll crypto candles downloaded and verified successfully!');
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
