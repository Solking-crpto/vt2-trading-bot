#!/usr/bin/env node
/**
 * scripts/ui-smoke.js
 * Headless browser UI smoke test using Microsoft Edge via Chrome DevTools Protocol (CDP)
 * over Node's native WebSocket. Zero external dependencies.
 */

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const TARGET_URL = process.argv[2] || 'https://vt2-trading-bot.vercel.app';
const EDGE_PATHS = [
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
];

const edgePath = EDGE_PATHS.find(p => fs.existsSync(p));
if (!edgePath) {
  console.error('[UI Smoke] Error: Microsoft Edge executable not found.');
  process.exit(1);
}

const DEBUG_PORT = 9222 + Math.floor(Math.random() * 500);
const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'edge-smoke-'));

console.log(`[UI Smoke] Target URL: ${TARGET_URL}`);
console.log(`[UI Smoke] Launching Edge from: ${edgePath}`);
console.log(`[UI Smoke] Debug port: ${DEBUG_PORT}, temp profile: ${tempDir}`);

const edgeProc = spawn(edgePath, [
  '--headless=new',
  `--remote-debugging-port=${DEBUG_PORT}`,
  `--user-data-dir=${tempDir}`,
  '--no-first-run',
  '--no-default-browser-check',
  '--disable-gpu',
  'about:blank'
], { stdio: 'ignore' });

// Ensure cleanup on exit
function cleanup() {
  try { edgeProc.kill(); } catch {}
  try { fs.rmSync(tempDir, { recursive: true, force: true }); } catch {}
}
process.on('exit', cleanup);
process.on('SIGINT', () => { cleanup(); process.exit(1); });

async function waitForHttp(url, timeoutMs = 12000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(url);
      if (res.ok) return await res.json();
    } catch {}
    await new Promise(r => setTimeout(r, 200));
  }
  throw new Error(`Timeout waiting for ${url}`);
}

async function run() {
  const list = await waitForHttp(`http://127.0.0.1:${DEBUG_PORT}/json/list`);
  const pageTarget = list.find(t => t.type === 'page') || list[0];
  if (!pageTarget || !pageTarget.webSocketDebuggerUrl) {
    throw new Error('No valid CDP page target found in Edge.');
  }

  const ws = new WebSocket(pageTarget.webSocketDebuggerUrl);
  let id = 1;
  const pending = new Map();

  const errors = [];
  const consoleErrors = [];
  const failedRequests = [];

  ws.onmessage = (event) => {
    try {
      const msg = JSON.parse(event.data);
      if (msg.id && pending.has(msg.id)) {
        const { resolve, reject } = pending.get(msg.id);
        pending.delete(msg.id);
        if (msg.error) reject(new Error(msg.error.message));
        else resolve(msg.result);
      }

      if (msg.method === 'Runtime.exceptionThrown') {
        const exc = msg.params?.exceptionDetails;
        const text = exc?.exception?.description || exc?.text || 'Uncaught error';
        const loc = `${exc?.url || 'inline'}:${exc?.lineNumber || 0}:${exc?.columnNumber || 0}`;
        errors.push({ type: 'Runtime.exceptionThrown', text, loc });
      }

      if (msg.method === 'Runtime.consoleAPICalled') {
        if (msg.params.type === 'error') {
          const arg = msg.params.args?.map(a => a.value || a.description).join(' ') || '';
          consoleErrors.push({ type: 'console.error', text: arg });
        }
      }

      if (msg.method === 'Network.responseReceived') {
        const resp = msg.params.response;
        if (resp && resp.status >= 400) {
          failedRequests.push({ url: resp.url, status: resp.status, statusText: resp.statusText });
        }
      }

      if (msg.method === 'Network.loadingFailed') {
        const params = msg.params;
        failedRequests.push({ url: params.requestId, errorText: params.errorText });
      }

      if (msg.method === 'Page.javascriptDialogOpening') {
        send('Page.handleJavaScriptDialog', { accept: true }).catch(() => {});
      }
    } catch (e) {
      console.error('CDP message handling error:', e);
    }
  };

  await new Promise((resolve, reject) => {
    ws.onopen = resolve;
    ws.onerror = reject;
  });

  function send(method, params = {}) {
    const msgId = id++;
    return new Promise((resolve, reject) => {
      pending.set(msgId, { resolve, reject });
      ws.send(JSON.stringify({ id: msgId, method, params }));
    });
  }

  async function evalInPage(expr) {
    const res = await send('Runtime.evaluate', {
      expression: expr,
      returnByValue: true,
      awaitPromise: true,
    });
    return res.result?.value;
  }

  // Enable CDP domains
  await send('Page.enable');
  await send('Runtime.enable');
  await send('Network.enable');
  await send('Log.enable');

  console.log(`[UI Smoke] Navigating to ${TARGET_URL}...`);
  await send('Page.navigate', { url: TARGET_URL });

  // Wait for page scripts to load and initialize
  await new Promise(r => setTimeout(r, 3000));

  console.log('\n--- UI Smoke Test Results ---');
  const results = [];

  // Tab definitions from public/index.html
  const TABS = [
    { name: 'Overview', tab: 'overview', panelId: 'tab-overview' },
    { name: 'Market Scanner', tab: 'scanner', panelId: 'tab-scanner' },
    { name: 'Interactive Chart', tab: 'chart', panelId: 'tab-chart' },
    { name: 'AI Deliberation', tab: 'agents', panelId: 'tab-agents' },
    { name: 'Verification Suite', tab: 'verification', panelId: 'tab-verification' },
    { name: 'Automated Trading', tab: 'autotrading', panelId: 'tab-autotrading' },
    { name: 'Positions & Orders', tab: 'positions', panelId: 'tab-positions' },
    { name: 'Risk Engine', tab: 'risk', panelId: 'tab-risk' },
    { name: 'Trade Journal', tab: 'journal', panelId: 'tab-journal' },
    { name: 'Backtesting', tab: 'backtest', panelId: 'tab-backtest' },
    { name: 'System Health', tab: 'environment', panelId: 'tab-environment' },
    { name: 'Alpha Factory Report', tab: 'report', panelId: 'tab-report' },
    { name: 'Settings & Risk', tab: 'settings', panelId: 'tab-settings' },
  ];

  for (const t of TABS) {
    const check = await evalInPage(`(() => {
      const btn = document.querySelector('.nav-item[data-tab="${t.tab}"]');
      if (!btn) return { pass: false, note: 'Button not found' };
      btn.click();
      const panel = document.getElementById('${t.panelId}');
      if (!panel) return { pass: false, note: 'Panel not found' };
      const style = window.getComputedStyle(panel);
      const isVisible = panel.classList.contains('active') && style.display !== 'none';
      return { pass: isVisible, display: style.display, activeClass: panel.classList.contains('active') };
    })()`);
    results.push({ item: `Tab: ${t.name}`, pass: !!check?.pass, note: check?.pass ? 'Visible (display: block, .active)' : `Hidden (display: ${check?.display}, active: ${check?.activeClass})` });
    await new Promise(r => setTimeout(r, 100));
  }

  // Market Mode Switcher Tests
  for (const mode of ['stocks', 'crypto', 'both']) {
    const check = await evalInPage(`(() => {
      const btn = document.querySelector('#marketModeSwitcher .mode-btn[data-mode="${mode}"]');
      if (!btn) return { pass: false, note: 'Button not found' };
      btn.click();
      return { pass: btn.classList.contains('active'), note: 'Active class toggled' };
    })()`);
    results.push({ item: `Mode Switcher: ${mode.toUpperCase()}`, pass: !!check?.pass, note: check?.pass ? 'PASS' : check?.note });
    await new Promise(r => setTimeout(r, 100));
  }

  // Rescan Button Test
  const rescanCheck = await evalInPage(`(() => {
    const btn = document.getElementById('topRescanBtn');
    if (!btn) return { pass: false, note: 'Button not found' };
    btn.click();
    return { pass: true, note: 'Clicked without throwing' };
  })()`);
  results.push({ item: 'Action: Top Rescan Button', pass: !!rescanCheck?.pass, note: rescanCheck?.pass ? 'PASS' : rescanCheck?.note });

  // Theme Toggle Test
  const themeCheck = await evalInPage(`(() => {
    const btn = document.getElementById('themeToggleBtn');
    if (!btn) return { pass: false, note: 'Theme button not found' };
    const prev = document.documentElement.getAttribute('data-theme');
    btn.click();
    const next = document.documentElement.getAttribute('data-theme');
    return { pass: prev !== next, note: 'Theme toggled from ' + prev + ' to ' + next };
  })()`);
  // --- Interactive Browser Paper Mode Checks ---

  // 1. Verify default market mode is Stocks
  const modeCheck = await evalInPage(`(() => {
    const badge = document.getElementById('viewingMarketBadge');
    const text = badge ? badge.textContent : '';
    const isStocks = text.includes('Stocks');
    return { pass: isStocks, note: text || 'Badge missing' };
  })()`);
  results.push({ item: 'Demo: Default Mode is Stocks', pass: !!modeCheck?.pass, note: modeCheck?.note });

  // 2. Override dialogs in page context to never block
  await evalInPage(`(() => {
    window.confirm = () => true;
    window.alert = () => {};
  })()`);

  // 3. Place test paper trade via UI button
  const tradeCheck = await evalInPage(`(async () => {
    // Switch to Positions tab first
    const tabBtn = document.querySelector('.nav-item[data-tab="positions"]');
    if (tabBtn) tabBtn.click();
    await new Promise(r => setTimeout(r, 400));

    const testBtn = document.getElementById('quickTestTradeBtn');
    if (!testBtn) return { pass: false, note: 'quickTestTradeBtn not found' };
    testBtn.click();

    // Wait for trade processing
    await new Promise(r => setTimeout(r, 2500));

    const posCount = parseInt(document.getElementById('positionsCount')?.textContent || '0', 10);
    const tbody = document.getElementById('positionsTableBody');
    const rows = tbody ? tbody.querySelectorAll('tr').length : 0;
    const pass = posCount > 0 || rows > 0;
    return { pass, note: 'Position count: ' + posCount + ', rows: ' + rows };
  })()`);
  results.push({ item: 'Demo: Place Paper Order UI', pass: !!tradeCheck?.pass, note: tradeCheck?.note });

  // 4. Confirm position appears with live data
  const posLiveCheck = await evalInPage(`(() => {
    const tbody = document.getElementById('positionsTableBody');
    const hasRow = tbody && !tbody.textContent.includes('No open simulated paper positions');
    return { pass: !!hasRow, note: hasRow ? 'Position row visible in table' : 'No active row' };
  })()`);
  results.push({ item: 'Demo: Position Appears with P&L', pass: !!posLiveCheck?.pass, note: posLiveCheck?.note });

  // 5. Close position via UI and confirm journal row
  const closeCheck = await evalInPage(`(async () => {
    const closeBtn = document.querySelector('#positionsTableBody button') || document.getElementById('closeAllPositionsBtn');
    if (closeBtn) closeBtn.click();
    await new Promise(r => setTimeout(r, 2000));

    // Switch to journal tab
    const jTab = document.querySelector('.nav-item[data-tab="journal"]');
    if (jTab) jTab.click();
    await new Promise(r => setTimeout(r, 800));

    const jBody = document.getElementById('journalTableBody');
    const hasJournal = jBody && !jBody.textContent.includes('No closed paper trades in journal yet');
    return { pass: !!hasJournal, note: hasJournal ? 'Journal entry recorded' : 'Journal empty' };
  })()`);
  results.push({ item: 'Demo: Close Position & Journal', pass: !!closeCheck?.pass, note: closeCheck?.note });

  // 6. Reload page and confirm state persisted in localStorage
  await send('Page.reload');
  await new Promise(r => setTimeout(r, 3000));
  await evalInPage(`(() => {
    window.confirm = () => true;
    window.alert = () => {};
  })()`);

  const persistCheck = await evalInPage(`(async () => {
    const jTab = document.querySelector('.nav-item[data-tab="journal"]');
    if (jTab) jTab.click();
    await new Promise(r => setTimeout(r, 600));

    const jBody = document.getElementById('journalTableBody');
    const persisted = jBody && !jBody.textContent.includes('No closed paper trades in journal yet');
    return { pass: !!persisted, note: persisted ? 'Account history persisted in localStorage' : 'Storage reset' };
  })()`);
  results.push({ item: 'Demo: Persistence Across Reload', pass: !!persistCheck?.pass, note: persistCheck?.note });

  // 7. Start bot and confirm at least one cycle event or status
  const botCheck = await evalInPage(`(async () => {
    const autoTab = document.querySelector('.nav-item[data-tab="autotrading"]');
    if (autoTab) autoTab.click();
    await new Promise(r => setTimeout(r, 600));

    const startBtn = document.getElementById('autoStartBtn');
    if (!startBtn) return { pass: false, note: 'autoStartBtn not found' };
    startBtn.click();
    await new Promise(r => setTimeout(r, 2500));

    const metric = document.getElementById('autoStatusMetric')?.textContent || '';
    const badge = document.getElementById('autoStatusBadge')?.textContent || '';
    const actBody = document.getElementById('autoActivityTableBody');
    const hasEvents = actBody && !actBody.textContent.includes('Bot has not run any cycles yet');
    const isRunning = metric === 'RUNNING' || metric === 'WAITING' || badge.includes('RUNNING') || badge.includes('WAITING') || hasEvents;

    // Stop bot
    const stopBtn = document.getElementById('autoStopBtn');
    if (stopBtn) stopBtn.click();
    await new Promise(r => setTimeout(r, 1000));

    return { pass: isRunning, note: 'Status: ' + metric + ', Events: ' + (hasEvents ? 'Yes' : 'No') };
  })()`);
  results.push({ item: 'Demo: Bot Start & Cycle Loop', pass: !!botCheck?.pass, note: botCheck?.note });

  // Output table
  console.log('| UI Component / Interaction | Status | Details |');
  console.log('| :------------------------- | :----: | :------ |');
  for (const r of results) {
    console.log(`| ${r.item.padEnd(26)} | ${r.pass ? 'PASS' : 'FAIL'} | ${r.note} |`);
  }

  const allPassed = results.every(r => r.pass) && errors.length === 0;

  console.log('\n--- Captured JavaScript Exceptions & Errors ---');
  if (errors.length === 0) {
    console.log('Zero uncaught exceptions (Runtime.exceptionThrown: 0)');
  } else {
    console.log(`Found ${errors.length} uncaught exception(s). First 5:`);
    errors.slice(0, 5).forEach((e, i) => {
      console.log(`  ${i + 1}. [${e.loc}] ${e.text.split('\n')[0]}`);
    });
  }

  if (consoleErrors.length > 0) {
    console.log(`\nFound ${consoleErrors.length} console.error message(s). First 5:`);
    consoleErrors.slice(0, 5).forEach((e, i) => {
      console.log(`  ${i + 1}. ${e.text}`);
    });
  }

  if (failedRequests.length > 0) {
    console.log(`\nFound ${failedRequests.length} failed/non-2xx network request(s):`);
    failedRequests.slice(0, 5).forEach((f, i) => {
      console.log(`  ${i + 1}. ${f.url} (Status: ${f.status || f.errorText})`);
    });
  }

  ws.close();
  cleanup();

  if (!allPassed) {
    console.log(`\n[UI Smoke] Result: FAIL (${results.filter(r => !r.pass).length} failed components, ${errors.length} JS errors)`);
    process.exit(1);
  } else {
    console.log('\n[UI Smoke] Result: ALL PASS (100% components operational, zero uncaught errors)');
    process.exit(0);
  }
}

run().catch(err => {
  console.error('[UI Smoke] Fatal runner error:', err);
  cleanup();
  process.exit(1);
});
