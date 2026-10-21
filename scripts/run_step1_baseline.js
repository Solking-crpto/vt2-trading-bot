import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { VT2Server } from '../src/vt2-server.js';
import {
  isMainnetExecutionAllowed,
  assertMainnetExecutionBlocked,
  validateExecutionMode,
  getCurrentMode,
} from '../src/environment.js';

const OUT_DIR = path.resolve('reports/release/01_baseline');
if (!fs.existsSync(OUT_DIR)) {
  fs.mkdirSync(OUT_DIR, { recursive: true });
}

function fetchJson(port, path, options = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request({
      hostname: '127.0.0.1',
      port,
      path,
      method: options.method || 'GET',
      headers: {
        'Content-Type': 'application/json',
        ...(options.headers || {}),
      },
      timeout: 10000,
    }, res => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          resolve({ status: res.statusCode, headers: res.headers, data: parsed, raw: data });
        } catch {
          resolve({ status: res.statusCode, headers: res.headers, data, raw: data });
        }
      });
    });

    req.on('error', reject);
    req.on('timeout', () => {
      req.destroy();
      reject(new Error(`Timeout fetching ${path}`));
    });

    if (options.body) {
      req.write(typeof options.body === 'string' ? options.body : JSON.stringify(options.body));
    }
    req.end();
  });
}

async function main() {
  console.log('--- Step 1: Starting VT2Server for Baseline Snapshot ---');
  const server = new VT2Server({ isDemoReadOnly: false });
  // Start on ephemeral port
  server.server = http.createServer((req, res) => server.handleRequest(req, res));
  
  await new Promise((resolve) => {
    server.server.listen(0, '127.0.0.1', () => {
      server.port = server.server.address().port;
      console.log(`VT2Server running on port ${server.port}`);
      resolve();
    });
  });

  const port = server.port;

  try {
    // 1. /api/health
    console.log('Capturing /api/health...');
    const healthRes = await fetchJson(port, '/api/health');
    fs.writeFileSync(path.join(OUT_DIR, 'api_health.json'), JSON.stringify(healthRes.data, null, 2), 'utf8');

    // 2. /api/system/health
    console.log('Capturing /api/system/health...');
    const sysHealthRes = await fetchJson(port, '/api/system/health');
    fs.writeFileSync(path.join(OUT_DIR, 'api_system_health.json'), JSON.stringify(sysHealthRes.data, null, 2), 'utf8');

    // 3. Market Scans: Stocks, Crypto, Both
    console.log('Capturing Stocks Scan...');
    const t0Stocks = Date.now();
    const scanStocks = await fetchJson(port, '/api/market/scan', {
      method: 'POST',
      body: { marketMode: 'stocks' },
    });
    const durStocks = Date.now() - t0Stocks;
    fs.writeFileSync(path.join(OUT_DIR, 'scans_stocks.json'), JSON.stringify(scanStocks.data, null, 2), 'utf8');

    console.log('Capturing Crypto Scan...');
    const t0Crypto = Date.now();
    const scanCrypto = await fetchJson(port, '/api/market/scan', {
      method: 'POST',
      body: { marketMode: 'crypto' },
    });
    const durCrypto = Date.now() - t0Crypto;
    fs.writeFileSync(path.join(OUT_DIR, 'scans_crypto.json'), JSON.stringify(scanCrypto.data, null, 2), 'utf8');

    console.log('Capturing Both Scan...');
    const t0Both = Date.now();
    const scanBoth = await fetchJson(port, '/api/market/scan', {
      method: 'POST',
      body: { marketMode: 'both' },
    });
    const durBoth = Date.now() - t0Both;
    fs.writeFileSync(path.join(OUT_DIR, 'scans_both.json'), JSON.stringify(scanBoth.data, null, 2), 'utf8');

    // Analyze asset-class purity (filter out internal '_meta' entry)
    const stocksQualified = (scanStocks.data.qualified || scanStocks.data.opportunities || []).filter(o => o.symbol !== '_meta');
    const stocksRejected = (scanStocks.data.rejected || []).filter(o => o.symbol !== '_meta');
    const stocksHasCrypto = stocksQualified.some(o => o.assetClass === 'CRYPTO') || stocksRejected.some(o => o.assetClass === 'CRYPTO');

    const cryptoQualified = (scanCrypto.data.qualified || scanCrypto.data.opportunities || []).filter(o => o.symbol !== '_meta');
    const cryptoRejected = (scanCrypto.data.rejected || []).filter(o => o.symbol !== '_meta');
    const cryptoHasStocks = cryptoQualified.some(o => o.assetClass === 'EQUITY') || cryptoRejected.some(o => o.assetClass === 'EQUITY');

    const bothQualified = (scanBoth.data.qualified || scanBoth.data.opportunities || []).filter(o => o.symbol !== '_meta');
    const bothRejected = (scanBoth.data.rejected || []).filter(o => o.symbol !== '_meta');

    let scanSummary = '';
    scanSummary += '================================================================================\n';
    scanSummary += 'BASELINE HEALTH SNAPSHOT: MARKET SCANS (STOCKS / CRYPTO / BOTH)\n';
    scanSummary += 'Captured at: ' + new Date().toISOString() + '\n';
    scanSummary += '================================================================================\n\n';

    scanSummary += `1. STOCKS MODE SCAN:\n`;
    scanSummary += `   - Duration: ${durStocks} ms\n`;
    scanSummary += `   - Qualified Count: ${stocksQualified.length}\n`;
    scanSummary += `   - Rejected Count: ${stocksRejected.length}\n`;
    scanSummary += `   - Asset-Class Purity: ${stocksHasCrypto ? 'FAIL (Crypto leaked into stocks mode)' : 'PASS (100% Equity, 0 Crypto)'}\n\n`;

    scanSummary += `2. CRYPTO MODE SCAN:\n`;
    scanSummary += `   - Duration: ${durCrypto} ms\n`;
    scanSummary += `   - Qualified Count: ${cryptoQualified.length}\n`;
    scanSummary += `   - Rejected Count: ${cryptoRejected.length}\n`;
    scanSummary += `   - Asset-Class Purity: ${cryptoHasStocks ? 'FAIL (Stocks leaked into crypto mode)' : 'PASS (100% Crypto, 0 Equity)'}\n\n`;

    scanSummary += `3. BOTH MODE SCAN:\n`;
    scanSummary += `   - Duration: ${durBoth} ms\n`;
    scanSummary += `   - Qualified Count: ${bothQualified.length}\n`;
    scanSummary += `   - Rejected Count: ${bothRejected.length}\n`;
    scanSummary += `   - Composition: ${bothQualified.filter(o => o.assetClass === 'EQUITY').length} Equities, ${bothQualified.filter(o => o.assetClass === 'CRYPTO').length} Crypto in Qualified\n\n`;

    fs.writeFileSync(path.join(OUT_DIR, 'market_scans_summary.txt'), scanSummary, 'utf8');

    // 4. Data freshness for 5 equity symbols
    console.log('Capturing Data Freshness for 5 Equity Symbols...');
    const equityTestSymbols = ['SPYUSDT', 'QQQUSDT', 'NVDAUSDT', 'TSLAUSDT', 'AAPLUSDT'];
    let freshnessLog = '';
    freshnessLog += '================================================================================\n';
    freshnessLog += 'BASELINE HEALTH SNAPSHOT: DATA FRESHNESS (5 EQUITY SYMBOLS)\n';
    freshnessLog += 'Captured at: ' + new Date().toISOString() + '\n';
    freshnessLog += '================================================================================\n\n';

    const now = Date.now();
    for (const sym of equityTestSymbols) {
      const cRes = await fetchJson(port, `/api/market/candles?symbol=${sym}&timeframe=15m`);
      const candles = cRes.data.candles || [];
      const count = candles.length;
      const lastCandle = count > 0 ? candles[count - 1] : null;
      const lastTs = lastCandle ? lastCandle.timestamp : null;
      const ageSec = lastTs ? Math.round((now - lastTs) / 1000) : null;
      const ageMin = ageSec ? (ageSec / 60).toFixed(1) : null;

      freshnessLog += `Symbol: ${sym}\n`;
      freshnessLog += `  Total Candles: ${count}\n`;
      freshnessLog += `  Latest Candle Timestamp: ${lastTs} (${lastCandle ? new Date(lastTs).toISOString() : 'N/A'})\n`;
      freshnessLog += `  Close Price: $${lastCandle ? lastCandle.close : 'N/A'}\n`;
      freshnessLog += `  Data Source: ${cRes.data.dataSource || 'Bitget V2 Market Feed'}\n`;
      freshnessLog += `  Age from Capture Time: ${ageSec}s (~${ageMin} minutes)\n\n`;
    }
    fs.writeFileSync(path.join(OUT_DIR, 'data_freshness_5_equities.txt'), freshnessLog, 'utf8');

    // 5. WebSocket heartbeat age
    console.log('Capturing WebSocket status and heartbeat...');
    const wsStatusRes = await fetchJson(port, '/api/market/status');
    let wsLog = '';
    wsLog += '================================================================================\n';
    wsLog += 'BASELINE HEALTH SNAPSHOT: WEBSOCKET STATUS & HEARTBEAT AGE\n';
    wsLog += 'Captured at: ' + new Date().toISOString() + '\n';
    wsLog += '================================================================================\n\n';
    wsLog += JSON.stringify(wsStatusRes.data, null, 2) + '\n';
    fs.writeFileSync(path.join(OUT_DIR, 'websocket_heartbeat.txt'), wsLog, 'utf8');

    // 6. Verification Suite run-all
    console.log('Running Verification Suite run-all...');
    const verifRes = await fetchJson(port, '/api/verification/run-all', { method: 'POST' });
    fs.writeFileSync(path.join(OUT_DIR, 'verification_run_all.json'), JSON.stringify(verifRes.data, null, 2), 'utf8');

    // 7. Mainnet-block checks
    console.log('Running Mainnet-Block Checks...');
    const mainnetOrderRes = await fetchJson(port, '/api/orders/mainnet', {
      method: 'POST',
      body: { symbol: 'BTCUSDT', side: 'LONG', quantity: 0.001 },
    });

    let mainnetBlockThrew = false;
    let mainnetBlockError = null;
    try {
      assertMainnetExecutionBlocked('MAINNET');
    } catch (e) {
      mainnetBlockThrew = true;
      mainnetBlockError = e.message;
    }

    let validationThrew = false;
    let validationError = null;
    let validationResult = null;
    try {
      validationResult = validateExecutionMode({ environment: 'MAINNET' });
    } catch (e) {
      validationThrew = true;
      validationError = e.message;
    }

    let mainnetLog = '';
    mainnetLog += '================================================================================\n';
    mainnetLog += 'BASELINE HEALTH SNAPSHOT: MAINNET-BLOCK CHECKS\n';
    mainnetLog += 'Captured at: ' + new Date().toISOString() + '\n';
    mainnetLog += '================================================================================\n\n';

    mainnetLog += `1. isMainnetExecutionAllowed(): ${isMainnetExecutionAllowed()} (Expected: false)\n`;
    mainnetLog += `2. getCurrentMode(): ${getCurrentMode()} (Expected: PAPER)\n`;
    mainnetLog += `3. assertMainnetExecutionBlocked(): Threw=${mainnetBlockThrew}, Error="${mainnetBlockError}"\n`;
    mainnetLog += `4. validateExecutionMode({ environment: 'MAINNET' }):\n`;
    mainnetLog += `   - Threw SafetyViolationError: ${validationThrew}\n`;
    mainnetLog += `   - Error Message: "${validationError}"\n`;
    mainnetLog += `5. POST /api/orders/mainnet HTTP Response:\n`;
    mainnetLog += `   - HTTP Status: ${mainnetOrderRes.status} (Expected: 403)\n`;
    mainnetLog += `   - Body: ${JSON.stringify(mainnetOrderRes.data)}\n\n`;

    fs.writeFileSync(path.join(OUT_DIR, 'mainnet_block_checks.txt'), mainnetLog, 'utf8');

    console.log('--- Step 1: Baseline Snapshot Complete! ---');
  } finally {
    server.stop();
  }
}

main().catch(err => {
  console.error('Fatal error capturing baseline:', err);
  process.exit(1);
});
