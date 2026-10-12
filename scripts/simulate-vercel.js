import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, '..');

// 1. Create temp directory
const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vt2-vercel-sim-'));
console.log(`[Vercel Sim] Testing in temp directory: ${tempDir}`);

// Recursive copy helper
function copyDir(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  const entries = fs.readdirSync(src, { withFileTypes: true });
  for (const entry of entries) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      copyDir(srcPath, destPath);
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

// Copy source files needed on Vercel
for (const dir of ['api', 'src', 'config', 'reports', 'public']) {
  const p = path.join(REPO_ROOT, dir);
  if (fs.existsSync(p)) {
    copyDir(p, path.join(tempDir, dir));
  }
}
fs.copyFileSync(path.join(REPO_ROOT, 'package.json'), path.join(tempDir, 'package.json'));
fs.copyFileSync(path.join(REPO_ROOT, 'vercel.json'), path.join(tempDir, 'vercel.json'));

// Apply .vercelignore deletions
const ignoreDeletions = [
  path.join(tempDir, 'reports/alpha-factory/equity_curve.csv'),
  path.join(tempDir, 'reports/alpha-factory/trades.csv'),
  path.join(tempDir, 'data'),
  path.join(tempDir, 'tests'),
  path.join(tempDir, 'media'),
  path.join(tempDir, 'docs'),
  path.join(tempDir, 'start.js')
];

for (const delPath of ignoreDeletions) {
  if (fs.existsSync(delPath)) {
    fs.rmSync(delPath, { recursive: true, force: true });
    console.log(`[Vercel Sim] Ignored/Deleted: ${path.relative(tempDir, delPath)}`);
  }
}

// 2. Set environment variables
process.env.VERCEL = '1';
process.env.DEPLOY_MODE = 'DEMO_READONLY';
process.env.NODE_ENV = 'production';

// 3. Mock req / res helper
function createMockReqRes(options) {
  const req = {
    method: options.method || 'GET',
    url: options.url || '/',
    headers: {
      host: 'vt2-trading-bot.vercel.app',
      'user-agent': 'Vercel-Mock-Client',
      'x-forwarded-for': '127.0.0.1',
      ...(options.headers || {})
    },
    socket: { remoteAddress: '127.0.0.1' },
    on(event, cb) {
      if (event === 'data' && options.body) {
        cb(Buffer.from(typeof options.body === 'string' ? options.body : JSON.stringify(options.body)));
      }
      if (event === 'end') {
        cb();
      }
      return req;
    }
  };

  let statusCode = 200;
  const headers = {};
  const chunks = [];

  const res = {
    statusCode: 200,
    setHeader(k, v) {
      headers[k.toLowerCase()] = v;
      return res;
    },
    writeHead(status, h) {
      statusCode = status;
      res.statusCode = status;
      if (h) {
        for (const [k, v] of Object.entries(h)) {
          headers[k.toLowerCase()] = v;
        }
      }
      return res;
    },
    write(chunk) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      return true;
    },
    end(chunk) {
      if (chunk) {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      }
      res.finished = true;
      res.body = Buffer.concat(chunks).toString('utf8');
      try {
        res.json = JSON.parse(res.body);
      } catch {
        res.json = null;
      }
      return res;
    }
  };

  return { req, res };
}

// 4. Test handler from temp directory
async function runSimulation() {
  // Test direct ping.js module first
  console.log('[Vercel Sim] Testing api/ping.js directly...');
  const pingModule = await import(`file://${path.join(tempDir, 'api/ping.js').replace(/\\/g, '/')}`);
  const { req: pReq, res: pRes } = createMockReqRes({ method: 'GET', url: '/api/ping' });
  await pingModule.default(pReq, pRes);
  if (pRes.statusCode === 200 && pRes.json?.ok === true) {
    console.log(`PASS: Direct api/ping.js returned status 200:`, pRes.body);
  } else {
    throw new Error(`Direct api/ping.js failed: ${pRes.body}`);
  }

  console.log('[Vercel Sim] Loading handler from:', path.join(tempDir, 'api/index.js'));
  const handlerModule = await import(`file://${path.join(tempDir, 'api/index.js').replace(/\\/g, '/')}`);
  const handler = handlerModule.default;

  const testCases = [
    {
      name: '0. Ping probe (/api/ping)',
      options: { method: 'GET', url: '/api/ping' },
      expectedStatus: 200,
      verify: (res) => res.json && res.json.ok === true
    },
    {
      name: '1. Health check (/api/health)',
      options: { method: 'GET', url: '/api/health' },
      expectedStatus: 200,
      verify: (res) => res.json && res.json.status === 'HEALTHY' && res.json.deployMode === 'DEMO_READONLY'
    },
    {
      name: '2. Market Scanner (/api/market/scanner?mode=stocks)',
      options: { method: 'GET', url: '/api/market/scanner?mode=stocks' },
      expectedStatus: 200,
      verify: (res) => res.json && (Array.isArray(res.json) || Array.isArray(res.json.qualified) || res.json.markets)
    },
    {
      name: '3. Blocked Live Order (/api/orders/live -> expect 403)',
      options: { method: 'POST', url: '/api/orders/live', body: { symbol: 'BTCUSDT', quantity: 1 } },
      expectedStatus: 403,
      verify: (res) => res.statusCode === 403
    },
    {
      name: '4. Demo ReadOnly Paper Order (/api/orders/paper -> expect 501)',
      options: { method: 'POST', url: '/api/orders/paper', body: { symbol: 'BTCUSDT', quantity: 1 } },
      expectedStatus: 501,
      verify: (res) => res.statusCode === 501 && res.json && res.json.error === 'DEMO_READONLY'
    },
    {
      name: '5. Alpha Factory Report (/api/report/alpha-factory)',
      options: { method: 'GET', url: '/api/report/alpha-factory' },
      expectedStatus: 200,
      verify: (res) => res.json && res.json.status === 'SUCCESS' && res.json.metrics !== null
    }
  ];

  let allPassed = true;
  for (const tc of testCases) {
    console.log(`\n--- Testing ${tc.name} ---`);
    const { req, res } = createMockReqRes(tc.options);
    try {
      await handler(req, res);
      const passed = res.statusCode === tc.expectedStatus && tc.verify(res);
      if (passed) {
        console.log(`PASS: Status ${res.statusCode}`);
        if (res.json) console.log('Response sample:', JSON.stringify(res.json).slice(0, 140) + '...');
      } else {
        console.error(`FAIL: Got status ${res.statusCode}, expected ${tc.expectedStatus}`);
        console.error('Response body:', res.body.slice(0, 300));
        allPassed = false;
      }
    } catch (err) {
      console.error(`ERROR: Handler threw exception:`, err);
      allPassed = false;
    }
  }

  // Cleanup temp dir
  try {
    fs.rmSync(tempDir, { recursive: true, force: true });
    console.log('\n[Vercel Sim] Temp directory cleaned up.');
  } catch {}

  if (!allPassed) {
    process.exit(1);
  }
  console.log('\n=== ALL VERCEL SIMULATION TESTS PASSED ===');
}

runSimulation().catch(err => {
  console.error('[Vercel Sim Fatal Error]:', err);
  process.exit(1);
});

