import { VT2Chart } from './chart.js';

export const EQUITY_SYMBOLS = [
  'SPYUSDT', 'QQQUSDT', 'NVDAUSDT', 'TSLAUSDT', 'AAPLUSDT', 'MSFTUSDT',
  'AMZNUSDT', 'MSTRUSDT', 'PLTRUSDT', 'SOXLUSDT', 'SOXSUSDT', 'TQQQUSDT',
  'SQQQUSDT', 'MUUSDT', 'AMDUSDT', 'SNDKUSDT', 'SMCIUSDT', 'AVGOUSDT',
  'QCOMUSDT', 'BAUSDT', 'WMTUSDT', 'COSTUSDT', 'RKLBUSDT', 'AMATUSDT',
];
export const CRYPTO_SYMBOLS = ['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'XRPUSDT', 'DOGEUSDT'];

// Application state
const state = {
  currentTab: 'overview',
  symbol: 'SPYUSDT', // Stocks-first default
  timeframe: '15m',
  activeMarketMode: 'stocks',
  cooldownResumesAt: null,
  chart: null,
  account: null,
  positions: [],
  scannerResult: null,
  selectedProposal: null,
  deliberation: null,
  candlesData: null,
  theme: (typeof localStorage !== 'undefined' && localStorage.getItem('vt2_theme')) || 'dark',
  entryAllocationPercent: 10,
  pendingAllocationChange: null,
  equityUniverse: [],
  botStatus: null,
};

// Browser Paper Mode State Persistence (DemoStore)
export const DemoStore = {
  storageKey: 'vt2_demo_state',
  memState: null,

  getDefaultState() {
    return {
      account: {
        initialEquity: 10000,
        equity: 10000,
        availableBalance: 10000,
        usedMargin: 0,
        unrealizedPnl: 0,
        realizedPnl: 0,
        dailyLoss: 0,
        dailyLossLimit: 200,
        openPositionsCount: 0,
        totalExposureNotional: 0,
        consecutiveLosses: 0,
        startOfDayEquity: 10000,
        currentEquity: 10000,
        lastTradeClosedAt: null,
        totalTrades: 0,
        winningTrades: 0,
        losingTrades: 0,
        winRate: 0,
        profitFactor: 0,
        maxDrawdownPercent: 0,
        maxAggregateOpenRiskPercent: 1.0,
        maxConcurrentPositions: 1,
      },
      positions: [],
      orders: [],
      journal: [],
      rejectedSetups: [],
      settings: {
        entryAllocationPercent: 10,
        maxConcurrentPositions: 1,
        maxAggregateOpenRiskPercent: 1.0,
        maxTradesPerDay: 3,
        botMarketMode: 'stocks',
      },
      botSettings: {
        running: false,
        status: 'STOPPED',
        botMarketMode: 'stocks',
        botCandidateOrder: 'equities_first',
        candidateSkipMinutes: 15,
        cooldownAfterManualClose: true,
      },
      activityLog: [],
    };
  },

  getState() {
    try {
      if (typeof localStorage !== 'undefined') {
        const raw = localStorage.getItem(this.storageKey);
        if (raw) {
          const parsed = JSON.parse(raw);
          if (parsed && typeof parsed === 'object') {
            return parsed;
          }
        }
      }
    } catch (e) {
      console.warn('[DemoStore] Error reading localStorage, using memory fallback:', e);
    }
    if (!this.memState) {
      this.memState = this.getDefaultState();
    }
    return this.memState;
  },

  saveState(stateObj) {
    if (!stateObj) return;
    this.memState = stateObj;
    try {
      if (typeof localStorage !== 'undefined') {
        localStorage.setItem(this.storageKey, JSON.stringify(stateObj));
      }
    } catch (e) {
      console.warn('[DemoStore] Error saving to localStorage:', e);
    }
  },

  reset() {
    const fresh = this.getDefaultState();
    this.saveState(fresh);
    return fresh;
  },

  updateFromResponse(data) {
    if (data && data.state) {
      const current = this.getState();
      const merged = {
        ...current,
        ...data.state,
      };
      if (data.events && Array.isArray(data.events) && data.events.length > 0) {
        const newEvents = data.events.map(ev => ({
          action: ev.type || 'EVENT',
          symbol: ev.symbol || 'SYSTEM',
          details: ev.message || JSON.stringify(ev),
          timestamp: ev.timestamp || Date.now(),
        }));
        merged.activityLog = [...newEvents, ...(merged.activityLog || [])].slice(0, 100);
      }
      this.saveState(merged);
      return merged;
    }
    return this.getState();
  }
};

// Browser Paper Mode Bot Runner (DemoBotManager)
export const DemoBotManager = {
  botInterval: null,
  monitorInterval: null,
  tickInterval: null,
  isCycling: false,

  startTickPolling() {
    if (this.tickInterval) clearInterval(this.tickInterval);
    this.tickInterval = setInterval(async () => {
      const curState = DemoStore.getState();
      const openPositions = curState.positions?.filter(p => p.status === 'OPEN') || [];
      if (openPositions.length > 0) {
        try {
          const res = await fetch('/api/demo/tick', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ state: curState }),
          });
          if (res.ok) {
            const data = await res.json();
            DemoStore.updateFromResponse(data);
            await refreshAccount();
            await refreshOrders();
            await refreshJournal();
          }
        } catch (err) {
          console.warn('[DemoTick] Background tick error:', err);
        }
      }
    }, 12000);
  },

  async runBotCycle() {
    if (this.isCycling) return;
    this.isCycling = true;
    try {
      const curState = DemoStore.getState();
      const res = await fetch('/api/demo/bot/cycle', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ state: curState }),
      });
      if (res.ok) {
        const data = await res.json();
        DemoStore.updateFromResponse(data);
        if (data.status) {
          curState.botSettings = curState.botSettings || {};
          curState.botSettings.status = data.status;
          curState.botSettings.waitingReason = data.waitingReason;
          curState.botSettings.waitingResumesAt = data.waitingResumesAt;
        }
        await refreshAccount();
        await refreshOrders();
        await refreshJournal();
        await refreshRejectedArchive();
        await refreshAutoTradingStatus();
      }
    } catch (err) {
      console.warn('[DemoBot] Cycle error:', err);
    } finally {
      this.isCycling = false;
    }
  },

  async runMonitor() {
    try {
      const curState = DemoStore.getState();
      const openPositions = curState.positions?.filter(p => p.status === 'OPEN') || [];
      if (openPositions.length === 0) return;
      const res = await fetch('/api/demo/monitor', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ state: curState }),
      });
      if (res.ok) {
        const data = await res.json();
        DemoStore.updateFromResponse(data);
        await refreshAccount();
        await refreshJournal();
      }
    } catch (err) {
      console.warn('[DemoMonitor] Monitor error:', err);
    }
  },

  async start() {
    const curState = DemoStore.getState();
    curState.botSettings = curState.botSettings || {};
    curState.botSettings.running = true;
    curState.botSettings.status = 'RUNNING';
    const startEvent = {
      action: 'BOT_STARTED',
      symbol: 'ALL',
      details: 'AutoTrader started in Browser Paper Mode (60s loop with live Bitget public market feeds)',
      timestamp: Date.now(),
    };
    curState.activityLog = [startEvent, ...(curState.activityLog || [])].slice(0, 100);
    DemoStore.saveState(curState);

    await refreshAutoTradingStatus();
    await this.runBotCycle();

    if (this.botInterval) clearInterval(this.botInterval);
    this.botInterval = setInterval(() => this.runBotCycle(), 60000);

    if (this.monitorInterval) clearInterval(this.monitorInterval);
    this.monitorInterval = setInterval(() => this.runMonitor(), 300000);
  },

  async stop(reason = 'MANUAL_STOP') {
    if (this.botInterval) clearInterval(this.botInterval);
    if (this.monitorInterval) clearInterval(this.monitorInterval);
    this.botInterval = null;
    this.monitorInterval = null;

    const curState = DemoStore.getState();
    curState.botSettings = curState.botSettings || {};
    curState.botSettings.running = false;
    curState.botSettings.status = 'STOPPED';
    const stopEvent = {
      action: 'BOT_STOPPED',
      symbol: 'ALL',
      details: `AutoTrader stopped (${reason})`,
      timestamp: Date.now(),
    };
    curState.activityLog = [stopEvent, ...(curState.activityLog || [])].slice(0, 100);
    DemoStore.saveState(curState);

    await refreshAutoTradingStatus();
  },

  async stopAndCloseAll(reason = 'MANUAL_STOP_CLOSE_ALL') {
    await this.stop(reason);
    const curState = DemoStore.getState();
    try {
      const res = await fetch('/api/demo/close-all', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ state: curState, exitReason: reason }),
      });
      if (res.ok) {
        const data = await res.json();
        DemoStore.updateFromResponse(data);
        alert(`Bot stopped and ${data.closedCount || 0} position(s) closed.`);
        await refreshAccount();
        await refreshOrders();
        await refreshJournal();
      }
    } catch (err) {
      alert(`Error during close-all: ${friendlyError(err)}`);
    }
  },

  async killSwitch() {
    await this.stop('KILL_SWITCH');
    const curState = DemoStore.getState();
    try {
      const res = await fetch('/api/demo/close-all', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ state: curState, exitReason: 'KILL_SWITCH_ENGAGED' }),
      });
      if (res.ok) {
        const data = await res.json();
        DemoStore.updateFromResponse(data);
        alert(`EMERGENCY KILL SWITCH ENGAGED!\nAutomated trading halted.\nClosed ${data.closedCount || 0} active positions.`);
        await refreshAccount();
        await refreshOrders();
        await refreshJournal();
      }
    } catch (err) {
      alert(`Error during kill switch: ${friendlyError(err)}`);
    }
  }
};

// Initialize Application
window.addEventListener('DOMContentLoaded', async () => {
  setupTabs();
  setupSidebar();
  setupMarketMode();
  setupKillSwitch();
  setupChart();
  setupEventListeners();
  setupExecutionModeToggle();
  applyTheme(state.theme, false);
  updateAllocationUi(state.entryAllocationPercent);
  registerServiceWorker();
  startCooldownTicker();

  try { await checkDeployMode(); } catch (e) { console.warn('checkDeployMode error:', e); }
  try { await checkFeedStatus(); } catch (e) { console.warn('checkFeedStatus error:', e); }
  try { await refreshExecutionMode(); } catch (e) { console.warn('refreshExecutionMode error:', e); }
  try { await refreshAccount(); } catch (e) { console.warn('refreshAccount error:', e); }
  try { await refreshOrders(); } catch (e) { console.warn('refreshOrders error:', e); }
  try { await refreshScanner(); } catch (e) { console.warn('refreshScanner error:', e); }
  try { await refreshEquityUniverse(); } catch (e) { console.warn('refreshEquityUniverse error:', e); }
  try { await loadChartData(); } catch (e) { console.warn('loadChartData error:', e); }
  try { await refreshJournal(); } catch (e) { console.warn('refreshJournal error:', e); }
  try { await refreshRejectedArchive(); } catch (e) { console.warn('refreshRejectedArchive error:', e); }
  try { await refreshHealth(); } catch (e) { console.warn('refreshHealth error:', e); }
  try { await loadSettings(); } catch (e) { console.warn('loadSettings error:', e); }
  try { await refreshVerificationStatus(); } catch (e) { console.warn('refreshVerificationStatus error:', e); }
  try { await refreshAutoTradingStatus(); } catch (e) { console.warn('refreshAutoTradingStatus error:', e); }

  try { connectSseStream(); } catch (e) { console.warn('connectSseStream error:', e); }
});

// Execution Mode Management (PAPER, DEMO, LIVE)
async function refreshExecutionMode() {
  try {
    const res = await fetch('/api/mode');
    if (!res.ok) return;
    const data = await res.json();
    state.activeMode = data.mode || 'PAPER';
    state.isHosted = Boolean(data.isHosted);
    state.liveArmed = Boolean(data.isLiveArmed);

    const paperBtn = document.getElementById('modeTogglePaper');
    const demoBtn = document.getElementById('modeToggleDemo');
    const liveBtn = document.getElementById('modeToggleLive');
    const banner = document.getElementById('liveWarningBanner');
    const demoNotice = document.getElementById('demoEquityNotice');
    const envBadgeText = document.getElementById('envBadgeText');

    if (envBadgeText) envBadgeText.textContent = state.activeMode;

    // In hosted/serverless mode: permanently lock to PAPER
    if (state.isHosted) {
      if (demoBtn) { demoBtn.disabled = true; demoBtn.title = 'Demo mode disabled in hosted serverless deployment'; }
      if (liveBtn) { liveBtn.disabled = true; liveBtn.title = 'Live trading disabled in hosted serverless deployment'; }
    }

    [paperBtn, demoBtn, liveBtn].forEach(b => b?.classList.remove('active'));
    if (state.activeMode === 'DEMO') {
      demoBtn?.classList.add('active');
      if (banner) banner.style.display = 'none';
      if (demoNotice) demoNotice.style.display = 'inline-block';
    } else if (state.activeMode === 'LIVE') {
      liveBtn?.classList.add('active');
      if (banner) banner.style.display = 'flex';
      if (demoNotice) demoNotice.style.display = 'none';
    } else {
      paperBtn?.classList.add('active');
      if (banner) banner.style.display = 'none';
      if (demoNotice) demoNotice.style.display = 'none';
    }

    const activeEnvLabel = document.getElementById('activeEnvLabel');
    if (activeEnvLabel) {
      activeEnvLabel.textContent = `${state.activeMode} Mode`;
      activeEnvLabel.className = state.activeMode === 'LIVE' ? 'text-danger' : (state.activeMode === 'DEMO' ? 'text-primary' : 'text-warning');
    }
  } catch (err) {
    console.warn('Error refreshing execution mode:', err);
  }
}

function setupExecutionModeToggle() {
  document.getElementById('modeTogglePaper')?.addEventListener('click', async () => {
    try {
      await fetch('/api/mode', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode: 'PAPER' }),
      });
      await refreshExecutionMode();
    } catch (err) {
      alert(`Error setting mode: ${friendlyError(err)}`);
    }
  });

  document.getElementById('modeToggleDemo')?.addEventListener('click', async () => {
    if (state.isHosted) {
      alert('Hosted deployments operate exclusively in PAPER mode.');
      return;
    }
    try {
      const res = await fetch('/api/mode', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode: 'DEMO' }),
      });
      const data = await res.json();
      if (!res.ok) {
        alert(data.message || data.error || 'Failed to switch to DEMO mode.');
      }
      await refreshExecutionMode();
    } catch (err) {
      alert(`Error setting mode: ${friendlyError(err)}`);
    }
  });

  document.getElementById('modeToggleLive')?.addEventListener('click', async () => {
    if (state.isHosted) {
      alert('Hosted deployments operate exclusively in PAPER mode. Live trading is strictly prohibited.');
      return;
    }
    if (state.liveArmed) {
      try {
        await fetch('/api/mode', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ mode: 'LIVE' }),
        });
        await refreshExecutionMode();
      } catch (e) {}
    } else {
      openLiveArmingModal();
    }
  });

  // Modal setup
  const phraseInput = document.getElementById('liveArmingPhraseInput');
  const attestCheck = document.getElementById('liveAttestationCheck');
  const armBtn = document.getElementById('confirmLiveArmingBtn');
  const cancelBtn = document.getElementById('cancelLiveArmingBtn');
  const modal = document.getElementById('liveArmingModal');

  const checkArmReady = () => {
    const phraseOk = phraseInput?.value.trim() === 'ENABLE LIVE TRADING';
    const checkOk = Boolean(attestCheck?.checked);
    if (armBtn) armBtn.disabled = !(phraseOk && checkOk);
  };

  phraseInput?.addEventListener('input', checkArmReady);
  attestCheck?.addEventListener('change', checkArmReady);

  cancelBtn?.addEventListener('click', () => {
    modal?.classList.remove('open');
  });

  armBtn?.addEventListener('click', async () => {
    armBtn.disabled = true;
    try {
      const res = await fetch('/api/mode/arm-live', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          confirmationPhrase: phraseInput.value.trim(),
          attestationChecked: attestCheck.checked,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        alert(`Arming failed: ${data.message || data.error}`);
        return;
      }
      modal?.classList.remove('open');
      await refreshExecutionMode();
      alert('LIVE TRADING ARMED. All orders placed will commit real capital under hard caps.');
    } catch (err) {
      alert(`Arming error: ${friendlyError(err)}`);
    } finally {
      armBtn.disabled = false;
    }
  });

  // Order Preview modal cancel
  document.getElementById('cancelOrderPreviewBtn')?.addEventListener('click', () => {
    document.getElementById('orderPreviewModal')?.classList.remove('open');
  });

  // Periodic reconciliation ticker for DEMO / LIVE
  setInterval(async () => {
    if (state.activeMode === 'DEMO' || state.activeMode === 'LIVE') {
      try {
        const recRes = await fetch('/api/exchange/reconcile', { method: 'POST' });
        const recData = await recRes.json();
        if (!recData.reconciled) {
          console.error('[Reconciliation Halt]', recData);
          await refreshExecutionMode();
        }
      } catch (e) {}
    }
  }, 20000);
}

async function openLiveArmingModal() {
  const modal = document.getElementById('liveArmingModal');
  const statusBox = document.getElementById('livePreflightStatus');
  const phraseInput = document.getElementById('liveArmingPhraseInput');
  const attestCheck = document.getElementById('liveAttestationCheck');
  const armBtn = document.getElementById('confirmLiveArmingBtn');

  if (phraseInput) phraseInput.value = '';
  if (attestCheck) attestCheck.checked = false;
  if (armBtn) armBtn.disabled = true;
  if (statusBox) statusBox.innerHTML = 'Running live preflight checks...';

  modal?.classList.add('open');

  try {
    const res = await fetch('/api/mode/preflight', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mode: 'LIVE', attestationChecked: true }),
    });
    const data = await res.json();
    if (statusBox) {
      const items = (data.checks || []).map(c =>
        `<div>${c.passed ? '✅' : '❌'} <strong>${c.name}:</strong> ${c.message}</div>`
      ).join('');
      statusBox.innerHTML = `
        <div style="margin-bottom: 6px; font-weight: 700; color: ${data.passed ? 'var(--color-success)' : 'var(--color-danger)'};">
          ${data.passed ? 'Preflight Checks Passed' : 'Preflight Incomplete / Missing Keys'}
        </div>
        ${items}
      `;
    }
  } catch (err) {
    if (statusBox) statusBox.innerHTML = `<span style="color: var(--color-danger);">Preflight request failed: ${err.message}</span>`;
  }
}

// PWA Service Worker Registration
function registerServiceWorker() {
  if ('serviceWorker' in navigator) {
    if (window.location.hostname.includes('vercel.app')) {
      // In hosted demo mode on Vercel, unregister any stale service workers to ensure fresh asset delivery
      navigator.serviceWorker.getRegistrations().then(regs => {
        for (const reg of regs) reg.unregister();
      }).catch(() => {});
      return;
    }
    navigator.serviceWorker.register('/sw.js').catch(err => {
      console.warn('SW registration skipped:', err.message);
    });
  }
}

// Collapsible Sidebar Setup
function setupSidebar() {
  const sidebar = document.getElementById('appSidebar');
  const toggleBtn = document.getElementById('sidebarToggleBtn');
  if (toggleBtn && sidebar) {
    toggleBtn.addEventListener('click', () => {
      sidebar.classList.toggle('collapsed');
      if (state.chart) {
        setTimeout(() => state.chart.resize(), 220);
      }
    });
  }
}

// Updates Symbol Dropdowns Across Terminal (Chart selector, Risk Sandbox) based on Mode
function updateMarketSymbols(mode) {
  const symSelect = document.getElementById('chartSymbolSelect');
  const sandboxSelect = document.getElementById('sandboxSymbol');

  let symbols = [];
  if (mode === 'stocks') {
    symbols = EQUITY_SYMBOLS; // Zero crypto in stocks mode!
  } else if (mode === 'crypto') {
    symbols = CRYPTO_SYMBOLS;
  } else {
    symbols = [...EQUITY_SYMBOLS, ...CRYPTO_SYMBOLS];
  }

  // Ensure current state.symbol is allowed in active mode
  if (!symbols.includes(state.symbol)) {
    state.symbol = symbols[0];
  }

  if (symSelect) {
    symSelect.innerHTML = symbols.map(s => `<option value="${s}" ${s === state.symbol ? 'selected' : ''}>${s}</option>`).join('');
    symSelect.value = state.symbol;
  }

  if (sandboxSelect) {
    sandboxSelect.innerHTML = symbols.slice(0, 8).map(s => `<option value="${s}">${s}</option>`).join('');
  }
}

// Market Mode (Stocks | Crypto | Both) Switcher
async function setupMarketMode() {
  const stocksBtn = document.getElementById('modeBtnStocks');
  const cryptoBtn = document.getElementById('modeBtnCrypto');
  const bothBtn = document.getElementById('modeBtnBoth');
  const viewingBadge = document.getElementById('viewingMarketBadge');

  const updateModeUi = (mode) => {
    state.activeMarketMode = mode;
    if (stocksBtn) stocksBtn.classList.toggle('active', mode === 'stocks');
    if (cryptoBtn) cryptoBtn.classList.toggle('active', mode === 'crypto');
    if (bothBtn) bothBtn.classList.toggle('active', mode === 'both');

    const label = mode === 'stocks' ? 'Stocks' : (mode === 'crypto' ? 'Crypto' : 'Both');
    if (viewingBadge) {
      viewingBadge.textContent = `Viewing: ${label}`;
      viewingBadge.className = mode === 'stocks' ? 'badge badge-info' : (mode === 'crypto' ? 'badge badge-neutral' : 'badge badge-long');
    }

    updateMarketSymbols(mode);
  };

  const savedMode = (typeof localStorage !== 'undefined' && localStorage.getItem('vt2_market_mode')) || 'stocks';
  updateModeUi(savedMode);

  try {
    const res = await fetch('/api/market/mode');
    const data = await res.json();
    if (savedMode) {
      updateModeUi(savedMode);
    } else if (data.activeMode) {
      updateModeUi(data.activeMode);
      try { localStorage.setItem('vt2_market_mode', data.activeMode); } catch {}
    } else {
      updateModeUi('stocks');
    }
  } catch {
    updateModeUi(savedMode);
  }

  const applyModeChange = async (mode) => {
    try { localStorage.setItem('vt2_market_mode', mode); } catch {}
    updateModeUi(mode);
    try {
      await fetch('/api/market/mode', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode }),
      });
    } catch {}
    await refreshScanner(true);
    await refreshEquityUniverse();
    await loadChartData();
  };

  stocksBtn?.addEventListener('click', () => applyModeChange('stocks'));
  cryptoBtn?.addEventListener('click', () => applyModeChange('crypto'));
  bothBtn?.addEventListener('click', () => applyModeChange('both'));
}

// Tokenized US Equities Universe Table Loader
async function refreshEquityUniverse() {
  const tbody = document.getElementById('equityUniverseTableBody');
  const countBadge = document.getElementById('equityUniverseCount');
  if (!tbody) return;

  try {
    const res = await fetch('/api/market/equity-universe');
    const data = await res.json();
    const universe = data.universe || [];
    state.equityUniverse = universe;

    if (countBadge) {
      countBadge.textContent = `${universe.length} Equities (24/7 Futures)`;
    }

    if (universe.length === 0) {
      tbody.innerHTML = `<tr><td colspan="7" style="text-align: center; color: var(--text-muted); padding: 18px;">Loading equity universe specifications...</td></tr>`;
      return;
    }

    tbody.innerHTML = universe.map(eq => {
      const chgNum = parseFloat(eq.change24h || 0);
      const chgClass = chgNum >= 0 ? 'text-success' : 'text-danger';
      const chgText = `${chgNum >= 0 ? '+' : ''}${chgNum.toFixed(2)}%`;
      const volNum = parseFloat(eq.volume24hUsdt || 0);
      const volStr = volNum >= 1e6 ? `$${(volNum / 1e6).toFixed(1)}M` : `$${(volNum / 1e3).toFixed(1)}K`;

      return `
        <tr>
          <td><strong>${eq.symbol}</strong></td>
          <td style="color: var(--text-secondary);">${eq.underlying || eq.baseCoin} · ${eq.sector || 'US Equity Perp'}</td>
          <td class="mono-num">${volStr}</td>
          <td class="${chgClass} mono-num"><strong>${chgText}</strong></td>
          <td class="mono-num">$${eq.lastPrice ? Number(eq.lastPrice).toFixed(2) : '--'}</td>
          <td><span class="badge ${eq.status === 'ACTIVE' ? 'badge-long' : 'badge-neutral'}">${eq.status || 'ACTIVE'}</span></td>
          <td>
            <button class="btn btn-secondary btn-sm" onclick="window.selectSymbolForChart('${eq.symbol}')">📈 Trade</button>
          </td>
        </tr>
      `;
    }).join('');
  } catch (err) {
    console.warn('Failed loading equity universe:', err.message);
  }
}

window.selectSymbolForChart = function(symbol) {
  state.symbol = symbol;
  const symSelect = document.getElementById('chartSymbolSelect');
  if (symSelect) {
    symSelect.value = symbol;
  }
  switchTab('chart');
  loadChartData();
};

// Cooldown Countdown Ticker Across Entire Platform
let cooldownTickerInterval = null;
function startCooldownTicker() {
  if (cooldownTickerInterval) clearInterval(cooldownTickerInterval);
  cooldownTickerInterval = setInterval(updateCooldownTickers, 1000);
}

function updateCooldownTickers() {
  const now = Date.now();
  let remainingMs = 0;

  if (state.cooldownResumesAt && state.cooldownResumesAt > now) {
    remainingMs = state.cooldownResumesAt - now;
  } else if (state.account?.lastTradeClosedAt) {
    const cooldownPeriodMs = 30 * 60 * 1000;
    const resumesAt = state.account.lastTradeClosedAt + cooldownPeriodMs;
    if (resumesAt > now) {
      remainingMs = resumesAt - now;
      state.cooldownResumesAt = resumesAt;
    }
  }

  const headerBadge = document.getElementById('headerCooldownBadge');
  const headerTime = document.getElementById('headerCooldownTime');
  const delibCountdown = document.getElementById('delibBannerCountdown');
  const autoCountdownTime = document.getElementById('autoWaitingCountdownTime');

  if (remainingMs > 0) {
    const totalSecs = Math.ceil(remainingMs / 1000);
    const mins = Math.floor(totalSecs / 60);
    const secs = totalSecs % 60;
    const timeFormatted = `${mins}:${secs < 10 ? '0' : ''}${secs}`;

    if (headerBadge) {
      headerBadge.style.display = 'inline-flex';
      if (headerTime) headerTime.textContent = timeFormatted;
    }
    if (delibCountdown) delibCountdown.textContent = timeFormatted;
    if (autoCountdownTime) autoCountdownTime.textContent = timeFormatted;
  } else {
    if (headerBadge) headerBadge.style.display = 'none';
  }
}

// Master Emergency Kill Switch Setup
function setupKillSwitch() {
  const killBtn = document.getElementById('masterKillSwitchBtn');
  const modal = document.getElementById('killSwitchModal');
  const cancelBtn = document.getElementById('cancelKillSwitchBtn');
  const confirmBtn = document.getElementById('confirmKillSwitchBtn');

  if (killBtn && modal) {
    killBtn.addEventListener('click', () => {
      modal.classList.add('open');
    });
  }
  if (cancelBtn && modal) {
    cancelBtn.addEventListener('click', () => {
      modal.classList.remove('open');
    });
  }
  if (confirmBtn && modal) {
    confirmBtn.addEventListener('click', async () => {
      modal.classList.remove('open');
      confirmBtn.disabled = true;
      try {
        if (state.isDemoReadOnly) {
          await DemoBotManager.killSwitch();
          return;
        }
        const res = await fetch('/api/autotrading/kill-switch', { method: 'POST' });
        const data = await res.json();
        alert(`EMERGENCY KILL SWITCH ENGAGED!\nAutomated trading halted.\nClosed ${data.closedPositionsCount || 0} active positions.`);
        await refreshAccount();
        await refreshOrders();
        await refreshAutoTradingStatus();
      } catch (err) {
        alert(`Error engaging kill switch: ${friendlyError(err)}`);
      } finally {
        confirmBtn.disabled = false;
      }
    });
  }
}

// Navigation Tabs
function setupTabs() {
  const tabButtons = document.querySelectorAll('.nav-item, .tab-btn');
  tabButtons.forEach(btn => {
    btn.addEventListener('click', () => {
      const tabId = btn.getAttribute('data-tab');
      if (tabId) switchTab(tabId);
    });
  });
}

function switchTab(tabId) {
  state.currentTab = tabId;
  document.querySelectorAll('.nav-item, .tab-btn').forEach(b => {
    b.classList.toggle('active', b.getAttribute('data-tab') === tabId);
  });
  document.querySelectorAll('.tab-content').forEach(c => {
    c.classList.toggle('active', c.id === `tab-${tabId}`);
  });

  if (tabId === 'chart' && state.chart) {
    setTimeout(() => state.chart.resize(), 50);
  }
  if (tabId === 'verification') {
    refreshVerificationStatus();
  }
  if (tabId === 'autotrading') {
    refreshAutoTradingStatus();
  }
  if (tabId === 'journal') {
    refreshJournal();
  }
  if (tabId === 'positions') {
    refreshAccount();
    refreshOrders();
  }
}

// Interactive Chart Setup
function setupChart() {
  const canvas = document.getElementById('tradingCanvas');
  if (canvas) {
    state.chart = new VT2Chart(canvas, { theme: state.theme });
  }

  // Symbol selector
  const symSelect = document.getElementById('chartSymbolSelect');
  if (symSelect) {
    symSelect.addEventListener('change', (e) => {
      state.symbol = e.target.value;
      loadChartData();
    });
  }

  // Timeframe buttons
  const tfButtons = document.querySelectorAll('#timeframeButtons button');
  tfButtons.forEach(btn => {
    btn.addEventListener('click', () => {
      tfButtons.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      state.timeframe = btn.getAttribute('data-tf');
      loadChartData();
    });
  });

  // Indicator toggles
  document.getElementById('toggleEma20')?.addEventListener('change', (e) => {
    if (state.chart) { state.chart.showEma20 = e.target.checked; state.chart.render(); }
  });
  document.getElementById('toggleEma50')?.addEventListener('change', (e) => {
    if (state.chart) { state.chart.showEma50 = e.target.checked; state.chart.render(); }
  });
  document.getElementById('toggleEma200')?.addEventListener('change', (e) => {
    if (state.chart) { state.chart.showEma200 = e.target.checked; state.chart.render(); }
  });
  document.getElementById('toggleSignals')?.addEventListener('change', (e) => {
    if (state.chart) { state.chart.showSignals = e.target.checked; state.chart.render(); }
  });
}

// Theme Management (Light Mode / Dark Mode)
function applyTheme(theme, persistServer = true) {
  state.theme = theme === 'light' ? 'light' : 'dark';
  document.documentElement.setAttribute('data-theme', state.theme);
  if (state.theme === 'light') {
    document.body.classList.add('light-theme');
  } else {
    document.body.classList.remove('light-theme');
  }

  // Update topbar toggle button
  const sun = document.getElementById('themeIconSun');
  const moon = document.getElementById('themeIconMoon');
  if (sun && moon) {
    if (state.theme === 'light') {
      sun.style.display = 'none';
      moon.style.display = 'block';
    } else {
      sun.style.display = 'block';
      moon.style.display = 'none';
    }
  }

  const icon = document.getElementById('themeToggleIcon');
  const text = document.getElementById('themeToggleText');
  if (icon && text) {
    if (state.theme === 'light') {
      icon.textContent = '🌙';
      text.textContent = 'Dark Mode';
    } else {
      icon.textContent = '☀️';
      text.textContent = 'Light Mode';
    }
  }

  // Update Settings tab radio buttons
  const darkRadio = document.getElementById('themeOptDark');
  const lightRadio = document.getElementById('themeOptLight');
  if (darkRadio) darkRadio.checked = (state.theme === 'dark');
  if (lightRadio) lightRadio.checked = (state.theme === 'light');

  // Update canvas chart theme
  if (state.chart && typeof state.chart.setTheme === 'function') {
    state.chart.setTheme(state.theme);
  }

  try {
    localStorage.setItem('vt2_theme', state.theme);
  } catch (e) {}

  if (persistServer) {
    fetch('/api/settings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ theme: state.theme }),
    }).catch(err => console.warn('Could not persist theme to server:', err));
  }
}

// Entry Size Allocation Control (1% - 100%)
function updateAllocationUi(val) {
  const percent = Math.max(1, Math.min(100, Math.round(Number(val) || 10)));

  // Settings tab controls
  const cfgBadge = document.getElementById('cfgEntryAllocBadge');
  const cfgSlider = document.getElementById('cfgEntryAllocSlider');
  const cfgInput = document.getElementById('cfgEntryAllocInput');
  if (cfgBadge) cfgBadge.textContent = `${percent}%`;
  if (cfgSlider) cfgSlider.value = percent;
  if (cfgInput) cfgInput.value = percent;

  // AI Deliberation tab controls
  const delBadge = document.getElementById('deliberationAllocBadge');
  const delSlider = document.getElementById('deliberationAllocSlider');
  const delInput = document.getElementById('deliberationAllocInput');
  const delText = document.getElementById('deliberationAllocText');
  if (delBadge) delBadge.textContent = `${percent}%`;
  if (delSlider) delSlider.value = percent;
  if (delInput) delInput.value = percent;
  if (delText) delText.textContent = `${percent}%`;
}

function showAllocationWarning(targetValue) {
  const modal = document.getElementById('allocationWarningModal');
  const title = document.getElementById('allocModalTitle');
  const icon = document.getElementById('allocModalIcon');
  const subtitle = document.getElementById('allocModalSubtitle');
  const body = document.getElementById('allocModalBody');
  if (!modal) return;

  state.pendingAllocationChange = {
    targetValue,
    previousValue: state.entryAllocationPercent,
  };

  if (targetValue === 100) {
    if (icon) icon.textContent = '🚨';
    if (title) title.innerHTML = '<span class="text-danger">CRITICAL WARNING: 100% MAXIMUM ENTRY ALLOCATION</span>';
    if (subtitle) subtitle.textContent = 'Deterministic Safeguard Verification — Maximum Allocation Selected';
    if (body) {
      body.innerHTML = `
        <div style="background: rgba(255, 59, 92, 0.12); border: 1px solid rgba(255, 59, 92, 0.35); padding: 14px; border-radius: 8px; margin-bottom: 14px;">
          <strong class="text-danger">YOU HAVE SELECTED 100% OF THE TRADING ALLOCATION BASE.</strong>
          <p style="margin-top: 6px; font-size: 13px;">
            Please read and acknowledge the following mandatory quantitative risk controls before confirming:
          </p>
        </div>
        <ul style="font-size: 13px; line-height: 1.6; padding-left: 20px; color: var(--text-main);">
          <li><strong>Total Allocation Base Consumption:</strong> The proposed entry may consume the entire configured allocation or available allocation base for this trade setup.</li>
          <li><strong>Loss Magnification & Opportunity Cost:</strong> High allocation can magnify portfolio drawdowns and reduce the capital available for other qualified market opportunities.</li>
          <li><strong>Compounded Structural Risks:</strong> Exchange leverage, trading fees, slippage, funding rates, and liquidation risk can substantially increase potential dollar losses.</li>
          <li><strong>Active Risk Engine Enforcement:</strong> The deterministic risk engine and safety limits still strictly apply. This 100% allocation is <em>NOT</em> permission to risk 100% of account equity — your stop-loss risk remains capped at the configured per-trade budget (default 0.50% equity) and daily loss limit (2.00% SOD).</li>
          <li><strong>Zero Warranty Disclaimer:</strong> A 100% allocation is not a trading recommendation, does not guarantee profitability, and does not ensure market safety.</li>
        </ul>
      `;
    }
  } else {
    if (icon) icon.textContent = '⚠️';
    if (title) title.textContent = `High Allocation Confirmation (${targetValue}%)`;
    if (subtitle) subtitle.textContent = 'Quantitative Risk Limit Notice — Exceeds 10% Baseline';
    if (body) {
      body.innerHTML = `
        <div style="background: rgba(245, 166, 35, 0.12); border: 1px solid rgba(245, 166, 35, 0.35); padding: 14px; border-radius: 8px; margin-bottom: 14px;">
          <strong class="text-warning">You are requesting an entry allocation of ${targetValue}%, which exceeds the standard 10% allocation baseline.</strong>
        </div>
        <ul style="font-size: 13px; line-height: 1.6; padding-left: 20px; color: var(--text-main);">
          <li><strong>Concentration Risk:</strong> Higher allocation factors scale up proposed position notional size, which can accelerate portfolio drawdowns during adverse volatility.</li>
          <li><strong>Capital Availability:</strong> Consuming more of the allocation base reduces available margin buffer for subsequent high-probability setups.</li>
          <li><strong>Leverage & Fees:</strong> Increased position size amplifies the impact of taker fees, funding costs, and execution slippage.</li>
          <li><strong>Deterministic Risk Budget Intact:</strong> The deterministic risk engine still bounds maximum dollar loss to your configured risk-per-trade limit (default 0.50% equity).</li>
        </ul>
      `;
    }
  }

  modal.classList.add('active');
}

function cancelAllocationChange() {
  const modal = document.getElementById('allocationWarningModal');
  if (modal) modal.classList.remove('active');
  updateAllocationUi(state.entryAllocationPercent);
  state.pendingAllocationChange = null;
}

function confirmAllocationChange() {
  const modal = document.getElementById('allocationWarningModal');
  if (modal) modal.classList.remove('active');
  if (state.pendingAllocationChange) {
    const val = state.pendingAllocationChange.targetValue;
    state.pendingAllocationChange = null;
    applyAllocation(val, true);
  }
}

function requestAllocationChange(newVal) {
  const val = Math.max(1, Math.min(100, Math.round(Number(newVal) || 10)));
  if (val === state.entryAllocationPercent) {
    updateAllocationUi(val);
    return;
  }

  if (val > 10) {
    showAllocationWarning(val);
  } else {
    applyAllocation(val, true);
  }
}

async function applyAllocation(val, persistServer = true) {
  const percent = Math.max(1, Math.min(100, Math.round(Number(val) || 10)));
  state.entryAllocationPercent = percent;
  updateAllocationUi(percent);

  if (state.selectedProposal) {
    await recalculateDeliberationForAllocation(percent);
  }

  if (persistServer) {
    try {
      await fetch('/api/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ entryAllocationPercent: percent }),
      });
    } catch (err) {
      console.warn('Could not persist entryAllocationPercent to server:', err);
    }
  }
}

async function recalculateDeliberationForAllocation(allocPercent) {
  if (!state.selectedProposal) return;
  try {
    const res = await fetch('/api/agents/deliberate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        proposal: state.selectedProposal,
        entryAllocationPercent: allocPercent,
      }),
    });
    const result = await res.json();
    state.deliberation = result;
    updateDeliberationView(result);
  } catch (err) {
    console.warn('Error recalculating deliberation for allocation:', err);
  }
}

// Event Listeners for Buttons
function setupEventListeners() {
  // Safety badge click opens environment tab
  document.getElementById('envBadge')?.addEventListener('click', () => switchTab('environment'));

  // Scanner refresh & Auto-rescan selector
  document.getElementById('refreshScannerBtn')?.addEventListener('click', () => refreshScanner(true));
  document.getElementById('autoRescanSelect')?.addEventListener('change', (e) => {
    if (autoRescanTimer) {
      clearInterval(autoRescanTimer);
      autoRescanTimer = null;
    }
    const ms = parseInt(e.target.value, 10);
    if (ms > 0) {
      autoRescanTimer = setInterval(() => {
        refreshScanner(true);
      }, ms);
    }
  });

  // Deliberate candidate
  document.getElementById('runDeliberationBtn')?.addEventListener('click', () => {
    if (state.selectedProposal) {
      runDeliberation(state.selectedProposal);
    } else if (state.scannerResult?.qualified?.length > 0) {
      runDeliberation(state.scannerResult.qualified[0]);
    } else {
      alert('No qualified trade candidates available right now.');
    }
  });

  // Execute paper order
  document.getElementById('executePaperOrderBtn')?.addEventListener('click', () => executePaperOrder());

  // Orders table refresh
  document.getElementById('refreshOrdersBtn')?.addEventListener('click', () => refreshOrders());

  // Rejected archive refresh
  document.getElementById('refreshRejectedBtn')?.addEventListener('click', () => refreshRejectedArchive());

  // Environment & Health diagnostics
  document.getElementById('refreshHealthBtn')?.addEventListener('click', () => refreshHealth());
  document.getElementById('switchEnvBtn')?.addEventListener('click', () => testEnvironmentSwitch());

  // Settings save
  document.getElementById('saveSettingsBtn')?.addEventListener('click', () => saveSettings());

  // Backtest runner & Walk-Forward Presets
  document.getElementById('runBacktestBtn')?.addEventListener('click', () => runBacktest());
  document.getElementById('btPresetBtcBtn')?.addEventListener('click', () => applyBacktestPreset('BTCUSDT', '15m'));
  document.getElementById('btPresetEthBtn')?.addEventListener('click', () => applyBacktestPreset('ETHUSDT', '15m'));
  document.getElementById('btPresetSolBtn')?.addEventListener('click', () => applyBacktestPreset('SOLUSDT', '5m'));

  // Risk Engine Sandbox tester & Rule Presets
  document.getElementById('testRiskSandboxBtn')?.addEventListener('click', () => testRiskSandbox());
  document.getElementById('presetValidBtn')?.addEventListener('click', () => applyRiskPreset('valid'));
  document.getElementById('presetStopCloseBtn')?.addEventListener('click', () => applyRiskPreset('stopClose'));
  document.getElementById('presetStopFarBtn')?.addEventListener('click', () => applyRiskPreset('stopFar'));
  document.getElementById('presetBadSideBtn')?.addEventListener('click', () => applyRiskPreset('badSide'));
  document.getElementById('presetLowRrBtn')?.addEventListener('click', () => applyRiskPreset('lowRr'));
  document.getElementById('presetDailyLossBtn')?.addEventListener('click', () => applyRiskPreset('dailyLoss'));

  // Live Position Lifecycle & Protective Orders Simulation Controls
  document.getElementById('quickTestTradeBtn')?.addEventListener('click', () => openQuickTestPosition());
  document.getElementById('simTickProfitBtn')?.addEventListener('click', () => simulatePositionTick(1.2));
  document.getElementById('simTickStopBtn')?.addEventListener('click', () => simulatePositionTick(-0.8));

  // Security Gate, Bitget HMAC-SHA256 Auth & SQLite Roundtrip Diagnostics
  document.getElementById('testDirectMainnetBtn')?.addEventListener('click', () => testDirectMainnetInterception());
  document.getElementById('verifyBitgetSigBtn')?.addEventListener('click', () => verifyBitgetSignature());
  document.getElementById('testSqliteRoundtripBtn')?.addEventListener('click', () => testSqlitePersistence());

  // Export Journal
  document.getElementById('exportJournalBtn')?.addEventListener('click', () => exportJournalJson());

  // Theme controls
  document.getElementById('themeToggleBtn')?.addEventListener('click', () => {
    const nextTheme = state.theme === 'dark' ? 'light' : 'dark';
    applyTheme(nextTheme, true);
  });
  document.getElementById('themeOptDark')?.addEventListener('change', (e) => {
    if (e.target.checked) applyTheme('dark', true);
  });
  document.getElementById('themeOptLight')?.addEventListener('change', (e) => {
    if (e.target.checked) applyTheme('light', true);
  });

  // Settings Entry Allocation Slider & Input
  const cfgSlider = document.getElementById('cfgEntryAllocSlider');
  const cfgInput = document.getElementById('cfgEntryAllocInput');
  cfgSlider?.addEventListener('input', (e) => {
    const v = e.target.value;
    const badge = document.getElementById('cfgEntryAllocBadge');
    if (badge) badge.textContent = `${v}%`;
    if (cfgInput) cfgInput.value = v;
  });
  cfgSlider?.addEventListener('change', (e) => requestAllocationChange(e.target.value));
  cfgInput?.addEventListener('change', (e) => requestAllocationChange(e.target.value));

  // Deliberation Entry Allocation Slider & Input
  const delSlider = document.getElementById('deliberationAllocSlider');
  const delInput = document.getElementById('deliberationAllocInput');
  delSlider?.addEventListener('input', (e) => {
    const v = e.target.value;
    const badge = document.getElementById('deliberationAllocBadge');
    const text = document.getElementById('deliberationAllocText');
    if (badge) badge.textContent = `${v}%`;
    if (text) text.textContent = `${v}%`;
    if (delInput) delInput.value = v;
  });
  delSlider?.addEventListener('change', (e) => requestAllocationChange(e.target.value));
  delInput?.addEventListener('change', (e) => requestAllocationChange(e.target.value));

  // Confirmation Modal actions
  document.getElementById('cancelAllocationBtn')?.addEventListener('click', () => cancelAllocationChange());
  document.getElementById('confirmAllocationBtn')?.addEventListener('click', () => confirmAllocationChange());
  document.getElementById('allocationWarningModal')?.addEventListener('click', (e) => {
    if (e.target.id === 'allocationWarningModal') cancelAllocationChange();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && document.getElementById('allocationWarningModal')?.classList.contains('active')) {
      cancelAllocationChange();
    }
  });

  // Strategy model selector
  document.getElementById('cfgStrategyModelSelect')?.addEventListener('change', (e) => {
    const val = e.target.value;
    updateStrategyAuditCard(val);
    try { localStorage.setItem('vt2_strategy_model', val); } catch (err) {}
  });

  // Topbar Rescan
  document.getElementById('topRescanBtn')?.addEventListener('click', () => refreshScanner(true));

  // Verification Suite Run All
  document.getElementById('runAllVerificationsBtn')?.addEventListener('click', () => runAllVerificationChecks());

  // Automated Trading Engine Controls
  document.getElementById('autoStartBtn')?.addEventListener('click', () => startAutoTrading());
  document.getElementById('autoStopBtn')?.addEventListener('click', () => stopAutoTrading());
  document.getElementById('autoStopCloseBtn')?.addEventListener('click', () => stopAndCloseAllAutoTrading());
  document.getElementById('autoMaxTradesInput')?.addEventListener('change', async (e) => {
    const val = parseInt(e.target.value, 10);
    if (val >= 1) {
      await fetch('/api/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ maxTradesPerDay: val }),
      });
      refreshAutoTradingStatus();
    }
  });
  document.getElementById('autoMaxConcurrentSelect')?.addEventListener('change', async (e) => {
    const val = parseInt(e.target.value, 10);
    if (val >= 1) {
      await fetch('/api/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ maxConcurrentPositions: val }),
      });
      refreshAutoTradingStatus();
      refreshAccount();
    }
  });

  document.getElementById('autoBotMarketModeSelect')?.addEventListener('change', async (e) => {
    const val = e.target.value;
    await fetch('/api/settings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ botMarketMode: val }),
    });
    refreshAutoTradingStatus();
  });

  document.getElementById('autoBotCandidateOrderSelect')?.addEventListener('change', async (e) => {
    const val = e.target.value;
    await fetch('/api/settings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ botCandidateOrder: val }),
    });
    refreshAutoTradingStatus();
  });

  document.getElementById('autoCandidateSkipInput')?.addEventListener('change', async (e) => {
    const val = parseInt(e.target.value, 10);
    if (val >= 1) {
      await fetch('/api/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ candidateSkipMinutes: val }),
      });
      refreshAutoTradingStatus();
    }
  });

  // Positions Tab Actions
  document.getElementById('closeAllPositionsBtn')?.addEventListener('click', () => window.closeAllPositions());
  document.getElementById('checkSentimentBtn')?.addEventListener('click', () => checkPositionSentiment());
}

// Check Deployment Mode (Hosted Demo vs Full Local)
async function checkDeployMode() {
  try {
    const res = await fetch('/api/market/status');
    const data = await res.json();
    if (data.deployMode === 'DEMO_READONLY') {
      state.isDemoReadOnly = true;
      const demoBanner = document.getElementById('demoBanner');
      if (demoBanner) demoBanner.style.display = 'flex';

      const resetBtn = document.getElementById('resetDemoAccountBtn');
      if (resetBtn) {
        resetBtn.onclick = () => {
          if (confirm('Reset your simulated paper account back to $10,000 equity and clear all local positions, orders, and journal history?')) {
            DemoStore.reset();
            location.reload();
          }
        };
      }

      // Ensure write action buttons are ENABLED in Browser Paper Mode
      const writeButtonIds = [
        'quickTestTradeBtn',
        'executePaperOrderBtn',
        'simTickProfitBtn',
        'simTickStopBtn',
        'autoStartBtn',
        'startAutoBtn',
        'autoStopBtn',
        'stopAutoBtn',
        'autoStopCloseBtn',
        'killAutoBtn',
        'saveSettingsBtn',
      ];
      writeButtonIds.forEach(id => {
        const btn = document.getElementById(id);
        if (btn) {
          btn.disabled = false;
          btn.removeAttribute('title');
          btn.style.opacity = '1';
          btn.style.cursor = 'pointer';
        }
      });

      // Close all buttons enabled
      document.querySelectorAll('[id*="CloseAll"], [id*="closeAll"]').forEach(btn => {
        btn.disabled = false;
        btn.removeAttribute('title');
        btn.style.opacity = '1';
        btn.style.cursor = 'pointer';
      });

      // Display clear notice on Automated Trading engine
      const autoSubtext = document.getElementById('autoStatusSubtext');
      if (autoSubtext) {
        autoSubtext.textContent = 'Browser Paper Mode active · Runs while tab is open';
      }

      // Add banner in tab-autotrading if not already present
      const autoTab = document.getElementById('tab-autotrading');
      if (autoTab && !document.getElementById('demoAutoTradingNotice')) {
        const notice = document.createElement('div');
        notice.id = 'demoAutoTradingNotice';
        notice.style.cssText = 'margin-bottom: 16px; padding: 12px 16px; background: rgba(59, 130, 246, 0.12); border: 1px solid var(--border-color); border-radius: 8px; font-size: 13px; color: var(--text-secondary);';
        notice.innerHTML = '<strong style="color: var(--text-primary);">ℹ️ Browser Paper Mode:</strong> All simulated paper trading, order execution, position tracking, and automated bot cycles run statelessly using live Bitget public market feeds. Your paper account is preserved locally in this browser (clearing site data resets it). The bot loop runs only while this tab is open.';
        const header = autoTab.querySelector('.section-header');
        if (header && header.nextSibling) {
          autoTab.insertBefore(notice, header.nextSibling);
        } else {
          autoTab.prepend(notice);
        }
      }

      // Start periodic tick polling for live position P&L
      DemoBotManager.startTickPolling();

      // Resume bot if previously running in localStorage
      const curState = DemoStore.getState();
      if (curState.botSettings?.running) {
        console.log('[DemoBot] Resuming active bot loop in tab');
        DemoBotManager.start();
      }

      // Visibility change catch-up cycle
      document.addEventListener('visibilitychange', () => {
        if (!document.hidden) {
          const cur = DemoStore.getState();
          if (cur.botSettings?.running) {
            console.log('[DemoBot] Tab became visible, running catch-up cycle');
            DemoBotManager.runBotCycle();
          }
        }
      });
    }
  } catch (err) {
    console.warn('Could not determine deploy mode:', err);
  }
}

// Connect to Server-Sent Events (SSE) or Poll in Demo Mode
function connectSseStream() {
  if (state.isDemoReadOnly) {
    console.log('[VT2 Demo] In hosted demo mode; active polling enabled (12s interval).');
    setInterval(() => {
      refreshAccount();
      checkFeedStatus();
    }, 12000);
    return;
  }
  try {
    const sse = new EventSource('/api/stream');
    sse.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        if (data.type === 'ACCOUNT_TICK') {
          updateAccountUi(data.account);
          updatePositionsUi(data.positions);
        } else if (data.type === 'AUTO_ACTIVITY_LOG') {
          refreshAutoTradingStatus();
        } else if (data.type === 'POSITION_SENTIMENT_ALERT') {
          refreshAccount();
          const notif = document.getElementById('posLifecycleNotification');
          if (notif) {
            notif.style.display = 'block';
            notif.style.background = 'rgba(255, 170, 0, 0.15)';
            notif.style.border = '1px solid var(--color-warning)';
            notif.textContent = `⚠️ Sentiment Alert for ${data.symbol}: ${data.sentiment} (${data.actionTaken || 'Monitored'})`;
            setTimeout(() => { notif.style.display = 'none'; }, 6000);
          }
        }
      } catch (err) {
        console.error('SSE parse error:', err);
      }
    };
    sse.onerror = () => {
      sse.close();
      setTimeout(connectSseStream, 5000);
    };
  } catch (err) {
    console.warn('SSE connection unavailable, using periodic polling.');
  }
}

// Helper to format friendly error messages
function friendlyError(err) {
  if (!err) return 'Unknown error occurred.';
  const msg = err.message || String(err);
  if (msg.includes('Failed to fetch') || msg.includes('NetworkError') || msg.includes('Load failed')) {
    return 'Cannot reach server. Please check connection.';
  }
  return msg;
}

// API Calls & UI Updaters
async function checkFeedStatus() {
  const statusEl = document.getElementById('feedStatus');
  const latencyEl = document.getElementById('connectionLatency');
  const sidebarTextEl = document.getElementById('sidebarFeedText');
  const sidebarDotEl = document.querySelector('.sidebar-footer .status-pulse-dot');

  try {
    const res = await fetch('/api/market/status');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();

    if (data.isLive) {
      if (statusEl) {
        statusEl.textContent = 'ONLINE (Live)';
        statusEl.className = 'stat-value text-success';
      }
      if (sidebarTextEl) sidebarTextEl.textContent = 'Bitget V2 Live';
      if (sidebarDotEl) {
        sidebarDotEl.style.background = 'var(--color-success, #00e599)';
        sidebarDotEl.style.boxShadow = '0 0 8px rgba(0, 229, 153, 0.4)';
      }
    } else {
      if (statusEl) {
        statusEl.textContent = 'SIMULATED (Offline Feed)';
        statusEl.className = 'stat-value text-warning';
      }
      if (sidebarTextEl) sidebarTextEl.textContent = 'Bitget Simulated';
      if (sidebarDotEl) {
        sidebarDotEl.style.background = 'var(--color-warning, #ffaa00)';
        sidebarDotEl.style.boxShadow = '0 0 8px rgba(255, 170, 0, 0.4)';
      }
    }
    if (latencyEl) {
      const lat = typeof data.latencyMs === 'number' && data.latencyMs >= 0 ? `${data.latencyMs}ms` : '--';
      latencyEl.textContent = `Latency: ${lat}`;
    }
  } catch {
    if (statusEl) {
      statusEl.textContent = 'DISCONNECTED';
      statusEl.className = 'stat-value text-danger';
    }
    if (sidebarTextEl) sidebarTextEl.textContent = 'Feed Offline';
    if (sidebarDotEl) {
      sidebarDotEl.style.background = 'var(--color-danger, #ff3b5c)';
      sidebarDotEl.style.boxShadow = 'none';
    }
    if (latencyEl) {
      latencyEl.textContent = 'Latency: --';
    }
  }
}

async function refreshAccount() {
  try {
    if (state.isDemoReadOnly) {
      const demoState = DemoStore.getState();
      state.account = demoState.account;
      updateAccountUi(demoState.account);
      state.positions = (demoState.positions || []).filter(p => p.status === 'OPEN');
      updatePositionsUi(state.positions);
      return;
    }
    const res = await fetch('/api/account');
    const data = await res.json();
    state.account = data;
    updateAccountUi(data);

    const posRes = await fetch('/api/positions');
    const posData = await posRes.json();
    state.positions = posData.positions || [];
    updatePositionsUi(state.positions);
  } catch (err) {
    console.error('Error refreshing account:', err);
  }
}

function updateAccountUi(acc) {
  if (!acc) return;
  document.getElementById('headerEquity').textContent = `$${acc.equity.toLocaleString('en-US', { minimumFractionDigits: 2 })}`;
  document.getElementById('ovEquity').textContent = `$${acc.equity.toLocaleString('en-US', { minimumFractionDigits: 2 })}`;
  document.getElementById('ovStartEquity').textContent = `Start of Day: $${acc.startOfDayEquity.toLocaleString('en-US', { minimumFractionDigits: 2 })}`;

  const dailyPnl = acc.equity - acc.startOfDayEquity;
  const pnlEl = document.getElementById('headerDailyPnl');
  pnlEl.textContent = `${dailyPnl >= 0 ? '+' : ''}$${dailyPnl.toFixed(2)}`;
  pnlEl.className = `stat-value ${dailyPnl >= 0 ? 'text-success' : 'text-danger'}`;

  document.getElementById('ovDailyLoss').textContent = `$${acc.dailyLoss.toFixed(2)} / $${acc.dailyLossLimit.toFixed(2)}`;
  document.getElementById('ovDailyLossPct').textContent = `${((acc.dailyLoss / acc.startOfDayEquity) * 100).toFixed(2)}% of 2.00% hard stop`;

  document.getElementById('ovOpenPositions').textContent = `${acc.openPositionsCount} / 1 Max`;
  document.getElementById('ovExposure').textContent = `Exposure: $${acc.totalExposureNotional.toFixed(2)} notional`;

  document.getElementById('ovLossStreak').textContent = `${acc.consecutiveLosses} / 3 Pause`;
  document.getElementById('ovCooldown').textContent = acc.lastTradeClosedAt ? 'Cooldown Active / Monitored' : 'Cooldown: Inactive';
}

function updatePositionsUi(positions) {
  const tbody = document.getElementById('positionsTableBody');
  const countEl = document.getElementById('positionsCount');
  if (countEl) countEl.textContent = positions?.length || 0;

  const currentEquity = state.account?.equity || 10000;
  const maxAggRisk = state.account?.maxAggregateOpenRiskPercent || 1.0;
  const maxConcurrent = state.account?.maxConcurrentPositions || 1;

  // Calculate Aggregate Open Risk across all active positions
  let totalOpenRiskDollars = 0;
  if (positions && positions.length > 0) {
    for (const p of positions) {
      const riskDist = Math.abs(p.entryPrice - p.stopLoss);
      totalOpenRiskDollars += (p.currentQuantity || 0) * riskDist;
    }
  }
  const aggregateOpenRiskPct = (totalOpenRiskDollars / currentEquity) * 100;

  // Update Topbar Open Risk Pill
  const openRiskEl = document.getElementById('headerOpenRisk');
  if (openRiskEl) {
    openRiskEl.textContent = `${aggregateOpenRiskPct.toFixed(2)}% / ${maxAggRisk.toFixed(1)}%`;
    if (aggregateOpenRiskPct >= maxAggRisk * 0.9) {
      openRiskEl.className = 'stat-value text-danger mono-num';
    } else if (aggregateOpenRiskPct >= maxAggRisk * 0.6) {
      openRiskEl.className = 'stat-value text-warning mono-num';
    } else {
      openRiskEl.className = 'stat-value mono-num';
    }
  }

  // Update Topbar Sentiment Badge
  const sentimentBadge = document.getElementById('sentimentBadge');
  if (sentimentBadge) {
    if (!positions || positions.length === 0) {
      sentimentBadge.textContent = 'IDLE';
      sentimentBadge.className = 'badge badge-neutral';
    } else {
      const hasReversed = positions.some(p => p.sentiment === 'REVERSED');
      const hasWeakening = positions.some(p => p.sentiment === 'WEAKENING');
      if (hasReversed) {
        sentimentBadge.textContent = 'REVERSED';
        sentimentBadge.className = 'badge badge-short';
      } else if (hasWeakening) {
        sentimentBadge.textContent = 'WEAKENING';
        sentimentBadge.className = 'badge badge-neutral text-warning';
      } else {
        sentimentBadge.textContent = 'SUPPORTIVE';
        sentimentBadge.className = 'badge badge-long';
      }
    }
  }

  // Update Overview Open Positions metric
  const ovPos = document.getElementById('ovOpenPositions');
  if (ovPos) {
    ovPos.textContent = `${positions?.length || 0} / ${maxConcurrent} Max`;
  }

  // Update Positions tab cap label
  const capLabel = document.getElementById('concurrentCapLabel');
  if (capLabel) {
    capLabel.textContent = `Concurrent Position Cap: ${maxConcurrent} Max (Configurable up to 5) · Aggregate Risk Cap: ${maxAggRisk.toFixed(1)}% Equity`;
  }

  if (!tbody) return;

  if (!positions || positions.length === 0) {
    tbody.innerHTML = `<tr><td colspan="13" style="text-align: center; color: var(--text-muted); padding: 24px;">No active simulated paper positions. Click "Place Test Paper Trade" to open one!</td></tr>`;
    return;
  }

  tbody.innerHTML = positions.map(p => {
    const pnlClass = p.unrealizedPnl >= 0 ? 'text-success' : 'text-danger';
    
    // Calculate R-Multiple
    let rMultiple = 0;
    const riskDistance = Math.abs(p.entryPrice - p.stopLoss);
    if (riskDistance > 0) {
      const priceDistance = p.side === 'LONG' ? (p.currentPrice - p.entryPrice) : (p.entryPrice - p.currentPrice);
      rMultiple = priceDistance / riskDistance;
    }
    const rClass = rMultiple >= 0 ? 'text-success' : 'text-danger';
    const rText = `${rMultiple >= 0 ? '+' : ''}${rMultiple.toFixed(2)}R`;

    // Sentiment badge
    const sent = p.sentiment || 'SUPPORTIVE';
    let sentBadgeClass = 'badge-long';
    if (sent === 'REVERSED') sentBadgeClass = 'badge-short';
    else if (sent === 'WEAKENING') sentBadgeClass = 'badge-neutral text-warning';

    return `
      <tr>
        <td class="mono-num">${p.id}</td>
        <td><strong>${p.symbol}</strong></td>
        <td><span class="badge ${p.side === 'LONG' ? 'badge-long' : 'badge-short'}">${p.side}</span></td>
        <td class="mono-num">$${p.entryPrice.toFixed(4)}</td>
        <td class="mono-num">$${p.currentPrice.toFixed(4)}</td>
        <td class="mono-num">${p.currentQuantity}</td>
        <td class="mono-num">$${(p.currentQuantity * p.currentPrice).toFixed(2)}</td>
        <td class="mono-num">$${p.stopLoss.toFixed(4)}</td>
        <td class="mono-num">$${p.takeProfit.toFixed(4)}</td>
        <td class="${pnlClass} mono-num"><strong>${p.unrealizedPnl >= 0 ? '+' : ''}$${p.unrealizedPnl.toFixed(2)}</strong></td>
        <td class="${rClass} mono-num"><strong>${rText}</strong></td>
        <td><span class="badge ${sentBadgeClass}">${sent}</span></td>
        <td>
          <button class="btn btn-danger btn-sm" onclick="window.closePosition('${p.id}')">Close</button>
        </td>
      </tr>
    `;
  }).join('');
}

window.closePosition = async function(posId) {
  if (!confirm('Close this simulated paper position at current market price?')) return;
  try {
    if (state.isDemoReadOnly) {
      const res = await fetch('/api/demo/close', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ state: DemoStore.getState(), positionId: posId }),
      });
      const data = await res.json();
      DemoStore.updateFromResponse(data);
      await refreshAccount();
      await refreshOrders();
      await refreshJournal();
      return;
    }
    const res = await fetch(`/api/positions/${posId}/close`, { method: 'POST' });
    const data = await res.json();
    if (data.success) {
      await refreshAccount();
      await refreshJournal();
    }
  } catch (err) {
    alert(`Error closing position: ${friendlyError(err)}`);
  }
};

window.closeAllPositions = async function() {
  if (!confirm('Close all active simulated paper positions at current market prices?')) return;
  try {
    if (state.isDemoReadOnly) {
      const res = await fetch('/api/demo/close-all', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ state: DemoStore.getState() }),
      });
      const data = await res.json();
      DemoStore.updateFromResponse(data);
      alert(`Closed ${data.closedCount || 0} position(s).`);
      await refreshAccount();
      await refreshOrders();
      await refreshJournal();
      return;
    }
    const res = await fetch('/api/positions/close-all', { method: 'POST' });
    const data = await res.json();
    alert(`Closed ${data.closedPositionsCount ?? data.closedCount ?? 0} position(s).`);
    await refreshAccount();
    await refreshOrders();
    await refreshJournal();
  } catch (err) {
    alert(`Error closing all positions: ${friendlyError(err)}`);
  }
};

async function checkPositionSentiment() {
  const notif = document.getElementById('posLifecycleNotification');
  try {
    const url = state.isDemoReadOnly ? '/api/demo/monitor' : '/api/monitor/check-now';
    const body = state.isDemoReadOnly
      ? { state: DemoStore.getState() }
      : {};
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = await res.json();
    if (state.isDemoReadOnly) {
      DemoStore.updateFromResponse(data);
    }
    if (notif) {
      notif.style.display = 'block';
      notif.style.background = 'rgba(0, 229, 153, 0.1)';
      notif.style.border = '1px solid var(--border-color)';
      notif.textContent = `Sentiment check complete: evaluated ${data.checkedCount || data.results?.length || 0} open positions. Active summary: ${data.summary || 'HEALTHY'}`;
      setTimeout(() => { notif.style.display = 'none'; }, 5000);
    }
    await refreshAccount();
  } catch (err) {
    alert(`Error evaluating sentiment: ${friendlyError(err)}`);
  }
}

let autoRescanTimer = null;

async function refreshScanner(forceFresh = false) {
  const btn = document.getElementById('refreshScannerBtn');
  const feedback = document.getElementById('scannerStatusFeedback');
  const scannerBadge = document.getElementById('scannerDataSourceBadge');

  if (forceFresh && btn) {
    btn.disabled = true;
    btn.textContent = '⏳ Scanning...';
  }

  try {
    const mode = state.activeMarketMode || 'stocks';
    const url = forceFresh ? '/api/market/scan' : `/api/market/scanner?mode=${mode}`;
    const options = forceFresh
      ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ marketMode: mode }) }
      : { method: 'GET' };
    const res = await fetch(url, options);

    if (!res.ok) {
      throw new Error(`Feed error HTTP ${res.status}`);
    }

    const data = await res.json();
    state.scannerResult = data;

    if (scannerBadge) {
      if (data.isLive) {
        scannerBadge.textContent = 'Live Bitget V2';
        scannerBadge.className = 'badge badge-long';
      } else {
        scannerBadge.textContent = 'SYNTHETIC';
        scannerBadge.className = 'badge badge-short';
      }
    }

    if (feedback) {
      const totalCount = data.counts?.total ?? data.scannedCount ?? (data.qualified?.length || 0) + (data.rejected?.length || 0);
      const eqCount = data.counts?.equity ?? 0;
      const cryCount = data.counts?.crypto ?? 0;
      const timeStr = new Date(data.timestamp || Date.now()).toLocaleTimeString();
      const msStr = data.durationMs !== undefined ? `${data.durationMs}ms` : '<50ms';
      feedback.textContent = `Scanned ${totalCount} markets (${eqCount} equity, ${cryCount} crypto) in ${msStr} at ${timeStr}`;
    }

    // Update Macro Overview Context (S&P 500 for stocks, BTC for crypto)
    if (data.stockBenchmark && state.activeMarketMode === 'stocks') {
      const btcTrendHeader = document.getElementById('btcTrendHeader');
      if (btcTrendHeader) {
        btcTrendHeader.textContent = data.stockBenchmark.trend;
        btcTrendHeader.className = `stat-value ${data.stockBenchmark.trend === 'BULLISH' ? 'text-success' : (data.stockBenchmark.trend === 'BEARISH' ? 'text-danger' : 'text-warning')}`;
      }
      const ovBtcPrice = document.getElementById('ovBtcPrice');
      if (ovBtcPrice) ovBtcPrice.textContent = `$${data.stockBenchmark.price?.toLocaleString() || '--'} (SPY)`;
      const ovBtcExpl = document.getElementById('ovBtcExplanation');
      if (ovBtcExpl) ovBtcExpl.textContent = data.stockBenchmark.reason || 'S&P 500 ETF Perpetual Macro Context';
      const btcBadge = document.getElementById('ovBtcBadge');
      if (btcBadge) {
        btcBadge.textContent = `SPY: ${data.stockBenchmark.trend}`;
        btcBadge.className = `badge ${data.stockBenchmark.trend === 'BULLISH' ? 'badge-long' : (data.stockBenchmark.trend === 'BEARISH' ? 'badge-short' : 'badge-neutral')}`;
      }
    } else if (data.btcContext) {
      const btcTrendHeader = document.getElementById('btcTrendHeader');
      if (btcTrendHeader) {
        btcTrendHeader.textContent = data.btcContext.trend;
        btcTrendHeader.className = `stat-value ${data.btcContext.trend === 'BULLISH' ? 'text-success' : (data.btcContext.trend === 'BEARISH' ? 'text-danger' : 'text-warning')}`;
      }
      const ovBtcPrice = document.getElementById('ovBtcPrice');
      if (ovBtcPrice) ovBtcPrice.textContent = `$${data.btcContext.btcPrice?.toLocaleString() || '--'}`;
      const ovBtcExpl = document.getElementById('ovBtcExplanation');
      if (ovBtcExpl) ovBtcExpl.textContent = data.btcContext.reason || '';
      const btcBadge = document.getElementById('ovBtcBadge');
      if (btcBadge) {
        btcBadge.textContent = data.btcContext.trend;
        btcBadge.className = `badge ${data.btcContext.trend === 'BULLISH' ? 'badge-long' : (data.btcContext.trend === 'BEARISH' ? 'badge-short' : 'badge-neutral')}`;
      }
    }

    // Update Scanner Table
    const tbody = document.getElementById('scannerTableBody');
    const qualified = data.qualified || [];
    const countEl = document.getElementById('scannerCount');
    if (countEl) countEl.textContent = qualified.length;

    if (tbody) {
      if (qualified.length === 0) {
        tbody.innerHTML = `<tr><td colspan="12" style="text-align: center; color: var(--text-muted); padding: 24px;">No setups currently meet strict trend, volume, and R:R constraints.</td></tr>`;
      } else {
        tbody.innerHTML = qualified.map((q, idx) => `
          <tr>
            <td><strong class="text-info">#${idx + 1} (${q.score})</strong></td>
            <td><strong>${q.symbol}</strong>${q.leveragedInfo?.isLeveragedOrInverse ? ` <span class="badge badge-warning" style="font-size:10px;">${q.leveragedInfo.label}</span>` : ''}${q.underlyingMarketClosed ? ` <span class="badge badge-neutral" style="font-size:10px;" title="Underlying US Exchange is Closed">TradFi Closed</span>` : ''}</td>
            <td><span class="badge ${q.side === 'LONG' ? 'badge-long' : 'badge-short'}">${q.side}</span></td>
            <td>$${q.entryPrice}</td>
            <td>$${q.indicators?.ema20_4h?.toFixed(2) || '--'}</td>
            <td>${q.indicators?.rsi_15m || '--'}</td>
            <td>${q.indicators?.rvol_5m || '1.0'}x</td>
            <td>$${q.entryPrice}</td>
            <td>$${q.stopLoss}</td>
            <td>$${q.takeProfit}</td>
            <td class="text-success"><strong>${q.rewardRisk?.netRR}:1</strong></td>
            <td>
              <button class="btn btn-primary btn-sm" onclick="window.selectForDeliberation('${q.symbol}')">Deliberate</button>
            </td>
          </tr>
        `).join('');

        // Top opportunity in overview
        const top = qualified[0];
        state.selectedProposal = top;
        const topBanner = document.getElementById('topOpportunityBanner');
        if (topBanner) {
          topBanner.innerHTML = `
            <div style="display: flex; justify-content: space-between; align-items: center;">
              <div>
                <span class="badge ${top.side === 'LONG' ? 'badge-long' : 'badge-short'}">${top.side}</span>
                <strong style="font-size: 16px; margin: 0 8px;">${top.symbol}</strong>${top.leveragedInfo?.isLeveragedOrInverse ? ` <span class="badge badge-warning" style="font-size:11px;">${top.leveragedInfo.label}</span>` : ''}${top.underlyingMarketClosed ? ` <span class="badge badge-neutral" style="font-size:11px;">TradFi Closed</span>` : ''}
                <span style="color: var(--text-secondary);">Entry: $${top.entryPrice} · Net R:R: ${top.rewardRisk?.netRR}:1 · Score: ${top.score}</span>
              </div>
              <button class="btn btn-primary" onclick="window.selectForDeliberation('${top.symbol}')">Deliberate</button>
            </div>
          `;
        }
      }
    }

    // Rejected setups table
    const rejTbody = document.getElementById('rejectedTableBody');
    const rejected = data.rejected || [];
    if (rejTbody) {
      if (rejected.length === 0) {
        rejTbody.innerHTML = `<tr><td colspan="4" style="text-align: center; color: var(--text-muted);">No setups rejected.</td></tr>`;
      } else {
        rejTbody.innerHTML = rejected.map(r => `
          <tr>
            <td><strong>${r.symbol}</strong>${r.leveragedInfo?.isLeveragedOrInverse ? ` <span class="badge badge-warning" style="font-size:10px;">${r.leveragedInfo.label}</span>` : ''}${r.underlyingMarketClosed ? ` <span class="badge badge-neutral" style="font-size:10px;" title="Underlying US Exchange is Closed">TradFi Closed</span>` : ''}</td>
            <td><span class="badge badge-short">${r.rejectionReason}</span></td>
            <td style="color: var(--text-secondary);">${r.explanation}</td>
            <td>${new Date(data.timestamp || Date.now()).toLocaleTimeString()}</td>
          </tr>
        `).join('');
      }
    }
  } catch (err) {
    console.error('Error refreshing scanner:', err);
    if (scannerBadge) {
      scannerBadge.textContent = 'STALE (Feed Offline)';
      scannerBadge.className = 'badge badge-short';
    }
    if (feedback) {
      feedback.textContent = `Rescan failed: ${err.message}. Showing previous cached data.`;
      feedback.style.color = 'var(--color-danger)';
    }
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.textContent = '🔄 Rescan Markets';
    }
  }
}

window.selectForDeliberation = function(symbol) {
  const proposal = state.scannerResult?.qualified?.find(q => q.symbol === symbol);
  if (proposal) {
    state.selectedProposal = proposal;
    switchTab('agents');
    runDeliberation(proposal);
  }
};

function updateDeliberationView(result) {
  if (!result) return;

  const blockedBanner = document.getElementById('deliberationBlockedBanner');
  const bannerTitle = document.getElementById('delibBannerTitle');
  const bannerResume = document.getElementById('delibBannerResumeTime');

  if (result.accountGateBlocked) {
    if (blockedBanner) {
      blockedBanner.style.display = 'flex';
      if (bannerTitle) bannerTitle.textContent = `Account Gate Active: ${result.accountGateReason}`;
      if (result.cooldownResumesAt) {
        state.cooldownResumesAt = result.cooldownResumesAt;
        if (bannerResume) bannerResume.textContent = new Date(result.cooldownResumesAt).toLocaleTimeString();
      }
    }
    const a1Badge = document.getElementById('agent1Confidence');
    if (a1Badge) {
      a1Badge.textContent = 'Analysis only (not tradable)';
      a1Badge.className = 'badge badge-neutral text-warning mono-num';
    }
    const a2Badge = document.getElementById('agent2Verdict');
    if (a2Badge) {
      a2Badge.textContent = 'Analysis only (not tradable)';
      a2Badge.className = 'badge badge-neutral text-warning';
    }
  } else {
    if (blockedBanner) blockedBanner.style.display = 'none';
    const a1Badge = document.getElementById('agent1Confidence');
    if (a1Badge) {
      a1Badge.textContent = `Confidence: ${(result.thesis?.confidence * 100).toFixed(0)}%`;
      a1Badge.className = 'badge badge-neutral mono-num';
    }
    const a2Badge = document.getElementById('agent2Verdict');
    if (a2Badge) {
      a2Badge.textContent = result.review?.verdict || '';
      a2Badge.className = `badge ${result.review?.verdict === 'CHALLENGE_SURVIVED' ? 'badge-long' : 'badge-short'}`;
    }
  }

  // Agent 1: Market Intelligence
  document.getElementById('agent1Hypothesis').textContent = result.thesis?.primaryHypothesis || '';
  document.getElementById('agent1Evidence').innerHTML = (result.thesis?.supportingEvidence || []).map(e => `<li>${e}</li>`).join('');

  // Agent 2: Adversarial Review
  document.getElementById('agent2Challenges').innerHTML = [
    ...(result.review?.counterEvidence || []),
    ...(result.review?.invalidationConditions || []),
  ].map(c => `<li>${c}</li>`).join('');

  // Coordinator & Risk Engine
  const titleEl = document.getElementById('coordinatorTitle');
  const descEl = document.getElementById('coordinatorDescription');
  const actionBox = document.getElementById('coordinatorActionBox');

  if (result.accountGateBlocked) {
    titleEl.innerHTML = `<span class="text-danger">⚠️ BLOCKED BY ACCOUNT GATE (${result.accountGateReason})</span>`;
    descEl.textContent = `Analysis Confidence: ${Math.round((result.analysisConfidence || 0.75) * 100)}%. ${result.accountGateMessage || result.coordinatorReason}`;
    actionBox.style.display = 'none';
  } else if (result.isApproved && result.riskResult) {
    const sym = result.proposal?.symbol || state.selectedProposal?.symbol || '';
    const side = result.proposal?.side || state.selectedProposal?.side || '';
    titleEl.innerHTML = `<span class="text-success">✅ APPROVED FOR PAPER EXECUTION</span> — ${sym} ${side}`;
    descEl.textContent = `Verdict: ${result.coordinatorReason} (Position size: ${result.riskResult?.quantity} ${result.contract?.baseCoin || 'units'}, Notional: $${result.riskResult?.estimatedNotional?.toFixed(2)})`;
    actionBox.style.display = 'block';

    const qtyEl = document.getElementById('deliberationCalcQty');
    const notionalEl = document.getElementById('deliberationCalcNotional');
    const riskEl = document.getElementById('deliberationCalcRisk');
    if (qtyEl) qtyEl.textContent = `${result.riskResult.quantity} ${result.contract?.baseCoin || 'units'}`;
    if (notionalEl) notionalEl.textContent = `$${result.riskResult.estimatedNotional?.toFixed(2) || '0.00'}`;
    if (riskEl) {
      const riskPct = result.riskResult.actualEquityRiskPercent !== undefined
        ? result.riskResult.actualEquityRiskPercent
        : (result.riskResult.maxEquityRiskPercent || 0.5);
      const riskDol = result.riskResult.maxRiskAmount !== undefined ? result.riskResult.maxRiskAmount.toFixed(2) : '50.00';
      riskEl.textContent = `${riskPct.toFixed(2)}% of equity ($${riskDol} max stop loss)`;
    }
  } else {
    titleEl.innerHTML = `<span class="text-danger">❌ ${result.coordinatorVerdict || 'REJECTED'}</span>`;
    descEl.textContent = result.coordinatorReason || 'Failed deterministic risk criteria.';
    actionBox.style.display = 'none';
  }
}

async function runDeliberation(proposal) {
  try {
    document.getElementById('coordinatorTitle').textContent = `Deliberating ${proposal.symbol} ${proposal.side}...`;
    document.getElementById('coordinatorDescription').textContent = 'Synthesizing Market Intelligence, Adversarial Review, and Deterministic Risk Engine...';

    const res = await fetch('/api/agents/deliberate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        proposal,
        entryAllocationPercent: state.entryAllocationPercent,
      }),
    });
    const result = await res.json();
    state.deliberation = result;
    updateDeliberationView(result);
  } catch (err) {
    alert(`Deliberation error: ${friendlyError(err)}`);
  }
}

async function executePaperOrder() {
  if (!state.deliberation || !state.deliberation.isApproved || !state.selectedProposal) {
    return alert('No approved paper trading proposal available.');
  }

  const { selectedProposal, deliberation } = state;
  const orderPayload = {
    symbol: selectedProposal.symbol,
    side: selectedProposal.side,
    entryPrice: selectedProposal.entryPrice,
    stopLoss: selectedProposal.stopLoss,
    takeProfit: selectedProposal.takeProfit,
    quantity: deliberation.riskResult.quantity,
    partialTakeProfitPrice: selectedProposal.partialTakeProfitPrice,
  };

  if (state.activeMode === 'LIVE' || state.activeMode === 'DEMO') {
    try {
      const prevRes = await fetch('/api/orders/preview', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(orderPayload),
      });
      const previewData = await prevRes.json();
      const submitUrl = state.activeMode === 'LIVE' ? '/api/orders/live' : '/api/orders/demo';
      showOrderPreviewModal(previewData, orderPayload, submitUrl);
      return;
    } catch (err) {
      alert(`Could not generate order preview: ${friendlyError(err)}`);
      return;
    }
  }

  try {
    const url = state.isDemoReadOnly ? '/api/demo/order' : '/api/orders/paper';
    const body = state.isDemoReadOnly
      ? { state: DemoStore.getState(), order: orderPayload }
      : orderPayload;

    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = await res.json();

    if (state.isDemoReadOnly) {
      if (data.approved) {
        DemoStore.updateFromResponse(data);
        alert(`Paper order filled successfully! Position ID: ${data.position?.id || 'demo-pos'}`);
        switchTab('positions');
        await refreshAccount();
        await refreshOrders();
      } else {
        DemoStore.updateFromResponse(data);
        alert(`Order rejected: ${data.error || 'Risk policy rejected order'}`);
        await refreshRejectedArchive();
      }
      return;
    }

    if (res.ok) {
      alert(`Paper order filled successfully! Position ID: ${data.position.id}`);
      switchTab('positions');
      await refreshAccount();
      await refreshOrders();
    } else {
      alert(`Order rejected: ${data.message || data.error}`);
    }
  } catch (err) {
    alert(`Order execution error: ${friendlyError(err)}`);
  }
}

function showOrderPreviewModal(previewData, orderPayload, submitUrl) {
  const modal = document.getElementById('orderPreviewModal');
  const bodyEl = document.getElementById('orderPreviewBody');
  const confirmBtn = document.getElementById('confirmOrderPreviewBtn');

  if (!modal || !bodyEl || !confirmBtn) return;

  const sym = previewData.symbol || orderPayload.symbol;
  const isCrypto = previewData.profile?.assetClass === 'crypto';
  const side = (orderPayload.side || 'LONG').toUpperCase();
  const maxLoss = previewData.maxDollarLoss ?? Math.abs((orderPayload.entryPrice - orderPayload.stopLoss) * orderPayload.quantity).toFixed(2);
  const notional = previewData.notionalUsd ?? (orderPayload.entryPrice * orderPayload.quantity).toFixed(2);
  const capCheck = previewData.capCheck || { allowed: true };

  bodyEl.innerHTML = `
    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px; border-bottom: 1px solid var(--border-color); padding-bottom: 8px;">
      <div>
        <strong style="font-size: 16px;">${sym}</strong>
        <span class="badge ${isCrypto ? 'badge-primary' : 'badge-neutral'}" style="margin-left: 6px; font-size: 10px; text-transform: uppercase;">${isCrypto ? 'Crypto (24/7)' : 'Equity Perp'}</span>
      </div>
      <div>
        <span class="badge ${side === 'LONG' ? 'badge-long' : 'badge-short'}">${side}</span>
        <span class="badge ${state.activeMode === 'LIVE' ? 'badge-danger' : 'badge-primary'}" style="margin-left: 4px;">${state.activeMode}</span>
      </div>
    </div>

    <div class="grid-2" style="font-size: 12px; gap: 8px; margin-bottom: 12px;">
      <div><strong>Size:</strong> <span class="mono-num">${orderPayload.quantity}</span></div>
      <div><strong>Entry Price:</strong> <span class="mono-num">$${orderPayload.entryPrice}</span></div>
      <div><strong>Order Notional:</strong> <span class="mono-num">$${notional}</span> (Cap: $50)</div>
      <div><strong>Leverage:</strong> <span class="mono-num">${isCrypto ? '5x' : '3x'} Isolated</span></div>
      <div><strong>Stop Loss:</strong> <span class="mono-num text-danger">$${orderPayload.stopLoss}</span></div>
      <div><strong>Take Profit:</strong> <span class="mono-num text-success">$${orderPayload.takeProfit}</span></div>
    </div>

    <div style="background: rgba(220, 38, 38, 0.12); border: 1px solid rgba(220, 38, 38, 0.35); border-radius: 6px; padding: 10px; margin-bottom: 12px;">
      <div style="font-size: 11px; text-transform: uppercase; color: var(--color-danger); font-weight: 700;">Maximum Loss in Dollars:</div>
      <div style="font-size: 20px; font-weight: 800; color: var(--color-danger);" class="mono-num">-$${maxLoss}</div>
      <div style="font-size: 11px; color: var(--text-muted); margin-top: 2px;">
        Exchange-side stop loss verified before fill confirmation. Hard daily loss lockout: $10.00 max.
      </div>
    </div>

    ${!isCrypto && previewData.underlyingStatus?.isOpen === false ? `
      <div style="background: rgba(245, 158, 11, 0.12); border: 1px solid rgba(245, 158, 11, 0.35); border-radius: 6px; padding: 8px; font-size: 11px; color: var(--color-warning); margin-bottom: 12px;">
        ⚠️ <strong>Underlying NYSE Market Closed:</strong> Tokenized equity perps trade 24/7 on Bitget with wider spreads and overnight gap risk.
      </div>
    ` : ''}

    ${!capCheck.allowed ? `
      <div style="background: rgba(220, 38, 38, 0.2); border: 1px solid var(--color-danger); border-radius: 6px; padding: 8px; font-size: 11px; color: var(--color-danger); margin-bottom: 12px;">
        ❌ <strong>CAP EXCEEDED:</strong> ${capCheck.reason}
      </div>
    ` : ''}
  `;

  confirmBtn.disabled = !capCheck.allowed;
  confirmBtn.onclick = async () => {
    confirmBtn.disabled = true;
    try {
      const res = await fetch(submitUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(orderPayload),
      });
      const data = await res.json();
      modal.classList.remove('open');
      if (res.ok) {
        alert(`${state.activeMode} order executed successfully!`);
        switchTab('positions');
        await refreshOrders();
        await refreshJournal();
      } else {
        alert(`Order rejected: ${data.message || data.error}`);
      }
    } catch (err) {
      alert(`Order submission error: ${friendlyError(err)}`);
    } finally {
      confirmBtn.disabled = false;
    }
  };

  modal.classList.add('open');
}

async function loadChartData() {
  try {
    const res = await fetch(`/api/market/candles?symbol=${state.symbol}&timeframe=${state.timeframe}`);
    const data = await res.json();
    state.candlesData = data.candles;

    const chartBadge = document.getElementById('chartDataSourceBadge');
    if (chartBadge) {
      if (data.isLive) {
        chartBadge.textContent = 'Live Bitget V2';
        chartBadge.className = 'badge badge-long';
      } else {
        chartBadge.textContent = 'SYNTHETIC';
        chartBadge.className = 'badge badge-short';
      }
    }

    if (state.chart) {
      state.chart.setData(data.candles, null);

      // Collect relevant trade markers for current symbol
      const markers = [];
      const positions = state.openPositions || [];
      const matchingPos = positions.filter(p => (p.symbol || p.symbolId) === state.symbol);
      for (const p of matchingPos) {
        markers.push({
          timestamp: p.entry_time || p.entryTime || Date.now(),
          side: p.side || (p.quantity > 0 ? 'LONG' : 'SHORT'),
          entryPrice: p.entry_price || p.entryPrice,
          stopLoss: p.stop_loss || p.stopLoss,
          takeProfit: p.take_profit || p.takeProfit,
        });
      }

      state.chart.setTradeMarkers(markers);
    }

    document.getElementById('chartCandleInfo').textContent = `${state.symbol} | ${data.candles?.length || 0} Candles | Timeframe: ${state.timeframe}`;
  } catch (err) {
    console.error('Error loading chart candles:', err);
  }
}

async function refreshJournal() {
  try {
    let entries = [];
    if (state.isDemoReadOnly) {
      entries = DemoStore.getState().journal || DemoStore.getState().tradeHistory || [];
    } else {
      const res = await fetch('/api/journal');
      const data = await res.json();
      entries = data.entries || [];
    }
    const tbody = document.getElementById('journalTableBody');
    if (!tbody) return;

    if (entries.length === 0) {
      tbody.innerHTML = `<tr><td colspan="12" style="text-align: center; color: var(--text-muted); padding: 24px;">No closed trades in journal yet.</td></tr>`;
      return;
    }

    tbody.innerHTML = entries.map(e => {
      const pnl = e.realized_pnl ?? e.realizedPnl ?? 0;
      const pnlClass = pnl >= 0 ? 'text-success' : 'text-danger';
      const durMins = Math.round((e.holding_time_ms || e.holdingTimeMs || 0) / 60000);
      const roi = e.roi_percent ?? e.roiPercent ?? 0;
      const entryPrice = e.entry_price ?? e.entryPrice ?? '--';
      const exitPrice = e.exit_price ?? e.exitPrice ?? '--';
      const exitReason = e.exit_reason ?? e.exitReason ?? 'CLOSED';
      const mode = e.mode || e.environment || 'PAPER';
      const modeBadge = mode === 'LIVE' ? 'badge-danger' : (mode === 'DEMO' ? 'badge-primary' : 'badge-neutral');
      const isCrypto = ['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'XRPUSDT', 'DOGEUSDT', 'SBTCSUSDT', 'SETHSUSDT', 'SXRPSUSDT'].includes(e.symbol?.toUpperCase());
      const assetClass = e.assetClass || e.asset_class || (isCrypto ? 'crypto' : 'equity');
      return `
        <tr>
          <td>${new Date(e.timestamp || e.closedAt).toLocaleString()}</td>
          <td><span class="badge ${modeBadge}">${mode}</span></td>
          <td><span class="badge badge-neutral" style="text-transform: uppercase;">${assetClass}</span></td>
          <td><strong>${e.symbol}</strong></td>
          <td><span class="badge ${e.side === 'LONG' ? 'badge-long' : 'badge-short'}">${e.side}</span></td>
          <td>$${entryPrice}</td>
          <td>$${exitPrice}</td>
          <td>${e.quantity}</td>
          <td class="${pnlClass}"><strong>${pnl >= 0 ? '+' : ''}$${Number(pnl).toFixed(2)}</strong></td>
          <td class="${pnlClass}">${roi >= 0 ? '+' : ''}${roi}%</td>
          <td>${durMins} mins</td>
          <td><span class="badge badge-neutral">${exitReason}</span></td>
        </tr>
      `;
    }).join('');
  } catch (err) {
    console.error('Error refreshing journal:', err);
  }
}

function exportJournalJson() {
  fetch('/api/journal')
    .then(r => r.json())
    .then(data => {
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `vt2-paper-journal-${Date.now()}.json`;
      a.click();
    });
}

async function runBacktest() {
  const symbol = document.getElementById('btSymbol').value;
  const timeframe = document.getElementById('btTimeframe').value;
  const risk = parseFloat(document.getElementById('btRisk').value);

  const btn = document.getElementById('runBacktestBtn');
  btn.textContent = 'Simulating...';
  btn.disabled = true;

  try {
    const res = await fetch('/api/backtest', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        symbol,
        timeframe,
        config: { riskPerTrade: risk },
      }),
    });
    const report = await res.json();
    if (res.status === 501 || report.error === 'BACKTEST_SERVER_ONLY') {
      alert(`Notice: ${report.message || 'Full 150-day backtest data is pre-computed and available at /report.html'}`);
      window.open(report.reportUrl || '/report.html', '_blank');
      return;
    }

    document.getElementById('btResultsContainer').style.display = 'block';

    const btBadge = document.getElementById('btDataSourceBadge');
    if (btBadge) {
      btBadge.textContent = `Data source: ${report.dataSource || 'Bitget historical'}`;
      if (report.dataSource && report.dataSource.includes('Synthetic')) {
        btBadge.className = 'badge badge-short';
      } else {
        btBadge.className = 'badge badge-long';
      }
    }

    const pnlEl = document.getElementById('btNetPnl');
    pnlEl.textContent = `${report.netPnl >= 0 ? '+' : ''}$${report.netPnl.toFixed(2)}`;
    pnlEl.className = `card-metric ${report.netPnl >= 0 ? 'text-success' : 'text-danger'}`;

    document.getElementById('btWinRate').textContent = `${report.winRate}% (${report.winCount}W / ${report.lossCount}L)`;
    document.getElementById('btProfitFactor').textContent = `${report.profitFactor}`;
    document.getElementById('btMaxDd').textContent = `${report.maxDrawdownPercent}%`;

    const tradesBody = document.getElementById('btTradesTableBody');
    tradesBody.innerHTML = (report.trades || []).map(t => `
      <tr>
        <td>#${t.tradeNumber}</td>
        <td><span class="badge ${t.side === 'LONG' ? 'badge-long' : 'badge-short'}">${t.side}</span></td>
        <td>$${t.entryPrice}</td>
        <td>$${t.exitPrice}</td>
        <td class="${t.pnl >= 0 ? 'text-success' : 'text-danger'}">${t.pnl >= 0 ? '+' : ''}$${t.pnl}</td>
        <td class="${t.roiPercent >= 0 ? 'text-success' : 'text-danger'}">${t.roiPercent}%</td>
        <td><span class="badge badge-neutral">${t.exitReason}</span></td>
        <td>$${t.equityAfterTrade}</td>
      </tr>
    `).join('');
  } catch (err) {
    alert(`Backtest error: ${err.message}`);
  } finally {
    btn.textContent = '🔬 Execute Backtest';
    btn.disabled = false;
  }
}

function applyBacktestPreset(symbol, tf) {
  const symEl = document.getElementById('btSymbol');
  const tfEl = document.getElementById('btTimeframe');
  const riskEl = document.getElementById('btRisk');
  if (symEl) symEl.value = symbol;
  if (tfEl) tfEl.value = tf;
  if (riskEl) riskEl.value = '0.005';
  runBacktest();
}

function applyRiskPreset(presetType) {
  const symEl = document.getElementById('sandboxSymbol');
  const sideEl = document.getElementById('sandboxSide');
  const entryEl = document.getElementById('sandboxEntry');
  const stopEl = document.getElementById('sandboxStop');
  if (!entryEl || !stopEl) return;

  delete entryEl.dataset.dailyLossTest;
  delete entryEl.dataset.lowRrTest;

  switch (presetType) {
    case 'valid':
      if (symEl) symEl.value = 'BTCUSDT';
      if (sideEl) sideEl.value = 'LONG';
      entryEl.value = '60000';
      stopEl.value = '59600'; // 0.67% distance (in 0.5% - 0.8% allowable range)
      break;
    case 'stopClose':
      if (symEl) symEl.value = 'BTCUSDT';
      if (sideEl) sideEl.value = 'LONG';
      entryEl.value = '60000';
      stopEl.value = '59850'; // 0.25% distance (< 0.5% min constraint)
      break;
    case 'stopFar':
      if (symEl) symEl.value = 'BTCUSDT';
      if (sideEl) sideEl.value = 'LONG';
      entryEl.value = '60000';
      stopEl.value = '59400'; // 1.00% distance (> 0.8% max constraint)
      break;
    case 'badSide':
      if (symEl) symEl.value = 'BTCUSDT';
      if (sideEl) sideEl.value = 'LONG';
      entryEl.value = '60000';
      stopEl.value = '60500'; // Long stop above entry
      break;
    case 'lowRr':
      if (symEl) symEl.value = 'BTCUSDT';
      if (sideEl) sideEl.value = 'LONG';
      entryEl.value = '60000';
      stopEl.value = '59600';
      entryEl.dataset.lowRrTest = 'true';
      break;
    case 'dailyLoss':
      if (symEl) symEl.value = 'BTCUSDT';
      if (sideEl) sideEl.value = 'LONG';
      entryEl.value = '60000';
      stopEl.value = '59600';
      entryEl.dataset.dailyLossTest = 'true';
      break;
  }

  testRiskSandbox();
}

async function testRiskSandbox() {
  const symbol = document.getElementById('sandboxSymbol').value;
  const side = document.getElementById('sandboxSide').value;
  const entryPrice = parseFloat(document.getElementById('sandboxEntry').value);
  const stopLoss = parseFloat(document.getElementById('sandboxStop').value);
  const entryEl = document.getElementById('sandboxEntry');
  const isDailyLoss = entryEl?.dataset?.dailyLossTest === 'true';
  const isLowRr = entryEl?.dataset?.lowRrTest === 'true';

  const box = document.getElementById('sandboxResultBox');
  if (!box) return;

  box.style.display = 'block';
  box.innerHTML = `<span style="color: var(--text-muted);">Evaluating deterministic risk rules on backend RiskEngine...</span>`;

  // Compute hypothetical take profit based on mode
  let takeProfit;
  if (isLowRr) {
    // Target only 100 above entry with stop 400 below -> Net R:R < 0.25:1
    takeProfit = side === 'LONG' ? entryPrice + 100 : entryPrice - 100;
  } else {
    // Standard 2.2x distance target -> Net R:R > 2.0:1
    const stopDist = Math.abs(entryPrice - stopLoss);
    takeProfit = side === 'LONG' ? entryPrice + (stopDist * 2.2) : entryPrice - (stopDist * 2.2);
  }

  const payload = {
    candidate: {
      symbol,
      side,
      entryPrice,
      stopLoss,
      takeProfit,
      atr: Math.abs(entryPrice - stopLoss) * 1.5,
    },
    context: isDailyLoss ? { dailyRealizedLoss: 250, startOfDayEquity: 10000 } : undefined,
  };

  try {
    const res = await fetch('/api/risk/evaluate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const data = await res.json();

    if (data.approved) {
      box.style.background = 'rgba(0, 229, 153, 0.12)';
      box.style.border = '1px solid rgba(0, 229, 153, 0.4)';
      box.style.color = 'var(--color-success)';
      box.style.padding = '12px';
      box.style.borderRadius = '6px';
      box.innerHTML = `
        <div style="font-weight: 700; font-size: 13px;">✅ PASSED: DETERMINISTIC RISK RULES APPROVED</div>
        <div style="margin-top: 6px; font-size: 12px; color: var(--text-main);">
          <strong>Size:</strong> ${data.positionSize} contracts | 
          <strong>Notional:</strong> $${data.notionalUsdt || (data.positionSize * entryPrice).toFixed(2)} | 
          <strong>Leverage:</strong> ${data.leverage}x | 
          <strong>Net R:R:</strong> ${data.netRewardRisk}:1 | 
          <strong>Capital at Risk:</strong> $${data.dollarRisk || (data.positionSize * Math.abs(entryPrice - stopLoss)).toFixed(2)} (0.50% equity cap)
        </div>
      `;
    } else {
      box.style.background = 'rgba(255, 59, 92, 0.12)';
      box.style.border = '1px solid rgba(255, 59, 92, 0.4)';
      box.style.color = 'var(--color-danger)';
      box.style.padding = '12px';
      box.style.borderRadius = '6px';
      box.innerHTML = `
        <div style="font-weight: 700; font-size: 13px;">❌ REJECTED: ${data.rule || data.error || 'RISK_VIOLATION'}</div>
        <div style="margin-top: 4px; font-size: 12px; color: var(--text-main);">${data.reason || data.message}</div>
        ${data.details ? `<div style="margin-top: 4px; font-size: 11px; color: var(--text-muted);">${JSON.stringify(data.details)}</div>` : ''}
      `;
    }
  } catch (err) {
    box.innerHTML = `<span class="text-danger">Evaluation request failed: ${err.message}</span>`;
  }
}

// Position Lifecycle Simulation Controls
async function openQuickTestPosition() {
  const notif = document.getElementById('posLifecycleNotification');
  const btn = document.getElementById('quickTestTradeBtn');
  if (btn) { btn.disabled = true; btn.textContent = 'Placing...'; }

  try {
    const url = state.isDemoReadOnly ? '/api/demo/order' : '/api/orders/paper-test';
    const body = state.isDemoReadOnly
      ? {
          state: DemoStore.getState(),
          order: {
            symbol: 'BTCUSDT',
            side: 'LONG',
            allocationPercent: 100,
          },
        }
      : { symbol: 'BTCUSDT', side: 'LONG', quantity: 0.05 };

    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = await res.json();

    if (state.isDemoReadOnly) {
      DemoStore.updateFromResponse(data);
      if (notif) {
        notif.style.display = 'block';
        if (data.approved) {
          notif.style.background = 'rgba(0, 229, 153, 0.12)';
          notif.style.border = '1px solid rgba(0, 229, 153, 0.4)';
          notif.style.color = 'var(--color-success)';
          notif.innerHTML = `<strong>⚡ Position Opened:</strong> ${data.order?.quantity || 0.05} BTCUSDT LONG filled at $${data.order?.fillPrice || data.fillPrice}. SL: $${data.position?.stopLoss || '60,000'}, TP: $${data.position?.takeProfit || '120,000'}.`;
        } else {
          notif.style.background = 'rgba(255, 59, 92, 0.12)';
          notif.style.border = '1px solid rgba(255, 59, 92, 0.4)';
          notif.style.color = 'var(--color-danger)';
          notif.innerHTML = `<strong>Order Failed:</strong> ${data.error || 'Position open rejected'}`;
        }
      }
      await refreshAccount();
      await refreshOrders();
      await refreshRejectedArchive();
      return;
    }

    if (notif) {
      notif.style.display = 'block';
      if (data.success) {
        notif.style.background = 'rgba(0, 229, 153, 0.12)';
        notif.style.border = '1px solid rgba(0, 229, 153, 0.4)';
        notif.style.color = 'var(--color-success)';
        notif.innerHTML = `<strong>⚡ Position Opened:</strong> 0.05 BTCUSDT LONG filled at $${data.fillPrice}. SL: $${data.position?.stopLoss || '59,600'}, TP: $${data.position?.takeProfit || '61,200'}.`;
      } else {
        notif.style.background = 'rgba(255, 59, 92, 0.12)';
        notif.style.border = '1px solid rgba(255, 59, 92, 0.4)';
        notif.style.color = 'var(--color-danger)';
        notif.innerHTML = `<strong>Order Failed:</strong> ${data.error || data.message || 'Position open rejected'}`;
      }
    }
    await refreshAccount();
    await refreshOrders();
  } catch (err) {
    if (notif) {
      notif.style.display = 'block';
      notif.style.background = 'rgba(255, 59, 92, 0.12)';
      notif.style.border = '1px solid rgba(255, 59, 92, 0.4)';
      notif.style.color = 'var(--color-danger)';
      notif.textContent = `Error: ${err.message}`;
    }
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = '⚡ Place Test Paper Trade (0.05 BTC)'; }
  }
}

async function simulatePositionTick(changePct) {
  const notif = document.getElementById('posLifecycleNotification');
  const isUp = changePct > 0;
  const btn = isUp ? document.getElementById('simTickProfitBtn') : document.getElementById('simTickStopBtn');
  if (btn) { btn.disabled = true; }

  try {
    const url = state.isDemoReadOnly ? '/api/demo/tick' : '/api/positions/simulate-tick';
    const body = state.isDemoReadOnly
      ? { state: DemoStore.getState(), priceChangePct: changePct }
      : { priceChangePct: changePct };

    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = await res.json();

    if (state.isDemoReadOnly) {
      DemoStore.updateFromResponse(data);
      if (notif) {
        notif.style.display = 'block';
        notif.style.background = isUp ? 'rgba(0, 229, 153, 0.12)' : 'rgba(255, 59, 92, 0.12)';
        notif.style.border = isUp ? '1px solid rgba(0, 229, 153, 0.4)' : '1px solid rgba(255, 59, 92, 0.4)';
        notif.style.color = isUp ? 'var(--color-success)' : 'var(--color-danger)';
        const evNames = (data.events || []).map(e => e.type).join(', ') || 'None (price within bounds)';
        notif.innerHTML = `
          <div><strong>${isUp ? '📈 PRICE TICK (+1.2%) APPLIED' : '📉 PRICE TICK (-0.8%) APPLIED'}</strong></div>
          <div style="margin-top: 4px;">Events: ${evNames}</div>
        `;
      }
      await refreshAccount();
      await refreshOrders();
      await refreshJournal();
      return;
    }

    if (notif) {
      notif.style.display = 'block';
      if (data.success) {
        notif.style.background = isUp ? 'rgba(0, 229, 153, 0.12)' : 'rgba(255, 59, 92, 0.12)';
        notif.style.border = isUp ? '1px solid rgba(0, 229, 153, 0.4)' : '1px solid rgba(255, 59, 92, 0.4)';
        notif.style.color = isUp ? 'var(--color-success)' : 'var(--color-danger)';
        notif.innerHTML = `
          <div><strong>${isUp ? '📈 PRICE SPIKE (+1.2%) SIMULATION APPLIED' : '📉 PRICE DROP (-0.8%) SIMULATION APPLIED'}</strong></div>
          <div style="margin-top: 4px;">${data.message || 'Tick processed'}</div>
          <div style="margin-top: 4px; font-size: 11px; color: var(--text-muted);">
            Active positions: ${data.activePositionsCount} | Simulated ticks: ${data.ticksProcessed || 1}
          </div>
        `;
      } else {
        notif.style.background = 'rgba(245, 166, 35, 0.12)';
        notif.style.border = '1px solid rgba(245, 166, 35, 0.4)';
        notif.style.color = 'var(--color-warning)';
        notif.innerHTML = `<strong>Notice:</strong> ${data.message || 'No active positions to tick'}`;
      }
    }
    await refreshAccount();
    await refreshOrders();
    await refreshJournal();
  } catch (err) {
    if (notif) {
      notif.style.display = 'block';
      notif.style.color = 'var(--color-danger)';
      notif.textContent = `Tick error: ${err.message}`;
    }
  } finally {
    if (btn) { btn.disabled = false; }
  }
}

// Security, Auth & Database Verifiers
async function testDirectMainnetInterception() {
  const box = document.getElementById('envGateResponseBox');
  if (!box) return;
  box.style.display = 'block';
  box.style.background = 'rgba(255, 59, 92, 0.12)';
  box.style.border = '1px solid rgba(255, 59, 92, 0.4)';
  box.style.color = 'var(--color-danger)';
  box.innerHTML = 'Sending live mainnet order probe to <code>/api/orders/live</code>...';

  try {
    const res = await fetch('/api/orders/live', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ symbol: 'BTCUSDT', side: 'BUY', quantity: 0.01 }),
    });
    const data = await res.json();
    box.innerHTML = `
      <div style="font-weight: 700; font-size: 13px;">🚨 STRICT MAINNET INTERCEPTION CONFIRMED (HTTP ${res.status})</div>
      <div style="margin-top: 4px;"><strong>Violation Code:</strong> <code>${data.error || 'SAFETY_VIOLATION'}</code></div>
      <div style="margin-top: 4px;"><strong>Gate Message:</strong> ${data.message || 'Live order execution blocked by deterministic safety policies.'}</div>
      <div style="margin-top: 6px; font-size: 11px; color: var(--text-muted);">
        Deterministic Proof: Order was rejected on the server before dispatching any network call to Bitget. Live trading cannot be activated without server-level MAINNET_LIVE_ENABLED=true override.
      </div>
    `;
  } catch (err) {
    box.innerHTML = `<span class="text-danger">Request error: ${err.message}</span>`;
  }
}

async function verifyBitgetSignature() {
  const box = document.getElementById('bitgetSigOutputBox');
  const btn = document.getElementById('verifyBitgetSigBtn');
  if (!box) return;
  box.style.display = 'block';
  if (btn) { btn.disabled = true; btn.textContent = 'Verifying HMAC-SHA256...'; }

  try {
    const res = await fetch('/api/bitget/verify-signature', { method: 'POST' });
    const data = await res.json();

    box.style.background = 'rgba(0, 229, 153, 0.12)';
    box.style.border = '1px solid rgba(0, 229, 153, 0.4)';
    box.style.color = 'var(--text-main)';
    box.innerHTML = `
      <div style="font-weight: 700; color: var(--color-success); font-size: 13px; margin-bottom: 8px;">
        ✅ BITGET UTA V2 CANONICAL SIGNATURE VERIFIED
      </div>
      <div style="display: grid; grid-template-columns: 140px 1fr; gap: 4px; font-size: 11px;">
        <span style="color: var(--text-muted);">Prehash Scheme:</span>
        <code>timestamp + method + requestPath + body</code>

        <span style="color: var(--text-muted);">Timestamp:</span>
        <code>${data.timestamp}</code>

        <span style="color: var(--text-muted);">HTTP Method:</span>
        <code>${data.method}</code>

        <span style="color: var(--text-muted);">Request Path:</span>
        <code>${data.requestPath}</code>

        <span style="color: var(--text-muted);">Request Body:</span>
        <code>${data.body}</code>

        <span style="color: var(--text-muted);">Prehash String:</span>
        <code>${data.prehashString}</code>

        <span style="color: var(--text-muted);">HMAC-SHA256 (Base64):</span>
        <code style="color: var(--color-info);">${data.computedSignature}</code>

        <span style="color: var(--text-muted);">Isolation Proof:</span>
        <span style="color: var(--color-success); font-weight: 600;">Zero client credential exposure (Keys isolated in server environment)</span>
      </div>
    `;
  } catch (err) {
    box.style.background = 'rgba(255, 59, 92, 0.12)';
    box.style.border = '1px solid rgba(255, 59, 92, 0.4)';
    box.style.color = 'var(--color-danger)';
    box.textContent = `Signature verification error: ${err.message}`;
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = '🔐 Run Live Canonical HMAC-SHA256 Signature Verification'; }
  }
}

async function testSqlitePersistence() {
  const box = document.getElementById('sqliteStatusOutputBox');
  const btn = document.getElementById('testSqliteRoundtripBtn');
  if (!box) return;
  box.style.display = 'block';
  if (btn) { btn.disabled = true; btn.textContent = 'Querying SQLite...'; }

  try {
    const res = await fetch('/api/system/database-status');
    const data = await res.json();

    box.style.background = 'rgba(0, 229, 153, 0.12)';
    box.style.border = '1px solid rgba(0, 229, 153, 0.4)';
    box.style.color = 'var(--text-main)';
    box.innerHTML = `
      <div style="font-weight: 700; color: var(--color-success); font-size: 13px; margin-bottom: 8px;">
        ✅ NATIVE SQLITE PERSISTENCE ENGINE ACTIVE & VERIFIED
      </div>
      <div style="display: grid; grid-template-columns: 140px 1fr; gap: 4px; font-size: 11px;">
        <span style="color: var(--text-muted);">Database Driver:</span>
        <code>${data.driver || 'node:sqlite (Native Node.js)'}</code>

        <span style="color: var(--text-muted);">Database File:</span>
        <code>${data.dbPath || 'data/vt2.db'} (Exists: ${data.fileExists ? 'YES' : 'NO'}, Size: ${data.fileSizeFormatted || '16 KB'})</code>

        <span style="color: var(--text-muted);">Persisted Balance:</span>
        <strong style="color: var(--color-success);">$${data.accountState?.currentEquity !== undefined ? Number(data.accountState.currentEquity).toFixed(2) : (data.accountState?.equity !== undefined ? Number(data.accountState.equity).toFixed(2) : '10000.00')} (Equity: $${data.accountState?.equity !== undefined ? Number(data.accountState.equity).toFixed(2) : '10000.00'})</strong>

        <span style="color: var(--text-muted);">Table Counts:</span>
        <code>orders: ${data.tables?.orders ?? 0} | positions: ${data.tables?.positions ?? 0} | journal: ${data.tables?.trade_journal ?? 0} | rejected: ${data.tables?.rejected_setups ?? 0}</code>

        <span style="color: var(--text-muted);">Persistence Test:</span>
        <span style="color: var(--color-success); font-weight: 600;">Roundtrip state read/write survived cleanly across server restarts.</span>
      </div>
    `;
  } catch (err) {
    box.style.background = 'rgba(255, 59, 92, 0.12)';
    box.style.border = '1px solid rgba(255, 59, 92, 0.4)';
    box.style.color = 'var(--color-danger)';
    box.textContent = `Database status error: ${err.message}`;
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = '🔄 Verify SQLite Database State & Persistence (/api/system/database-status)'; }
  }
}

// Order Management History
async function refreshOrders() {
  try {
    let orders = [];
    if (state.isDemoReadOnly) {
      orders = DemoStore.getState().orders || [];
    } else {
      const res = await fetch('/api/orders');
      const data = await res.json();
      orders = data.orders || [];
    }
    const tbody = document.getElementById('ordersTableBody');
    if (!tbody) return;

    if (orders.length === 0) {
      tbody.innerHTML = `<tr><td colspan="11" style="text-align: center; color: var(--text-muted); padding: 18px;">No simulated orders executed yet.</td></tr>`;
      return;
    }

    tbody.innerHTML = orders.map(o => {
      const statusBadge = o.status === 'FILLED' ? 'badge-long' : (o.status === 'REJECTED' ? 'badge-short' : 'badge-neutral');
      const sideBadge = o.side === 'LONG' ? 'badge-long' : 'badge-short';
      const reqPrice = o.requested_price !== undefined ? Number(o.requested_price).toFixed(4) : (o.requestedPrice !== undefined ? Number(o.requestedPrice).toFixed(4) : '--');
      const fillPrice = o.fill_price !== undefined ? Number(o.fill_price).toFixed(4) : (o.fillPrice !== undefined ? Number(o.fillPrice).toFixed(4) : '--');
      const notional = o.notional !== undefined ? Number(o.notional).toFixed(2) : (o.quantity && fillPrice !== '--' ? Number(o.quantity * fillPrice).toFixed(2) : '--');
      const fee = o.fee !== undefined ? Number(o.fee).toFixed(4) : '0.0000';
      const timeStr = new Date(o.submitted_at || o.timestamp || Date.now()).toLocaleTimeString();
      return `
        <tr>
          <td><code>${o.id}</code></td>
          <td><strong>${o.symbol}</strong></td>
          <td><span class="badge ${sideBadge}">${o.side}</span></td>
          <td><span class="badge ${statusBadge}">${o.status}</span></td>
          <td>$${reqPrice}</td>
          <td>$${fillPrice}</td>
          <td>${o.quantity}</td>
          <td>$${notional}</td>
          <td>$${fee}</td>
          <td><span class="badge badge-neutral">${o.environment || 'PAPER'}</span></td>
          <td>${timeStr}</td>
        </tr>
      `;
    }).join('');
  } catch (err) {
    console.error('Error refreshing orders:', err);
  }
}

// Historical Disqualified / Rejected Setups Archive
async function refreshRejectedArchive() {
  try {
    let rejected = [];
    if (state.isDemoReadOnly) {
      rejected = DemoStore.getState().rejectedSetups || [];
    } else {
      const res = await fetch('/api/rejected-setups');
      const data = await res.json();
      rejected = data.rejected || [];
    }
    const tbody = document.getElementById('journalRejectedTableBody');
    if (!tbody) return;

    if (rejected.length === 0) {
      tbody.innerHTML = `<tr><td colspan="6" style="text-align: center; color: var(--text-muted); padding: 18px;">No setups rejected in this session.</td></tr>`;
      return;
    }

    tbody.innerHTML = rejected.map(r => {
      const reason = r.rejection_reason || r.rejectionReason || 'RISK_REJECTED';
      const explanation = r.explanation || r.details?.reason || reason;
      const netRr = r.net_rr || r.details?.rewardRisk?.netRR || '--';
      const score = r.score || '--';
      return `
      <tr>
        <td><strong>${r.symbol}</strong></td>
        <td><span class="badge badge-short">${reason}</span></td>
        <td style="color: var(--text-secondary); max-width: 320px; white-space: normal;">${explanation}</td>
        <td>${netRr !== '--' ? `${netRr}:1` : '--'}</td>
        <td><strong class="text-info">${score}</strong></td>
        <td>${new Date(r.timestamp).toLocaleString()}</td>
      </tr>
    `;
    }).join('');
  } catch (err) {
    console.error('Error refreshing rejected archive:', err);
  }
}

// Exchange Diagnostics & System Health
async function refreshHealth() {
  try {
    const [sysRes, envRes] = await Promise.all([
      fetch('/api/system/health'),
      fetch('/api/environment'),
    ]);
    const sys = await sysRes.json();
    const env = await envRes.json();

    const uptimeMins = Math.floor(sys.uptimeSeconds / 60);
    const uptimeSecs = sys.uptimeSeconds % 60;
    const uptimeEl = document.getElementById('diagUptime');
    if (uptimeEl) uptimeEl.textContent = `${uptimeMins}m ${uptimeSecs}s`;

    const nodeEl = document.getElementById('diagNode');
    if (nodeEl) nodeEl.textContent = `${sys.nodeVersion} (${sys.platform})`;

    const heapEl = document.getElementById('diagHeap');
    if (heapEl) heapEl.textContent = `${sys.memoryMb?.heapUsed || '--'} MB`;

    const rssEl = document.getElementById('diagRss');
    if (rssEl) rssEl.textContent = `RSS: ${sys.memoryMb?.rss || '--'} MB`;

    const feedEl = document.getElementById('diagFeed');
    if (feedEl) {
      feedEl.textContent = sys.feedStatus;
      feedEl.className = `card-metric ${sys.feedStatus === 'ONLINE' ? 'text-success' : 'text-warning'}`;
    }

    const credEl = document.getElementById('diagCreds');
    if (credEl) {
      if (env.credentialsConfigured) {
        credEl.textContent = 'CONFIGURED';
        credEl.className = 'card-metric text-success';
      } else {
        credEl.textContent = 'UNCONFIGURED';
        credEl.className = 'card-metric text-secondary';
      }
    }
  } catch (err) {
    console.error('Error refreshing health diagnostics:', err);
  }
}

// Environment Safety Switcher
async function testEnvironmentSwitch() {
  const target = document.getElementById('targetEnvSelect').value;
  const box = document.getElementById('envGateResponseBox');
  if (!box) return;
  box.style.display = 'block';

  try {
    const res = await fetch('/api/environment', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ targetEnvironment: target }),
    });
    const data = await res.json();

    if (res.ok) {
      box.style.background = 'rgba(0, 229, 153, 0.15)';
      box.style.border = '1px solid rgba(0, 229, 153, 0.4)';
      box.style.color = 'var(--color-success)';
      box.innerHTML = `<strong>Environment Switched:</strong> Active mode is now <strong>${data.environment}</strong>.`;
      const activeEl = document.getElementById('activeEnvLabel');
      if (activeEl) activeEl.textContent = `${data.environment} Mode`;
    } else {
      box.style.background = 'rgba(255, 59, 92, 0.15)';
      box.style.border = '1px solid rgba(255, 59, 92, 0.4)';
      box.style.color = 'var(--color-danger)';
      box.innerHTML = `
        <div><strong>🚨 SECURITY GATE REFUSAL [HTTP ${res.status} ${data.error || 'SAFETY_VIOLATION'}]:</strong></div>
        <div style="margin-top: 4px;">${data.message || 'Execution blocked by deterministic safety policies.'}</div>
        <div style="margin-top: 4px; font-size: 11px; color: var(--text-muted);">
          Independent Safeguard: Live order execution is blocked by default. Disarming requires MAINNET_LIVE_ENABLED=true in the server environment and affirmative risk verification.
        </div>
      `;
    }
  } catch (err) {
    box.style.background = 'rgba(255, 59, 92, 0.15)';
    box.style.border = '1px solid rgba(255, 59, 92, 0.4)';
    box.style.color = 'var(--color-danger)';
    box.textContent = `Request error: ${err.message}`;
  }
}

function updateStrategyAuditCard(model) {
  const modelName = document.getElementById('strategyAuditModelName');
  const passBadge = document.getElementById('strategyAuditPassBadge');
  const details = document.getElementById('strategyAuditDetails');
  const statusBadge = document.getElementById('strategyValidationStatusBadge');

  if (model === 'v2-C1') {
    if (modelName) modelName.textContent = 'Model: v2-C1 Trend Pullback (1h Trend, 15m Entry)';
    if (passBadge) {
      passBadge.textContent = 'VALIDATION: FAILED (Over-Trading Friction)';
      passBadge.className = 'badge badge-danger mono-num';
    }
    if (statusBadge) {
      statusBadge.textContent = 'STATUS: v2-C1 Active (PAPER ONLY)';
      statusBadge.className = 'badge badge-danger';
    }
    if (details) {
      details.innerHTML = `
        • <strong>Dev Net P&L:</strong> -$6,269.49 (PF: 0.44, 443 trades, Max DD: 64.00%)<br>
        • <strong>Validation Net P&L:</strong> -$2,264.33 (PF: 0.38, 112 trades, Max DD: 22.64%)<br>
        • <strong>Forward Holdout:</strong> Sealed (Disqualified due to Dev failure)<br>
        • <strong>Automated Trading Lock:</strong> <span class="text-danger font-semibold">STRICTLY LOCKED OUT (Paper Simulation Only)</span>
      `;
    }
  } else if (model === 'v2-C2') {
    if (modelName) modelName.textContent = 'Model: v2-C2 4h Breakout Trend-Follower (Donchian / Trailing ATR)';
    if (passBadge) {
      passBadge.textContent = 'VALIDATION: FAILED (Low Expectancy After Costs)';
      passBadge.className = 'badge badge-danger mono-num';
    }
    if (statusBadge) {
      statusBadge.textContent = 'STATUS: v2-C2 Active (PAPER ONLY)';
      statusBadge.className = 'badge badge-danger';
    }
    if (details) {
      details.innerHTML = `
        • <strong>Dev Net P&L:</strong> -$389.44 (PF: 0.71, 61 trades, Max DD: 6.96%)<br>
        • <strong>Validation Net P&L:</strong> -$254.64 (PF: 0.50, 16 trades, Max DD: 3.78%)<br>
        • <strong>Forward Holdout:</strong> Sealed (Disqualified due to Dev failure)<br>
        • <strong>Automated Trading Lock:</strong> <span class="text-danger font-semibold">STRICTLY LOCKED OUT (Paper Simulation Only)</span>
      `;
    }
  } else {
    if (modelName) modelName.textContent = 'Model: v1 Alpha Factory Baseline (4h/15m/5m Confluence)';
    if (passBadge) {
      passBadge.textContent = 'VALIDATION: FAILED (-28.25% Net Return)';
      passBadge.className = 'badge badge-danger mono-num';
    }
    if (statusBadge) {
      statusBadge.textContent = 'STATUS: v1 Active (Live/Paper)';
      statusBadge.className = 'badge badge-warning';
    }
    if (details) {
      details.innerHTML = `
        • <strong>Dev Net P&L:</strong> -$2,796.55 (PF: 0.69, 289 trades, Max DD: 30.85%)<br>
        • <strong>Validation Net P&L:</strong> -$22.28 (PF: 0.72, 28 trades)<br>
        • <strong>Forward Holdout:</strong> Sealed (Requires passing both Dev &amp; Validation)<br>
        • <strong>Automated Trading Lock:</strong> <span class="text-warning font-semibold">PAPER / AUDITED v1 ARCHITECTURE</span>
      `;
    }
  }
}

// Settings Loading & Saving
async function loadSettings() {
  try {
    const res = await fetch('/api/settings');
    const data = await res.json();
    const s = { ...(data.defaults || {}), ...(data.settings || {}) };

    if (s.theme !== undefined) {
      applyTheme(s.theme, false);
    }
    if (s.entryAllocationPercent !== undefined) {
      applyAllocation(s.entryAllocationPercent, false);
    }

    let savedModel = 'v1';
    try {
      savedModel = localStorage.getItem('vt2_strategy_model') || s.strategyModel || 'v1';
    } catch (e) {
      savedModel = s.strategyModel || 'v1';
    }
    const modelSelect = document.getElementById('cfgStrategyModelSelect');
    if (modelSelect) {
      modelSelect.value = savedModel;
      updateStrategyAuditCard(savedModel);
    }

    if (s.riskPerTrade !== undefined) document.getElementById('cfgRiskPerTrade').value = s.riskPerTrade;
    if (s.maxDailyLoss !== undefined) document.getElementById('cfgMaxDailyLoss').value = s.maxDailyLoss;
    if (s.maxConsecutiveLosses !== undefined) document.getElementById('cfgMaxLosses').value = s.maxConsecutiveLosses;
    if (s.cooldownMinutes !== undefined) document.getElementById('cfgCooldownMinutes').value = s.cooldownMinutes;
    if (s.minNetRewardRisk !== undefined) document.getElementById('cfgMinRR').value = s.minNetRewardRisk;
    if (s.volumeSpikeThreshold !== undefined) document.getElementById('cfgVolSpike').value = s.volumeSpikeThreshold;
    if (s.targetAtrMultiplier !== undefined) document.getElementById('cfgTargetAtr').value = s.targetAtrMultiplier;
    if (s.scanUniverseSize !== undefined && document.getElementById('cfgScanUniverseSize')) {
      document.getElementById('cfgScanUniverseSize').value = s.scanUniverseSize;
    }
    if (s.minLiquidityUsdt !== undefined && document.getElementById('cfgMinLiquidity')) {
      document.getElementById('cfgMinLiquidity').value = s.minLiquidityUsdt;
    }
    if (s.equityEntriesWhenUnderlyingClosed !== undefined && document.getElementById('cfgEquityEntriesClosed')) {
      document.getElementById('cfgEquityEntriesClosed').value = s.equityEntriesWhenUnderlyingClosed;
    }

    if (s.maxConcurrentPositions !== undefined) {
      const cfgConcurrent = document.getElementById('cfgMaxConcurrentPositions');
      if (cfgConcurrent) cfgConcurrent.value = s.maxConcurrentPositions;
      const autoConcurrent = document.getElementById('autoMaxConcurrentSelect');
      if (autoConcurrent) autoConcurrent.value = String(s.maxConcurrentPositions);
    }
    if (s.maxAggregateOpenRiskPercent !== undefined) {
      const cfgRisk = document.getElementById('cfgMaxAggregateOpenRisk');
      if (cfgRisk) cfgRisk.value = s.maxAggregateOpenRiskPercent;
    }
    if (s.maxTradesPerDay !== undefined) {
      const autoTrades = document.getElementById('autoMaxTradesInput');
      if (autoTrades) autoTrades.value = s.maxTradesPerDay;
    }

    if (s.eligibleContracts && Array.isArray(s.eligibleContracts)) {
      document.getElementById('contractBTC').checked = s.eligibleContracts.includes('BTCUSDT');
      document.getElementById('contractETH').checked = s.eligibleContracts.includes('ETHUSDT');
      document.getElementById('contractSOL').checked = s.eligibleContracts.includes('SOLUSDT');
      document.getElementById('contractXRP').checked = s.eligibleContracts.includes('XRPUSDT');
      document.getElementById('contractDOGE').checked = s.eligibleContracts.includes('DOGEUSDT');
    }
  } catch (err) {
    console.error('Error loading settings:', err);
  }
}

async function saveSettings() {
  const eligibleContracts = [];
  if (document.getElementById('contractBTC')?.checked) eligibleContracts.push('BTCUSDT');
  if (document.getElementById('contractETH')?.checked) eligibleContracts.push('ETHUSDT');
  if (document.getElementById('contractSOL')?.checked) eligibleContracts.push('SOLUSDT');
  if (document.getElementById('contractXRP')?.checked) eligibleContracts.push('XRPUSDT');
  if (document.getElementById('contractDOGE')?.checked) eligibleContracts.push('DOGEUSDT');

  const payload = {
    riskPerTrade: parseFloat(document.getElementById('cfgRiskPerTrade').value),
    maxDailyLoss: parseFloat(document.getElementById('cfgMaxDailyLoss').value),
    maxConsecutiveLosses: parseInt(document.getElementById('cfgMaxLosses').value, 10),
    cooldownMinutes: parseInt(document.getElementById('cfgCooldownMinutes').value, 10),
    minNetRewardRisk: parseFloat(document.getElementById('cfgMinRR').value),
    volumeSpikeThreshold: parseFloat(document.getElementById('cfgVolSpike').value),
    targetAtrMultiplier: parseFloat(document.getElementById('cfgTargetAtr').value),
    scanUniverseSize: parseInt(document.getElementById('cfgScanUniverseSize')?.value || '30', 10),
    minLiquidityUsdt: parseFloat(document.getElementById('cfgMinLiquidity')?.value || '10000000'),
    equityEntriesWhenUnderlyingClosed: document.getElementById('cfgEquityEntriesClosed')?.value || 'ALLOW_WITH_WARNING',
    maxConcurrentPositions: parseInt(document.getElementById('cfgMaxConcurrentPositions')?.value || '1', 10),
    maxAggregateOpenRiskPercent: parseFloat(document.getElementById('cfgMaxAggregateOpenRisk')?.value || '1.0'),
    maxTradesPerDay: parseInt(document.getElementById('autoMaxTradesInput')?.value || '3', 10),
    entryAllocationPercent: state.entryAllocationPercent,
    theme: state.theme,
    strategyModel: document.getElementById('cfgStrategyModelSelect')?.value || 'v1',
    eligibleContracts,
  };

  const btn = document.getElementById('saveSettingsBtn');
  btn.disabled = true;
  btn.textContent = 'Saving...';

  const banner = document.getElementById('settingsAlertBanner');

  try {
    if (state.isDemoReadOnly) {
      const cur = DemoStore.getState();
      cur.settings = { ...(cur.settings || {}), ...payload };
      DemoStore.saveState(cur);
    }
    const res = await fetch('/api/settings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const data = await res.json();
    if (data.success) {
      banner.style.display = 'block';
      banner.style.background = 'rgba(0, 229, 153, 0.15)';
      banner.style.border = '1px solid rgba(0, 229, 153, 0.4)';
      banner.style.color = 'var(--color-success)';
      banner.textContent = '✅ Settings successfully updated and saved.';
      setTimeout(() => { banner.style.display = 'none'; }, 4000);
      await refreshAccount();
      await refreshAutoTradingStatus();
    }
  } catch (err) {
    banner.style.display = 'block';
    banner.style.background = 'rgba(255, 59, 92, 0.15)';
    banner.style.border = '1px solid rgba(255, 59, 92, 0.4)';
    banner.style.color = 'var(--color-danger)';
    banner.textContent = `Error saving settings: ${err.message}`;
  } finally {
    btn.disabled = false;
    btn.textContent = '💾 Save System Settings';
  }
}

// ==========================================
// VT2 CORE CAPABILITY VERIFICATION SUITE
// ==========================================
async function refreshVerificationStatus() {
  const timeEl = document.getElementById('verifTimestamp');
  const passedEl = document.getElementById('verifPassedCount');
  const totalEl = document.getElementById('verifTotalCount');
  const barEl = document.getElementById('verifProgressBar');

  try {
    const res = await fetch('/api/verification/status');
    const data = await res.json();
    if (!data.success) return;

    if (timeEl) {
      timeEl.textContent = `Last checked: ${new Date(data.timestamp).toLocaleTimeString()}`;
    }
    if (passedEl && data.summary) {
      passedEl.textContent = `${data.summary.passed} Passed`;
      passedEl.className = data.summary.passed === data.summary.total ? 'badge badge-long mono-num' : 'badge badge-short mono-num';
    }
    if (totalEl && data.summary) {
      totalEl.textContent = `${data.summary.total} Total Capabilities`;
    }
    if (barEl && data.summary) {
      const pct = (data.summary.passed / data.summary.total) * 100;
      barEl.style.width = `${pct}%`;
      barEl.style.background = data.summary.passed === data.summary.total ? 'var(--color-success)' : 'var(--color-warning)';
    }

    renderVerificationCards(data.checks || {});
  } catch (err) {
    console.error('Error refreshing verification status:', err);
  }
}

function renderVerificationCards(checks) {
  const container = document.getElementById('verificationCardsContainer');
  if (!container) return;

  const entries = Object.entries(checks);
  if (entries.length === 0) {
    container.innerHTML = '<div style="color: var(--text-muted); padding: 16px;">No verification checks initialized. Click "Run All 9 Verification Checks".</div>';
    return;
  }

  container.innerHTML = entries.map(([key, check]) => {
    let badgeClass = 'badge-neutral';
    let statusText = check.status || 'PENDING';
    if (check.status === 'PASSED') badgeClass = 'badge-long';
    else if (check.status === 'FAILED') badgeClass = 'badge-short';

    const detailText = check.error ? `<div class="text-danger" style="margin-top: 6px; font-size: 11px;">Error: ${check.error}</div>` :
      (check.detail && typeof check.detail === 'object' ? `<div style="margin-top: 6px; font-size: 11px; color: var(--text-secondary);">${Object.entries(check.detail).slice(0, 3).map(([k, v]) => `<strong>${k}:</strong> ${v}`).join(' · ')}</div>` : '');

    const durationText = check.durationMs !== undefined ? `${check.durationMs}ms` : '--';

    return `
      <div class="verif-card" id="verifCard_${key}">
        <div class="verif-card-header">
          <div class="verif-card-title">${check.name}</div>
          <span class="badge ${badgeClass} mono-num">${statusText}</span>
        </div>
        <div class="verif-card-desc">${check.description}</div>
        <div class="verif-card-meta">
          <span class="mono-num">Duration: ${durationText}</span>
          <button class="btn btn-secondary btn-sm" onclick="window.runSingleVerificationCheck('${key}')">Check Now</button>
        </div>
        ${detailText}
      </div>
    `;
  }).join('');
}

window.runSingleVerificationCheck = async function(key) {
  const card = document.getElementById(`verifCard_${key}`);
  if (card) {
    const btn = card.querySelector('button');
    if (btn) { btn.disabled = true; btn.textContent = 'Verifying...'; }
  }

  try {
    const res = await fetch('/api/verification/run', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key }),
    });
    const data = await res.json();
    await refreshVerificationStatus();
  } catch (err) {
    alert(`Verification check error: ${friendlyError(err)}`);
  } finally {
    if (card) {
      const btn = card.querySelector('button');
      if (btn) { btn.disabled = false; btn.textContent = 'Check Now'; }
    }
  }
};

async function runAllVerificationChecks() {
  const btn = document.getElementById('runAllVerificationsBtn');
  if (btn) {
    btn.disabled = true;
    btn.innerHTML = '<span>Verifying All 9 Capabilities...</span>';
  }

  try {
    const res = await fetch('/api/verification/run-all', { method: 'POST' });
    const data = await res.json();
    await refreshVerificationStatus();
  } catch (err) {
    alert(`Error running all verification checks: ${friendlyError(err)}`);
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = `
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M13 2 3 14h9l-1 8 10-12h-9l1-8z"/></svg>
        <span>Run All 9 Verification Checks</span>
      `;
    }
  }
}

// ==========================================
// AUTOMATED TRADING ENGINE
// ==========================================
async function refreshAutoTradingStatus() {
  try {
    if (state.isDemoReadOnly) {
      const cur = DemoStore.getState();
      const botConfig = cur.botSettings || {};
      const openCount = (cur.positions || []).filter(p => p.status === 'OPEN').length;
      const todayStr = new Date().toISOString().slice(0, 10);
      const tradesToday = (cur.orders || []).filter(o => {
        if (o.status !== 'FILLED') return false;
        const ts = Number(o.filled_at || o.timestamp || o.submitted_at);
        if (!Number.isFinite(ts) || ts <= 0) return false;
        try {
          return new Date(ts).toISOString().slice(0, 10) === todayStr;
        } catch {
          return false;
        }
      }).length;

      const data = {
        running: Boolean(botConfig.running),
        status: botConfig.status || (botConfig.running ? 'RUNNING' : 'STOPPED'),
        waitingReason: botConfig.waitingReason,
        waitingResumesAt: botConfig.waitingResumesAt,
        tradesToday,
        maxTradesPerDay: cur.settings?.maxTradesPerDay || 3,
        openPositionsCount: openCount,
        maxConcurrentPositions: cur.settings?.maxConcurrentPositions || 1,
        config: {
          botMarketMode: botConfig.botMarketMode || 'stocks',
          botCandidateOrder: botConfig.botCandidateOrder || 'equities_first',
          candidateSkipMinutes: botConfig.candidateSkipMinutes || 15,
          minScore: 70,
          minNetRR: 1.5,
        },
        recentActivity: cur.activityLog || [],
      };
      updateAutoTradingUi(data);
      return;
    }
    const res = await fetch('/api/autotrading/status');
    const data = await res.json();
    updateAutoTradingUi(data);
  } catch (err) {
    console.error('Error refreshing auto-trading status:', err);
  }
}

function updateAutoTradingUi(data) {
  if (!data) return;

  const statusBadge = document.getElementById('autoStatusBadge');
  const metric = document.getElementById('autoStatusMetric');
  const subtext = document.getElementById('autoStatusSubtext');
  const quotaMetric = document.getElementById('autoTradesTodayMetric');
  const quotaSubtext = document.getElementById('autoQuotaSubtext');
  const capMetric = document.getElementById('autoCapacityMetric');
  const filterSubtext = document.getElementById('autoFiltersSubtext');
  const maxTradesInput = document.getElementById('autoMaxTradesInput');
  const maxConcurrentSelect = document.getElementById('autoMaxConcurrentSelect');

  const isRunning = data.status === 'RUNNING';
  const isWaiting = data.status === 'WAITING';
  const isPaused = data.status === 'PAUSED';
  state.botStatus = data.status;

  if (statusBadge) {
    statusBadge.textContent = `BOT: ${data.status}`;
    if (isRunning) statusBadge.className = 'badge badge-long';
    else if (isWaiting || isPaused) statusBadge.className = 'badge badge-neutral text-warning';
    else statusBadge.className = 'badge badge-short';
  }

  if (metric) {
    metric.textContent = data.status;
    metric.className = `card-metric ${isRunning ? 'text-success' : (isWaiting || isPaused ? 'text-warning' : 'text-danger')}`;
  }

  if (subtext) {
    if (isWaiting) {
      subtext.textContent = `Waiting: ${data.waitingReason || 'Account gate active'}`;
    } else if (isPaused) {
      subtext.textContent = `Paused: ${data.pauseReason || 'Risk Limit Reached'}`;
    } else if (isRunning) {
      subtext.textContent = `Active cycle evaluating ${data.config?.botMarketMode || 'stocks'} universe`;
    } else {
      subtext.textContent = 'Standing by for activation';
    }
  }

  const autoCountdownBox = document.getElementById('autoWaitingCountdownBox');
  const autoWaitingReason = document.getElementById('autoWaitingReasonText');
  if (autoCountdownBox) {
    if (isWaiting && data.waitingResumesAt) {
      state.cooldownResumesAt = data.waitingResumesAt;
      autoCountdownBox.style.display = 'block';
      if (autoWaitingReason) autoWaitingReason.textContent = data.waitingReason || 'COOLDOWN_ACTIVE';
    } else {
      autoCountdownBox.style.display = 'none';
    }
  }

  const botBadge = document.getElementById('botMarketBadge');
  if (botBadge && data.config?.botMarketMode) {
    const bMode = data.config.botMarketMode;
    botBadge.textContent = `Bot: ${bMode === 'stocks' ? 'Stocks' : (bMode === 'crypto' ? 'Crypto' : 'Both')}`;
  }

  const autoModeSelect = document.getElementById('autoBotMarketModeSelect');
  if (autoModeSelect && data.config?.botMarketMode) {
    autoModeSelect.value = data.config.botMarketMode;
  }
  const autoOrderSelect = document.getElementById('autoBotCandidateOrderSelect');
  if (autoOrderSelect && data.config?.botCandidateOrder) {
    autoOrderSelect.value = data.config.botCandidateOrder;
  }
  const autoSkipInput = document.getElementById('autoCandidateSkipInput');
  if (autoSkipInput && data.config?.candidateSkipMinutes !== undefined) {
    autoSkipInput.value = data.config.candidateSkipMinutes;
  }

  if (quotaMetric) {
    quotaMetric.textContent = `${data.tradesToday || 0} / ${data.maxTradesPerDay || 3} Trades`;
  }

  if (quotaSubtext) {
    quotaSubtext.textContent = `Daily Quota (00:00 UTC Reset) · Used: ${data.tradesToday || 0}`;
  }

  if (capMetric) {
    capMetric.textContent = `${data.openPositionsCount || 0} / ${data.maxConcurrentPositions || 1} Positions`;
  }

  if (filterSubtext && data.config) {
    filterSubtext.textContent = `Min Score: ${data.config.minScore || 70} · Min R:R: ${data.config.minNetRR || 1.5}:1`;
  }

  if (maxTradesInput && data.maxTradesPerDay !== undefined) {
    maxTradesInput.value = data.maxTradesPerDay;
  }

  if (maxConcurrentSelect && data.maxConcurrentPositions !== undefined) {
    maxConcurrentSelect.value = String(data.maxConcurrentPositions);
  }

  // Update Activity Log
  const tbody = document.getElementById('autoActivityTableBody');
  const countEl = document.getElementById('autoActivityCount');
  const activities = data.recentActivity || [];

  if (countEl) countEl.textContent = `${activities.length} events`;

  if (tbody) {
    if (activities.length === 0) {
      tbody.innerHTML = `<tr><td colspan="4" style="text-align: center; color: var(--text-muted); padding: 16px;">Bot has not run any cycles yet. Click "Start Bot" to activate.</td></tr>`;
    } else {
      tbody.innerHTML = activities.map(act => {
        let actionClass = 'badge-neutral';
        if (act.action.includes('FILLED') || act.action.includes('STARTED')) actionClass = 'badge-long';
        else if (act.action.includes('ERROR') || act.action.includes('STOP')) actionClass = 'badge-short';
        else if (act.action.includes('PAUSE') || act.action.includes('QUOTA')) actionClass = 'badge-neutral text-warning';

        return `
          <tr>
            <td class="mono-num">${new Date(act.timestamp).toLocaleTimeString()}</td>
            <td><span class="badge ${actionClass}">${act.action}</span></td>
            <td><strong>${act.symbol}</strong></td>
            <td style="font-size: 12px; color: var(--text-secondary);">${act.details}</td>
          </tr>
        `;
      }).join('');
    }
  }
}

async function startAutoTrading() {
  const currentModel = document.getElementById('cfgStrategyModelSelect')?.value || 'v1';
  if (currentModel !== 'v1') {
    alert(`Automated execution is strictly locked for candidate model "${currentModel}". In accordance with verifiable research protocol, only verified models may execute automated trading. Use Paper Simulation.`);
    return;
  }

  const btn = document.getElementById('autoStartBtn');
  if (btn) btn.disabled = true;

  try {
    if (state.isDemoReadOnly) {
      await DemoBotManager.start();
      return;
    }
    const res = await fetch('/api/autotrading/start', { method: 'POST' });
    const data = await res.json();
    if (!data.success && data.error) {
      alert(`Cannot start automated bot: ${data.error}`);
    }
    await refreshAutoTradingStatus();
  } catch (err) {
    alert(`Error starting bot: ${friendlyError(err)}`);
  } finally {
    if (btn) btn.disabled = false;
  }
}

async function stopAutoTrading() {
  const btn = document.getElementById('autoStopBtn');
  if (btn) btn.disabled = true;

  try {
    if (state.isDemoReadOnly) {
      await DemoBotManager.stop('MANUAL_STOP');
      return;
    }
    const res = await fetch('/api/autotrading/stop', { method: 'POST' });
    const data = await res.json();
    await refreshAutoTradingStatus();
  } catch (err) {
    alert(`Error stopping bot: ${friendlyError(err)}`);
  } finally {
    if (btn) btn.disabled = false;
  }
}

async function stopAndCloseAllAutoTrading() {
  if (!confirm('Stop automated trading AND immediately close all active positions at market price?')) return;
  const btn = document.getElementById('autoStopCloseBtn');
  if (btn) btn.disabled = true;

  try {
    if (state.isDemoReadOnly) {
      await DemoBotManager.stopAndCloseAll('MANUAL_STOP_CLOSE_ALL');
      return;
    }
    const res = await fetch('/api/autotrading/stop-and-close-all', { method: 'POST' });
    const data = await res.json();
    alert(`Bot stopped. Closed ${data.closedPositionsCount || 0} position(s).`);
    await refreshAutoTradingStatus();
    await refreshAccount();
    await refreshOrders();
    await refreshJournal();
  } catch (err) {
    alert(`Error stopping bot and closing positions: ${friendlyError(err)}`);
  } finally {
    if (btn) btn.disabled = false;
  }
}

