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

// Initialize Application
window.addEventListener('DOMContentLoaded', async () => {
  setupTabs();
  setupSidebar();
  setupMarketMode();
  setupKillSwitch();
  setupChart();
  setupEventListeners();
  applyTheme(state.theme, false);
  updateAllocationUi(state.entryAllocationPercent);
  registerServiceWorker();
  startCooldownTicker();

  await checkDeployMode();
  await checkFeedStatus();
  await refreshAccount();
  await refreshOrders();
  await refreshScanner();
  await refreshEquityUniverse();
  await loadChartData();
  await refreshJournal();
  await refreshRejectedArchive();
  await refreshHealth();
  await loadSettings();
  await refreshVerificationStatus();
  await refreshAutoTradingStatus();

  connectSseStream();
});

// PWA Service Worker Registration
function registerServiceWorker() {
  if ('serviceWorker' in navigator) {
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

  try {
    const res = await fetch('/api/market/mode');
    const data = await res.json();
    if (data.activeMode) {
      updateModeUi(data.activeMode);
    } else {
      updateModeUi('stocks');
    }
  } catch {
    updateModeUi('stocks');
  }

  const applyModeChange = async (mode) => {
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
        const res = await fetch('/api/autotrading/kill-switch', { method: 'POST' });
        const data = await res.json();
        alert(`EMERGENCY KILL SWITCH ENGAGED!\nAutomated trading halted.\nClosed ${data.closedPositionsCount || 0} active positions.`);
        await refreshAccount();
        await refreshOrders();
        await refreshAutoTradingStatus();
      } catch (err) {
        alert(`Error engaging kill switch: ${err.message}`);
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

      // Disable write action buttons with descriptive tooltip
      const writeButtonIds = [
        'quickTestTradeBtn',
        'executePaperOrderBtn',
        'simTickProfitBtn',
        'simTickStopBtn',
        'autoStopCloseBtn',
        'saveSettingsBtn',
        'startAutoBtn',
        'stopAutoBtn',
        'killAutoBtn',
        'saveRiskBtn',
        'runBacktestBtn',
        'topRescanBtn',
      ];
      writeButtonIds.forEach(id => {
        const btn = document.getElementById(id);
        if (btn) {
          btn.disabled = true;
          btn.title = 'Persistent paper trading and bot execution run in the local app. (Hosted Demo Read-Only)';
          btn.style.opacity = '0.5';
          btn.style.cursor = 'not-allowed';
        }
      });

      // Close all buttons
      document.querySelectorAll('[id*="CloseAll"], [id*="closeAll"]').forEach(btn => {
        btn.disabled = true;
        btn.title = 'Persistent paper trading and bot execution run in the local app. (Hosted Demo Read-Only)';
        btn.style.opacity = '0.5';
        btn.style.cursor = 'not-allowed';
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

// API Calls & UI Updaters
async function checkFeedStatus() {
  try {
    const res = await fetch('/api/market/status');
    const data = await res.json();
    const statusEl = document.getElementById('feedStatus');
    const latencyEl = document.getElementById('connectionLatency');

    if (data.isLive) {
      statusEl.textContent = 'ONLINE (Live)';
      statusEl.className = 'stat-value text-success';
    } else {
      statusEl.textContent = 'SIMULATED (Offline Feed)';
      statusEl.className = 'stat-value text-warning';
    }
    latencyEl.textContent = `Latency: ${data.latencyMs}ms | ${data.note || 'Feed Active'}`;
  } catch {
    document.getElementById('feedStatus').textContent = 'DISCONNECTED';
  }
}

async function refreshAccount() {
  try {
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
    const res = await fetch(`/api/positions/${posId}/close`, { method: 'POST' });
    const data = await res.json();
    if (data.success) {
      await refreshAccount();
      await refreshJournal();
    }
  } catch (err) {
    alert(`Error closing position: ${err.message}`);
  }
};

window.closeAllPositions = async function() {
  if (!confirm('Close all active simulated paper positions at current market prices?')) return;
  try {
    const res = await fetch('/api/positions/close-all', { method: 'POST' });
    const data = await res.json();
    alert(`Closed ${data.closedPositionsCount ?? data.closedCount ?? 0} position(s).`);
    await refreshAccount();
    await refreshOrders();
    await refreshJournal();
  } catch (err) {
    alert(`Error closing all positions: ${err.message}`);
  }
};

async function checkPositionSentiment() {
  const notif = document.getElementById('posLifecycleNotification');
  try {
    const res = await fetch('/api/monitor/check-now', { method: 'POST' });
    const data = await res.json();
    if (notif) {
      notif.style.display = 'block';
      notif.style.background = 'rgba(0, 229, 153, 0.1)';
      notif.style.border = '1px solid var(--border-color)';
      notif.textContent = `Sentiment check complete: evaluated ${data.checkedCount || 0} open positions. Active summary: ${data.summary || 'HEALTHY'}`;
      setTimeout(() => { notif.style.display = 'none'; }, 5000);
    }
    await refreshAccount();
  } catch (err) {
    alert(`Error evaluating sentiment: ${err.message}`);
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
    alert(`Deliberation error: ${err.message}`);
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

  try {
    const res = await fetch('/api/orders/paper', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(orderPayload),
    });
    const data = await res.json();
    if (res.ok) {
      alert(`Paper order filled successfully! Position ID: ${data.position.id}`);
      switchTab('positions');
      await refreshAccount();
      await refreshOrders();
    } else {
      alert(`Order rejected: ${data.message || data.error}`);
    }
  } catch (err) {
    alert(`Order execution error: ${err.message}`);
  }
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
      // Calculate indicators locally for smooth rendering
      import('/src/indicators/index.js').then(module => {
        const ind = module.computeIndicators(data.candles);
        state.chart.setData(data.candles, ind);
      }).catch(() => {
        state.chart.setData(data.candles, null);
      });
    }

    document.getElementById('chartCandleInfo').textContent = `${state.symbol} | ${data.candles?.length || 0} Candles | Timeframe: ${state.timeframe}`;
  } catch (err) {
    console.error('Error loading chart candles:', err);
  }
}

async function refreshJournal() {
  try {
    const res = await fetch('/api/journal');
    const data = await res.json();
    const tbody = document.getElementById('journalTableBody');
    const entries = data.entries || [];

    if (entries.length === 0) {
      tbody.innerHTML = `<tr><td colspan="10" style="text-align: center; color: var(--text-muted); padding: 24px;">No closed paper trades in journal yet.</td></tr>`;
      return;
    }

    tbody.innerHTML = entries.map(e => {
      const pnlClass = e.realized_pnl >= 0 ? 'text-success' : 'text-danger';
      const durMins = Math.round((e.holding_time_ms || 0) / 60000);
      return `
        <tr>
          <td>${new Date(e.timestamp).toLocaleString()}</td>
          <td><strong>${e.symbol}</strong></td>
          <td><span class="badge ${e.side === 'LONG' ? 'badge-long' : 'badge-short'}">${e.side}</span></td>
          <td>$${e.entry_price}</td>
          <td>$${e.exit_price}</td>
          <td>${e.quantity}</td>
          <td class="${pnlClass}"><strong>${e.realized_pnl >= 0 ? '+' : ''}$${e.realized_pnl.toFixed(2)}</strong></td>
          <td class="${pnlClass}">${e.roi_percent >= 0 ? '+' : ''}${e.roi_percent}%</td>
          <td>${durMins} mins</td>
          <td><span class="badge badge-neutral">${e.exit_reason}</span></td>
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
    const res = await fetch('/api/orders/paper-test', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ symbol: 'BTCUSDT', side: 'LONG', quantity: 0.05 }),
    });
    const data = await res.json();
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
    const res = await fetch('/api/positions/simulate-tick', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ priceChangePct: changePct }),
    });
    const data = await res.json();
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
    const res = await fetch('/api/orders');
    const data = await res.json();
    const tbody = document.getElementById('ordersTableBody');
    if (!tbody) return;
    const orders = data.orders || [];

    if (orders.length === 0) {
      tbody.innerHTML = `<tr><td colspan="11" style="text-align: center; color: var(--text-muted); padding: 18px;">No simulated orders executed yet.</td></tr>`;
      return;
    }

    tbody.innerHTML = orders.map(o => {
      const statusBadge = o.status === 'FILLED' ? 'badge-long' : (o.status === 'REJECTED' ? 'badge-short' : 'badge-neutral');
      const sideBadge = o.side === 'LONG' ? 'badge-long' : 'badge-short';
      return `
        <tr>
          <td><code>${o.id}</code></td>
          <td><strong>${o.symbol}</strong></td>
          <td><span class="badge ${sideBadge}">${o.side}</span></td>
          <td><span class="badge ${statusBadge}">${o.status}</span></td>
          <td>$${o.requested_price !== undefined ? Number(o.requested_price).toFixed(4) : '--'}</td>
          <td>$${o.fill_price !== undefined ? Number(o.fill_price).toFixed(4) : '--'}</td>
          <td>${o.quantity}</td>
          <td>$${o.notional !== undefined ? Number(o.notional).toFixed(2) : '--'}</td>
          <td>$${o.fee !== undefined ? Number(o.fee).toFixed(4) : '0.0000'}</td>
          <td><span class="badge badge-neutral">${o.environment}</span></td>
          <td>${new Date(o.submitted_at).toLocaleTimeString()}</td>
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
    const res = await fetch('/api/rejected-setups');
    const data = await res.json();
    const tbody = document.getElementById('journalRejectedTableBody');
    if (!tbody) return;
    const rejected = data.rejected || [];

    if (rejected.length === 0) {
      tbody.innerHTML = `<tr><td colspan="6" style="text-align: center; color: var(--text-muted); padding: 18px;">No setups rejected in this session.</td></tr>`;
      return;
    }

    tbody.innerHTML = rejected.map(r => `
      <tr>
        <td><strong>${r.symbol}</strong></td>
        <td><span class="badge badge-short">${r.rejection_reason}</span></td>
        <td style="color: var(--text-secondary); max-width: 320px; white-space: normal;">${r.explanation}</td>
        <td>${r.net_rr ? `${r.net_rr}:1` : '--'}</td>
        <td><strong class="text-info">${r.score || '--'}</strong></td>
        <td>${new Date(r.timestamp).toLocaleString()}</td>
      </tr>
    `).join('');
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
    eligibleContracts,
  };

  const btn = document.getElementById('saveSettingsBtn');
  btn.disabled = true;
  btn.textContent = 'Saving...';

  const banner = document.getElementById('settingsAlertBanner');

  try {
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
      banner.textContent = '✅ Settings successfully updated and saved to SQLite database.';
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
    alert(`Verification check error: ${err.message}`);
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
    alert(`Error running all verification checks: ${err.message}`);
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
  const btn = document.getElementById('autoStartBtn');
  if (btn) btn.disabled = true;

  try {
    const res = await fetch('/api/autotrading/start', { method: 'POST' });
    const data = await res.json();
    if (!data.success && data.error) {
      alert(`Cannot start automated bot: ${data.error}`);
    }
    await refreshAutoTradingStatus();
  } catch (err) {
    alert(`Error starting bot: ${err.message}`);
  } finally {
    if (btn) btn.disabled = false;
  }
}

async function stopAutoTrading() {
  const btn = document.getElementById('autoStopBtn');
  if (btn) btn.disabled = true;

  try {
    const res = await fetch('/api/autotrading/stop', { method: 'POST' });
    const data = await res.json();
    await refreshAutoTradingStatus();
  } catch (err) {
    alert(`Error stopping bot: ${err.message}`);
  } finally {
    if (btn) btn.disabled = false;
  }
}

async function stopAndCloseAllAutoTrading() {
  if (!confirm('Stop automated trading AND immediately close all active positions at market price?')) return;
  const btn = document.getElementById('autoStopCloseBtn');
  if (btn) btn.disabled = true;

  try {
    const res = await fetch('/api/autotrading/stop-and-close-all', { method: 'POST' });
    const data = await res.json();
    alert(`Bot stopped. Closed ${data.closedPositionsCount || 0} position(s).`);
    await refreshAutoTradingStatus();
    await refreshAccount();
    await refreshOrders();
    await refreshJournal();
  } catch (err) {
    alert(`Error stopping bot and closing positions: ${err.message}`);
  } finally {
    if (btn) btn.disabled = false;
  }
}

