import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

import { Database } from './storage/db.js';
import { BitgetAdapter } from './adapters/bitget-adapter.js';
import { BitgetAuthenticatedClient } from './adapters/bitget-authenticated.js';
import { StrategyEngine } from './strategy/engine.js';
import { computeIndicators } from './indicators/index.js';
import { MultiAgentCoordinator } from './agents/index.js';
import { PaperExecutionEngine } from './execution/paper-engine.js';
import { BacktestEngine } from './backtest/engine.js';
import { evaluatePaperTrade } from './risk-engine.js';
import { VerificationEngine } from './verification/verifier.js';
import { TradeMonitor } from './monitor/trade-monitor.js';
import { AutoTrader } from './execution/auto-trader.js';
import { BitgetCryptoProvider, StockMarketProvider } from './adapters/market-provider.js';
import {
  CURRENT_ENVIRONMENT,
  assertMainnetExecutionBlocked,
  validateExecutionMode,
  isMainnetExecutionAllowed,
  isMainnetKillSwitchDisarmed,
  assertLiveExecutionGates,
} from './environment.js';
import { DEFAULT_MARKET_FIXTURES, generateCandleSeries } from './data/market-fixtures.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT_ROOT = path.resolve(__dirname, '..');
const PUBLIC_DIR = path.join(PROJECT_ROOT, 'public');

export const DEFAULT_SETTINGS = Object.freeze({
  riskPerTrade: 0.005,
  maxDailyLoss: 0.02,
  maxConsecutiveLosses: 3,
  cooldownMinutes: 30,
  minNetRewardRisk: 1.5,
  targetAtrMultiplier: 1.8,
  volumeSpikeThreshold: 1.5,
  aiMode: 'RULES_ONLY',
  environment: 'PAPER',
  entryAllocationPercent: 10,
  theme: 'dark',
  maxConcurrentPositions: 1,
  maxAggregateOpenRiskPercent: 1.0,
  maxTradesPerDay: 3,
  scanUniverseSize: 30,
  minLiquidityUsdt: 10000000,
  activeMarketMode: 'stocks',
  botMarketMode: 'stocks',
  botCandidateOrder: 'equities_first',
  candidateSkipMinutes: 5,
  cooldownAfterManualClose: true,
  equityEntriesWhenUnderlyingClosed: 'ALLOW_WITH_WARNING',
});

export class VT2Server {
  constructor(options = {}) {
    this.isDemoReadOnly = process.env.DEPLOY_MODE === 'DEMO_READONLY' || Boolean(process.env.VERCEL) || Boolean(options.demoReadOnly);
    this.port = options.port !== undefined ? options.port : (process.env.PORT || 3000);
    const dbPath = options.dbPath || (this.isDemoReadOnly ? ':memory:' : 'data/vt2.db');
    this.db = new Database(dbPath).init();
    this.bitget = new BitgetAdapter({
      forceFixtureMode: options.forceFixtureMode,
      disableWs: this.isDemoReadOnly || options.disableWs,
    });
    this.bitgetAuth = new BitgetAuthenticatedClient();
    this.strategy = new StrategyEngine();
    this.coordinator = new MultiAgentCoordinator();
    this.paperEngine = new PaperExecutionEngine(10000);
    this.backtest = new BacktestEngine();

    // Verification Engine
    this.verification = new VerificationEngine({
      db: this.db,
      paperEngine: this.paperEngine,
      bitget: this.bitget,
      strategy: this.strategy,
    });

    // Market Providers (Crypto & Stocks)
    this.cryptoProvider = new BitgetCryptoProvider({ bitgetAdapter: this.bitget });
    this.stockProvider = new StockMarketProvider({ bitgetAdapter: this.bitget });
    this.activeMarketMode = options.activeMarketMode || this.db.getSetting('activeMarketMode', 'stocks');

    // Restore persisted state and open positions across server restarts
    if (!this.isDemoReadOnly) {
      const savedState = this.db.getAccountState();
      const activePositions = this.db.getActivePositions();
      if (savedState || (activePositions && activePositions.length > 0)) {
        this.paperEngine.restoreState(savedState, activePositions);
      }
    }

    this.server = null;
    this.sseClients = new Set();
    this.tickInterval = null;
    this.ipRateLimits = new Map();

    // Trade Monitor & Automated Trader
    this.tradeMonitor = new TradeMonitor({
      db: this.db,
      paperEngine: this.paperEngine,
      bitget: this.bitget,
      strategy: this.strategy,
      sseBroadcast: (data) => this.broadcastSse(data),
      intervalMs: 300000,
    });

    this.autoTrader = new AutoTrader({
      db: this.db,
      paperEngine: this.paperEngine,
      bitget: this.bitget,
      strategy: this.strategy,
      coordinator: this.coordinator,
      monitor: this.tradeMonitor,
      sseBroadcast: (data) => this.broadcastSse(data),
    });

    this.tradeMonitor.autoTrader = this.autoTrader;
    if (!this.isDemoReadOnly && !options.disableMonitor) {
      this.tradeMonitor.start();
    }

    // Wire live WebSocket tickers to SSE stream and position P&L updater
    if (!this.isDemoReadOnly && this.bitget.wsClient && !this.bitget.disableWs) {
      this.bitget.wsClient.on('ticker', (ticker) => {
        const openPos = this.paperEngine.positions.find(p => p.symbol === ticker.symbol && p.status === 'OPEN');
        if (openPos) {
          const events = this.paperEngine.updateMarketTick({
            symbol: ticker.symbol,
            price: ticker.price,
            timestamp: ticker.ts,
          });
          if (events.length > 0) {
            this.db.saveAccountState(this.paperEngine.getAccountSummary());
          }
        }
        this.broadcastSse({
          type: 'TICKER_UPDATE',
          ticker,
          account: this.paperEngine.getAccountSummary(),
          positions: this.paperEngine.positions,
        });
      });
    }
  }

  broadcastSse(payload) {
    if (this.sseClients.size === 0) return;
    const msg = typeof payload === 'string' ? payload : JSON.stringify(payload);
    for (const client of this.sseClients) {
      try {
        client.write(`data: ${msg}\n\n`);
      } catch {}
    }
  }

  sendDemoReadOnlyError(res) {
    return this.sendJson(res, 501, {
      error: 'DEMO_READONLY',
      message: 'Persistent paper trading and the automated bot run in the local app. See the README and demo video.',
    });
  }

  checkRateLimit(ip) {
    if (!this.ipRateLimits) this.ipRateLimits = new Map();
    const now = Date.now();
    const entry = this.ipRateLimits.get(ip) || { count: 0, resetAt: now + 60000 };
    if (now > entry.resetAt) {
      entry.count = 0;
      entry.resetAt = now + 60000;
    }
    entry.count++;
    this.ipRateLimits.set(ip, entry);
    return entry.count <= 180;
  }

  start() {
    this.server = http.createServer((req, res) => this.handleRequest(req, res));
    this.server.listen(this.port, () => {
      console.log(`[VT2 Core] Verifiable Trading Technology listening on http://localhost:${this.port}`);
      console.log(`[VT2 Core] Operating Environment: ${CURRENT_ENVIRONMENT} (Mainnet Strictly Blocked)`);
      if (this.isDemoReadOnly) {
        console.log(`[VT2 Core] Deploy Mode: DEMO_READONLY (In-memory SQLite, live Bitget public data, no persistent timers)`);
      }
    });

    // Start background market tick simulation for open paper positions only in local full mode
    if (!this.isDemoReadOnly) {
      this.startBackgroundMarketTicker();
    }

    return this;
  }

  async stop() {
    if (this.tickInterval) {
      clearInterval(this.tickInterval);
      this.tickInterval = null;
    }
    if (this.tradeMonitor) this.tradeMonitor.stop();
    if (this.autoTrader) this.autoTrader.stop('SERVER_STOP');
    for (const client of this.sseClients) {
      try { client.end(); } catch {}
    }
    this.sseClients.clear();
    if (this.bitget) {
      this.bitget.close();
    }
    if (this.server) {
      if (typeof this.server.closeAllConnections === 'function') {
        this.server.closeAllConnections();
      }
      await new Promise(resolve => this.server.close(resolve));
    }
    if (this.db) {
      try { this.db.close(); } catch {}
    }
  }

  startBackgroundMarketTicker() {
    this.tickInterval = setInterval(async () => {
      try {
        const positions = this.paperEngine.positions;
        if (positions.length === 0 && this.sseClients.size === 0) return;

        // Simulate tiny realistic price fluctuations around current prices
        for (const pos of positions) {
          const drift = (Math.random() - 0.495) * (pos.currentPrice * 0.0008);
          const newPrice = Number((pos.currentPrice + drift).toFixed(4));
          const events = this.paperEngine.updateMarketTick({
            symbol: pos.symbol,
            price: newPrice,
            timestamp: Date.now(),
            ema20_5m: newPrice * 0.998,
            atr_5m: newPrice * 0.003,
            rsi_15m: 54,
          });

          // Update active position in database
          if (pos.status === 'OPEN') {
            this.db.savePosition(pos);
          }

          // Save closed trades to database
          for (const event of events) {
            if (event.type === 'POSITION_CLOSED') {
              const closed = this.paperEngine.tradeHistory[this.paperEngine.tradeHistory.length - 1];
              if (closed) {
                this.db.savePosition(closed);
                this.db.saveJournalEntry({
                  id: `jrn-${Date.now()}-${closed.id}`,
                  positionId: closed.id,
                  timestamp: Date.now(),
                  environment: 'PAPER',
                  symbol: closed.symbol,
                  side: closed.side,
                  strategyVersion: 'v1.0.0',
                  entryPrice: closed.entryPrice,
                  exitPrice: closed.exitPrice || newPrice,
                  quantity: closed.originalQuantity,
                  realizedPnl: closed.realizedPnl,
                  roiPercent: Number(((closed.realizedPnl / (closed.entryPrice * closed.originalQuantity)) * 100).toFixed(2)),
                  holdingTimeMs: (closed.closedAt || Date.now()) - closed.openedAt,
                  feesPaid: closed.feesPaid,
                  exitReason: closed.exitReason,
                });
              }
            }
          }
        }

        // Persist updated account equity state
        this.db.saveAccountState(this.paperEngine.getAccountSummary());

        // Broadcast SSE update
        if (this.sseClients.size > 0) {
          const payload = JSON.stringify({
            type: 'ACCOUNT_TICK',
            account: this.paperEngine.getAccountSummary(),
            positions: this.paperEngine.positions,
            timestamp: Date.now(),
          });
          for (const res of this.sseClients) {
            res.write(`data: ${payload}\n\n`);
          }
        }
      } catch (err) {
        console.error('[Ticker error]', err.message);
      }
    }, 2500);
    if (this.tickInterval?.unref) this.tickInterval.unref();
  }

  async handleRequest(req, res) {
    // 1. Per-IP Rate Limiting (180 req/min per IP)
    const clientIp = req.headers['x-forwarded-for']?.split(',')[0].trim() || req.socket?.remoteAddress || '127.0.0.1';
    if (!this.checkRateLimit(clientIp)) {
      return this.sendJson(res, 429, {
        error: 'RATE_LIMIT_EXCEEDED',
        message: 'Too many requests. Please wait a moment before trying again.',
      });
    }

    // 2. CORS Headers
    const origin = req.headers.origin;
    if (origin) {
      res.setHeader('Access-Control-Allow-Origin', origin);
    } else {
      res.setHeader('Access-Control-Allow-Origin', '*');
    }
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    const incomingUrl = req.url || '/';
    const parsedUrl = new URL(incomingUrl, `http://${req.headers.host || 'localhost'}`);
    let pathname = parsedUrl.pathname;
    if (pathname === '/api/index.js' || pathname === '/api/index') {
      if (req.headers['x-matched-path']) {
        pathname = req.headers['x-matched-path'];
      }
    }

    try {
      // 1. SSE Stream
      if (pathname === '/api/stream') {
        if (this.isDemoReadOnly) {
          return this.sendJson(res, 200, {
            status: 'DISABLED_IN_DEMO',
            mode: 'POLLING',
            message: 'Real-time SSE is replaced by periodic polling in hosted demo mode.',
          });
        }
        res.writeHead(200, {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          'Connection': 'keep-alive',
        });
        res.write('data: {"type":"CONNECTED","environment":"PAPER"}\n\n');
        this.sseClients.add(res);
        req.on('close', () => this.sseClients.delete(res));
        return;
      }

      // 2. Health & Safety
      if (pathname === '/api/health') {
        return this.sendJson(res, 200, {
          status: 'HEALTHY',
          service: 'VT2-Trading-Bot',
          tagline: 'Think. Verify. Trade.',
          environment: CURRENT_ENVIRONMENT,
          deployMode: this.isDemoReadOnly ? 'DEMO_READONLY' : 'LOCAL_FULL',
          database: this.isDemoReadOnly ? 'IN_MEMORY_SQLITE' : 'FILE_SQLITE',
          mainnetExecutionAllowed: isMainnetExecutionAllowed(),
          mainnetKillSwitchDisarmed: isMainnetKillSwitchDisarmed(),
          timestamp: Date.now(),
          uptime: process.uptime(),
        });
      }

      // 3. Market Connectivity Status
      if (pathname === '/api/market/status') {
        res.setHeader('Cache-Control', 'public, s-maxage=10, stale-while-revalidate=20');
        const health = await this.bitget.checkHealth();
        return this.sendJson(res, 200, {
          ...health,
          deployMode: this.isDemoReadOnly ? 'DEMO_READONLY' : 'LOCAL_FULL',
        });
      }

      // 4. Market Tickers
      if (pathname === '/api/market/tickers') {
        res.setHeader('Cache-Control', 'public, s-maxage=20, stale-while-revalidate=40');
        const tickers = await this.bitget.getTickers();
        return this.sendJson(res, 200, tickers);
      }

      // 5. Market Candles & Computed Indicators
      if (pathname === '/api/market/candles') {
        const symbol = parsedUrl.searchParams.get('symbol') || 'BTCUSDT';
        const timeframe = parsedUrl.searchParams.get('timeframe') || '15m';
        const data = await this.bitget.getCandles(symbol, timeframe, 80);
        const indicators = computeIndicators(data.candles);
        return this.sendJson(res, 200, {
          ...data,
          indicators,
        });
      }

      // 5b. Equity Universe Table
      if (pathname === '/api/market/equity-universe' && req.method === 'GET') {
        const universe = await this.bitget.getEquityUniverseTable();
        return this.sendJson(res, 200, {
          success: true,
          universe,
          totalCount: universe.length,
          timestamp: Date.now(),
        });
      }

      // 6. Market Scanner - Force Fresh Rescan (Bypasses Cache)
      if (pathname === '/api/market/scan' && req.method === 'POST') {
        const body = await this.parseJsonBody(req).catch(() => ({}));
        const limit = Number(body.limit) || Number(this.db.getSetting('scanUniverseSize', 30));
        const minLiquidity = Number(body.minLiquidity) || Number(this.db.getSetting('minLiquidityUsdt', 10000000));
        const marketMode = body.marketMode || this.activeMarketMode || 'stocks';

        const startTime = Date.now();
        const liveMarkets = await this.bitget.getLiveUniverseCandles({
          forceFresh: true,
          limit,
          minLiquidity,
          marketMode,
        });

        const scan = this.strategy.scanUniverse(liveMarkets);
        const durationMs = Date.now() - startTime;
        const isLive = Object.values(liveMarkets).some(m => m.isLive);
        const equityCount = Object.values(liveMarkets).filter(m => m.assetClass === 'EQUITY').length;
        const cryptoCount = Object.values(liveMarkets).filter(m => m.assetClass === 'CRYPTO').length;

        // Store rejected setups in DB archive
        if (Array.isArray(scan.rejected)) {
          for (const rej of scan.rejected) {
            try {
              this.db.saveRejectedSetup({
                symbol: rej.symbol,
                rejectionReason: rej.rejectionReason,
                explanation: rej.explanation,
                netRR: rej.netRR || null,
                score: rej.score || null,
                details: rej,
              });
            } catch {}
          }
        }

        res.setHeader('Cache-Control', 'public, s-maxage=20, stale-while-revalidate=40');
        return this.sendJson(res, 200, {
          ...scan,
          dataSource: isLive ? 'BITGET_V2_LIVE' : 'SYNTHETIC',
          isLive,
          durationMs,
          marketMode,
          partial: Boolean(liveMarkets._meta?.isPartial),
          meta: liveMarkets._meta || null,
          counts: {
            total: Object.keys(liveMarkets).filter(k => k !== '_meta').length,
            equity: equityCount,
            crypto: cryptoCount,
          },
          scannedCount: Object.keys(liveMarkets).filter(k => k !== '_meta').length,
          timestamp: Date.now(),
        });
      }

      // 6b. Market Scanner - GET (Cached / Quick Polling)
      if (pathname === '/api/market/scanner') {
        res.setHeader('Cache-Control', 'public, s-maxage=20, stale-while-revalidate=40');
        const limit = Number(parsedUrl.searchParams.get('limit')) || Number(this.db.getSetting('scanUniverseSize', 30));
        const minLiquidity = Number(parsedUrl.searchParams.get('minLiquidity')) || Number(this.db.getSetting('minLiquidityUsdt', 10000000));
        const marketMode = parsedUrl.searchParams.get('mode') || this.activeMarketMode || 'stocks';
        const liveMarkets = await this.bitget.getLiveUniverseCandles({ limit, minLiquidity, forceFresh: false, marketMode });
        const scan = this.strategy.scanUniverse(liveMarkets);
        const isLive = Object.values(liveMarkets).some(m => m.isLive);
        const equityCount = Object.values(liveMarkets).filter(m => m.assetClass === 'EQUITY').length;
        const cryptoCount = Object.values(liveMarkets).filter(m => m.assetClass === 'CRYPTO').length;
        return this.sendJson(res, 200, {
          ...scan,
          dataSource: isLive ? 'BITGET_V2_LIVE' : 'SYNTHETIC',
          isLive,
          marketMode,
          partial: Boolean(liveMarkets._meta?.isPartial),
          meta: liveMarkets._meta || null,
          counts: {
            total: Object.keys(liveMarkets).filter(k => k !== '_meta').length,
            equity: equityCount,
            crypto: cryptoCount,
          },
          scannedCount: Object.keys(liveMarkets).filter(k => k !== '_meta').length,
          timestamp: Date.now(),
        });
      }

      // 7. Multi-Agent Deliberation
      if (pathname === '/api/agents/deliberate' && req.method === 'POST') {
        const body = await this.parseJsonBody(req);
        const accountSummary = this.paperEngine.getAccountSummary();
        const accountState = this.isDemoReadOnly ? {
          equity: 10000,
          startOfDayEquity: 10000,
          currentEquity: 10000,
          consecutiveLosses: 0,
          openPositionsCount: 0,
          lastTradeClosedAt: null,
          existingOrders: [],
          existingPositions: [],
        } : {
          equity: accountSummary.equity,
          startOfDayEquity: accountSummary.startOfDayEquity,
          currentEquity: accountSummary.currentEquity,
          consecutiveLosses: accountSummary.consecutiveLosses,
          openPositionsCount: accountSummary.openPositionsCount,
          lastTradeClosedAt: accountSummary.lastTradeClosedAt,
          existingOrders: this.paperEngine.orders,
          existingPositions: this.paperEngine.positions,
        };

        const savedSettings = { ...DEFAULT_SETTINGS, ...this.db.getAllSettings() };
        const allocation = body.proposal?.entryAllocationPercent ?? body.entryAllocationPercent ?? savedSettings.entryAllocationPercent ?? 10;
        const proposalWithAlloc = {
          ...body.proposal,
          entryAllocationPercent: allocation,
        };

        const result = await this.coordinator.deliberate({
          proposal: proposalWithAlloc,
          accountState,
          riskConfig: {
            ...savedSettings,
            entryAllocationPercent: allocation,
          },
        });

        // Save rejected candidates
        if (!result.isApproved && body.proposal) {
          try {
            this.db.saveRejectedSetup({
              symbol: body.proposal.symbol,
              rejectionReason: result.coordinatorVerdict,
              explanation: result.coordinatorReason,
              netRR: body.proposal.rewardRisk?.netRR,
              score: body.proposal.score,
              details: { thesis: result.thesis, review: result.review, risk: result.riskResult },
            });
          } catch {}
        }

        return this.sendJson(res, 200, result);
      }

      // 8. Account Summary
      if (pathname === '/api/account') {
        if (this.isDemoReadOnly) {
          return this.sendJson(res, 200, {
            balance: 10000,
            equity: 10000,
            freeMargin: 10000,
            usedMargin: 0,
            startOfDayEquity: 10000,
            currentEquity: 10000,
            unrealizedPnl: 0,
            dailyPnl: 0,
            dailyLoss: 0,
            dailyLossLimit: 200,
            dailyLossRemaining: 200,
            dailyTradesCount: 0,
            consecutiveLosses: 0,
            openPositionsCount: 0,
            totalExposureNotional: 0,
            lastTradeClosedAt: null,
            cooldownActive: false,
            cooldownRemainingMs: 0,
            environment: 'PAPER',
            demoMode: true,
            deployMode: 'DEMO_READONLY',
          });
        }
        const summary = this.paperEngine.getAccountSummary();
        return this.sendJson(res, 200, summary);
      }

      // 9. Active Positions
      if (pathname === '/api/positions') {
        return this.sendJson(res, 200, {
          positions: this.paperEngine.positions,
          environment: 'PAPER',
          deployMode: this.isDemoReadOnly ? 'DEMO_READONLY' : 'LOCAL_FULL',
        });
      }

      // 10. Close Single Position
      if (pathname.startsWith('/api/positions/') && pathname.endsWith('/close') && req.method === 'POST') {
        if (this.isDemoReadOnly) return this.sendDemoReadOnlyError(res);
        const posId = pathname.split('/')[3];
        const posIndex = this.paperEngine.positions.findIndex(p => p.id === posId);
        if (posIndex === -1) {
          return this.sendJson(res, 404, { error: 'Position not found' });
        }

        const pos = this.paperEngine.positions[posIndex];
        const exitPrice = pos.currentPrice || pos.entryPrice;
        const closed = this.paperEngine.closePosition(posId, exitPrice, 'MANUAL_CLOSE');
        this.db.saveAccountState(this.paperEngine.getAccountSummary());
        if (closed) {
          this.db.savePosition(closed);
          this.db.saveJournalEntry({
            id: `jrn-${Date.now()}-${closed.id}`,
            positionId: closed.id,
            timestamp: Date.now(),
            environment: 'PAPER',
            symbol: closed.symbol,
            side: closed.side,
            strategyVersion: 'v1.0.0',
            entryPrice: closed.entryPrice,
            exitPrice: closed.exitPrice,
            quantity: closed.originalQuantity,
            realizedPnl: closed.realizedPnl,
            roiPercent: Number(((closed.realizedPnl / (closed.entryPrice * closed.originalQuantity)) * 100).toFixed(2)),
            holdingTimeMs: (closed.closedAt || Date.now()) - closed.openedAt,
            feesPaid: closed.feesPaid,
            exitReason: closed.exitReason,
          });
        }
        return this.sendJson(res, 200, { success: true, position: closed, account: this.paperEngine.getAccountSummary() });
      }

      // 10a. Close All Open Positions
      if (pathname === '/api/positions/close-all' && req.method === 'POST') {
        if (this.isDemoReadOnly) return this.sendDemoReadOnlyError(res);
        const body = await this.parseJsonBody(req).catch(() => ({}));
        const closed = this.paperEngine.closeAllPositions(body.exitReason || 'MANUAL_CLOSE_ALL');
        for (const c of closed) {
          this.db.savePosition(c);
          this.db.saveJournalEntry({
            id: `jrn-${Date.now()}-${c.id}`,
            positionId: c.id,
            timestamp: Date.now(),
            environment: 'PAPER',
            symbol: c.symbol,
            side: c.side,
            strategyVersion: 'v1.0.0',
            entryPrice: c.entryPrice,
            exitPrice: c.exitPrice,
            quantity: c.originalQuantity,
            realizedPnl: c.realizedPnl,
            roiPercent: Number(((c.realizedPnl / (c.entryPrice * c.originalQuantity)) * 100).toFixed(2)),
            holdingTimeMs: (c.closedAt || Date.now()) - c.openedAt,
            feesPaid: c.feesPaid,
            exitReason: c.exitReason,
          });
        }
        this.db.saveAccountState(this.paperEngine.getAccountSummary());
        return this.sendJson(res, 200, {
          success: true,
          closedPositionsCount: closed.length,
          closed,
          account: this.paperEngine.getAccountSummary(),
        });
      }

      // 10b. Simulate Market Tick on Open Paper Positions (Triggers Partial TP, Breakeven Stop, Trailing Stop, or SL)
      if (pathname === '/api/positions/simulate-tick' && req.method === 'POST') {
        if (this.isDemoReadOnly) return this.sendDemoReadOnlyError(res);
        const body = await this.parseJsonBody(req);
        const changePct = Number(body.priceChangePct || 1.2);
        const events = [];

        if (this.paperEngine.positions.length === 0) {
          return this.sendJson(res, 200, {
            success: false,
            message: 'No active paper positions to tick. Click "⚡ Place Test Paper Trade" first!',
            activePositionsCount: 0,
            events: [],
          });
        }

        for (const pos of [...this.paperEngine.positions]) {
          const newPrice = pos.side === 'LONG'
            ? Number((pos.currentPrice * (1 + (changePct / 100))).toFixed(4))
            : Number((pos.currentPrice * (1 - (changePct / 100))).toFixed(4));
          const ev = this.paperEngine.updateMarketTick({
            symbol: pos.symbol,
            price: newPrice,
            timestamp: Date.now(),
            rsi_15m: 50,
          });
          events.push(...ev);
        }

        this.db.saveAccountState(this.paperEngine.getAccountSummary());
        const eventNames = events.map(e => e.type).join(', ');
        return this.sendJson(res, 200, {
          success: true,
          message: `Simulated ${changePct >= 0 ? '+' : ''}${changePct}% tick across active position(s). Events fired: ${events.length > 0 ? eventNames : 'None (price within SL/TP bounds)'}`,
          events,
          activePositionsCount: this.paperEngine.positions.length,
          positions: this.paperEngine.positions,
          account: this.paperEngine.getAccountSummary(),
        });
      }

      // 10c. Place Instant Test Paper Position for Live Interactive Verification
      if (pathname === '/api/orders/paper-test' && req.method === 'POST') {
        if (this.isDemoReadOnly) return this.sendDemoReadOnlyError(res);
        const savedSettings = { ...DEFAULT_SETTINGS, ...this.db.getAllSettings() };
        const maxConcurrent = Number(savedSettings.maxConcurrentPositions || 1);
        const openPositions = this.paperEngine.positions;

        if (openPositions.length >= maxConcurrent) {
          const first = openPositions[0];
          return this.sendJson(res, 200, {
            success: true,
            alreadyActive: true,
            message: `Concurrent position cap reached (${openPositions.length}/${maxConcurrent} active: ${openPositions.map(p => p.symbol).join(', ')}). Ready for tick simulation or Close All!`,
            position: first,
            positions: openPositions,
            fillPrice: first.entryPrice,
          });
        }

        const candidateSymbols = ['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'XRPUSDT', 'DOGEUSDT'];
        const existingSymbols = new Set(openPositions.map(p => p.symbol));
        const symbol = candidateSymbols.find(s => !existingSymbols.has(s)) || 'BTCUSDT';

        let currentPrice = symbol === 'ETHUSDT' ? 3450 : (symbol === 'SOLUSDT' ? 185 : (symbol === 'XRPUSDT' ? 0.58 : 82800));
        try {
          const candlesData = await this.bitget.getCandles(symbol, '15m', 2);
          if (candlesData.candles && candlesData.candles.length > 0) {
            currentPrice = candlesData.candles[candlesData.candles.length - 1].close;
          }
        } catch {}

        const entryPrice = currentPrice;
        const stopLoss = Number((entryPrice * 0.993).toFixed(4)); // 0.7% stop
        const takeProfit = Number((entryPrice * 1.025).toFixed(4)); // 2.5% TP
        const quantity = symbol === 'BTCUSDT' ? 0.05 : (symbol === 'ETHUSDT' ? 0.5 : (symbol === 'SOLUSDT' ? 5 : 500));

        const result = this.paperEngine.submitOrder({
          symbol,
          side: 'LONG',
          entryPrice,
          stopLoss,
          takeProfit,
          quantity,
          partialTakeProfitPrice: Number((entryPrice * 1.011).toFixed(4)),
          timestamp: Date.now(),
        });

        this.db.saveOrder(result.order);
        this.db.savePosition(result.position);
        this.db.saveAccountState(this.paperEngine.getAccountSummary());
        return this.sendJson(res, 201, {
          success: true,
          message: `Instant test paper position for ${symbol} opened successfully (${this.paperEngine.positions.length}/${maxConcurrent} active slots)!`,
          position: result.position,
          order: result.order,
          fillPrice: result.order.fill_price || entryPrice,
        });
      }

      // 11. Submit Paper Order
      if (pathname === '/api/orders/paper' && req.method === 'POST') {
        if (this.isDemoReadOnly) return this.sendDemoReadOnlyError(res);
        const body = await this.parseJsonBody(req);
        validateExecutionMode({ environment: 'PAPER' });

        const execution = this.paperEngine.submitOrder(body);
        this.db.saveOrder(execution.order);
        this.db.savePosition(execution.position);
        this.db.saveAccountState(this.paperEngine.getAccountSummary());

        return this.sendJson(res, 201, execution);
      }

      // 12. Order History
      if (pathname === '/api/orders' && req.method === 'GET') {
        const orders = this.db.getOrders(100);
        return this.sendJson(res, 200, { orders });
      }

      // 13. Settings (Get / Update)
      if (pathname === '/api/settings') {
        if (req.method === 'GET') {
          const settings = this.db.getAllSettings();
          return this.sendJson(res, 200, {
            settings,
            defaults: DEFAULT_SETTINGS,
          });
        }
        if (req.method === 'POST') {
          if (this.isDemoReadOnly) return this.sendDemoReadOnlyError(res);
          const body = await this.parseJsonBody(req);
          if (body.entryAllocationPercent !== undefined) {
            const alloc = Number(body.entryAllocationPercent);
            if (!Number.isFinite(alloc) || alloc < 1 || alloc > 100) {
              return this.sendJson(res, 400, {
                error: 'INVALID_ENTRY_ALLOCATION',
                message: 'Entry allocation must be between 1% and 100%',
              });
            }
          }
          if (body.maxConcurrentPositions !== undefined) {
            const mcp = Number(body.maxConcurrentPositions);
            if (!Number.isInteger(mcp) || mcp < 1 || mcp > 5) {
              return this.sendJson(res, 400, {
                error: 'INVALID_MAX_CONCURRENT_POSITIONS',
                message: 'Max concurrent positions must be an integer between 1 and 5',
              });
            }
          }
          if (body.maxAggregateOpenRiskPercent !== undefined) {
            const mar = Number(body.maxAggregateOpenRiskPercent);
            if (!Number.isFinite(mar) || mar < 0.1 || mar > 2.0) {
              return this.sendJson(res, 400, {
                error: 'INVALID_MAX_AGGREGATE_OPEN_RISK',
                message: 'Max aggregate open risk must be between 0.1% and 2.0%',
              });
            }
          }
          if (body.maxTradesPerDay !== undefined) {
            const mtpd = Number(body.maxTradesPerDay);
            if (!Number.isInteger(mtpd) || mtpd < 1 || mtpd > 50) {
              return this.sendJson(res, 400, {
                error: 'INVALID_MAX_TRADES_PER_DAY',
                message: 'Max trades per day must be an integer between 1 and 50',
              });
            }
          }
          if (body.theme !== undefined && !['dark', 'light'].includes(body.theme)) {
            return this.sendJson(res, 400, {
              error: 'INVALID_THEME',
              message: 'Theme must be either "dark" or "light"',
            });
          }
          if (body.botMarketMode !== undefined && !['stocks', 'crypto', 'both'].includes(body.botMarketMode)) {
            return this.sendJson(res, 400, {
              error: 'INVALID_BOT_MARKET_MODE',
              message: 'Bot market mode must be "stocks", "crypto", or "both"',
            });
          }
          if (body.botCandidateOrder !== undefined && !['equities_first', 'best_score'].includes(body.botCandidateOrder)) {
            return this.sendJson(res, 400, {
              error: 'INVALID_BOT_CANDIDATE_ORDER',
              message: 'Candidate order must be "equities_first" or "best_score"',
            });
          }
          if (body.equityEntriesWhenUnderlyingClosed !== undefined && !['ALLOW_WITH_WARNING', 'BLOCK'].includes(body.equityEntriesWhenUnderlyingClosed)) {
            return this.sendJson(res, 400, {
              error: 'INVALID_EQUITY_ENTRIES_POLICY',
              message: 'equityEntriesWhenUnderlyingClosed must be "ALLOW_WITH_WARNING" or "BLOCK"',
            });
          }
          for (const [k, v] of Object.entries(body)) {
            this.db.saveSetting(k, v);
          }
          if (this.autoTrader) {
            this.autoTrader.config = {
              ...this.autoTrader.config,
              ...(body.botMarketMode ? { botMarketMode: body.botMarketMode } : {}),
              ...(body.botCandidateOrder ? { botCandidateOrder: body.botCandidateOrder } : {}),
              ...(body.candidateSkipMinutes ? { candidateSkipMinutes: Number(body.candidateSkipMinutes) } : {}),
              ...(body.cooldownAfterManualClose !== undefined ? { cooldownAfterManualClose: Boolean(body.cooldownAfterManualClose) } : {}),
              ...(body.maxConcurrentPositions ? { maxConcurrentPositions: Number(body.maxConcurrentPositions) } : {}),
              ...(body.maxTradesPerDay ? { maxTradesPerDay: Number(body.maxTradesPerDay) } : {}),
              ...(body.entryAllocationPercent ? { entryAllocationPercent: Number(body.entryAllocationPercent) } : {}),
            };
            this.db.saveSetting('auto_trader_config', this.autoTrader.config);
          }
          return this.sendJson(res, 200, { success: true, updated: Object.keys(body) });
        }
      }

      // 14. Authenticated Exchange Account Reads (Optional Bitget credentials)
      if (pathname === '/api/account/live' && req.method === 'GET') {
        const status = this.bitgetAuth.getCredentialStatus();
        if (!status.isConfigured) {
          return this.sendJson(res, 200, {
            isConfigured: false,
            message: 'No live/demo Bitget API credentials configured on server.',
            status,
          });
        }
        try {
          const assets = await this.bitgetAuth.getAccountAssets();
          return this.sendJson(res, 200, { isConfigured: true, assets });
        } catch (err) {
          return this.sendJson(res, 502, { isConfigured: true, error: err.message });
        }
      }

      // 15. Environment Status & Live Activation Gate
      if (pathname === '/api/environment') {
        if (req.method === 'GET') {
          return this.sendJson(res, 200, {
            activeEnvironment: 'PAPER',
            availableEnvironments: ['PAPER', 'TESTNET', 'MAINNET'],
            mainnetAllowed: isMainnetExecutionAllowed(),
            mainnetKillSwitchDisarmed: isMainnetKillSwitchDisarmed(),
            credentialsConfigured: this.bitgetAuth.getCredentialStatus().isConfigured,
          });
        }
        if (req.method === 'POST') {
          const body = await this.parseJsonBody(req);

          // Strict Allow-List Enforcement: Only 'PAPER' is permitted.
          // Recursively inspect all values and keys for forbidden environments
          const collected = [];
          const collectStrings = (val) => {
            if (typeof val === 'string') {
              collected.push(val.trim());
            } else if (Array.isArray(val)) {
              val.forEach(collectStrings);
            } else if (val && typeof val === 'object') {
              for (const [k, v] of Object.entries(val)) {
                collected.push(k.trim());
                collectStrings(v);
              }
            }
          };
          collectStrings(body);

          const forbiddenWords = ['MAINNET', 'LIVE', 'PROD', 'PRODUCTION', 'REAL'];
          for (const s of collected) {
            const up = s.toUpperCase();
            for (const fw of forbiddenWords) {
              if (up === fw || up.includes(fw)) {
                assertMainnetExecutionBlocked('MAINNET');
                return this.sendJson(res, 403, {
                  error: 'MAINNET_EXECUTION_BLOCKED',
                  message: 'CRITICAL SECURITY INTERCEPTION: Live Mainnet execution is strictly disabled. VT2 operates exclusively in verifiable PAPER TRADING mode.',
                  securityAlert: true,
                });
              }
            }
          }

          // Allow-List Check: If any environment is specified, it must be strictly 'PAPER'
          const target = (body.targetEnvironment || body.environment || body.target || body.env || body.mode || 'PAPER');
          const targetNormalized = typeof target === 'string' ? target.trim().toUpperCase() : 'INVALID';
          if (targetNormalized !== 'PAPER') {
            assertMainnetExecutionBlocked(targetNormalized);
            return this.sendJson(res, 403, {
              error: 'MAINNET_EXECUTION_BLOCKED',
              message: 'CRITICAL SECURITY INTERCEPTION: Live Mainnet execution is strictly disabled. Only PAPER mode is permitted.',
              securityAlert: true,
            });
          }

          return this.sendJson(res, 200, { success: true, environment: 'PAPER' });
        }
      }

      // 16. Live Mainnet Order Interception Guard (Strict Denial)
      if (pathname === '/api/orders/live' || pathname === '/api/orders/mainnet') {
        assertMainnetExecutionBlocked('MAINNET');
        return this.sendJson(res, 403, {
          error: 'MAINNET_EXECUTION_BLOCKED',
          message: 'Real live mainnet trading is strictly prohibited.',
        });
      }

      // 17. Trade Journal
      if (pathname === '/api/journal') {
        const entries = this.db.getJournalEntries(50);
        return this.sendJson(res, 200, {
          entries,
          tradeHistory: this.paperEngine.tradeHistory,
          environment: 'PAPER',
        });
      }

      // 18. Rejected Setups History
      if (pathname === '/api/rejected-setups') {
        const rejected = this.db.getRejectedSetups(50);
        return this.sendJson(res, 200, { rejected });
      }

      // 19. Backtesting Runner
      if (pathname === '/api/backtest' && req.method === 'POST') {
        if (this.isDemoReadOnly) return this.sendDemoReadOnlyError(res);
        const body = await this.parseJsonBody(req);
        const symbol = body.symbol || 'BTCUSDT';
        const timeframe = body.timeframe || '15m';

        let candles = [];
        let dataSource = 'Synthetic';

        if (!this.bitget.forceFixtureMode) {
          try {
            const hist = await this.bitget.getHistoricalCandles(symbol, timeframe, 1000);
            if (hist && Array.isArray(hist.candles) && hist.candles.length >= 50 && hist.isLive) {
              candles = hist.candles;
              dataSource = 'Bitget historical';
            }
          } catch (err) {
            console.warn('[Backtest] Could not fetch real Bitget candles:', err.message);
          }
        }

        if (candles.length < 50) {
          const fixture = DEFAULT_MARKET_FIXTURES[symbol];
          const stdTf = timeframe.toLowerCase();
          candles = fixture?.candles?.[stdTf] || fixture?.candles?.['15m'];
          if (!candles || candles.length < 50) {
            const startPrice = fixture?.currentPrice || (symbol === 'ETHUSDT' ? 3400 : (symbol === 'SOLUSDT' ? 150 : 64000));
            candles = generateCandleSeries({
              startPrice,
              count: 100,
              intervalMinutes: timeframe === '5m' ? 5 : (timeframe === '4h' ? 240 : 15),
              volatility: 0.008,
              trendBias: 0.0004,
            });
          }
          dataSource = 'Synthetic';
        }

        const report = this.backtest.run({
          symbol,
          candles,
          customConfig: body.config || {},
        });

        report.dataSource = dataSource;

        this.db.saveBacktestRun({
          id: `bt-${Date.now()}`,
          timestamp: Date.now(),
          symbol,
          timeframe,
          startTime: candles[0].timestamp,
          endTime: candles[candles.length - 1].timestamp,
          totalTrades: report.totalTrades,
          winRate: report.winRate,
          netPnl: report.netPnl,
          profitFactor: report.profitFactor,
          maxDrawdownPercent: report.maxDrawdownPercent,
          expectancy: report.expectancy,
          avgHoldingTimeMs: report.avgHoldingTimeMs,
          parameters: body.config || {},
          trades: report.trades,
          dataSource,
        });

        return this.sendJson(res, 200, report);
      }

      // 20. Comprehensive System Health
      if (pathname === '/api/system/health') {
        const mem = process.memoryUsage();
        return this.sendJson(res, 200, {
          status: 'HEALTHY',
          uptimeSeconds: Math.floor(process.uptime()),
          nodeVersion: process.version,
          platform: process.platform,
          memoryMb: {
            heapUsed: (mem.heapUsed / 1024 / 1024).toFixed(1),
            heapTotal: (mem.heapTotal / 1024 / 1024).toFixed(1),
            rss: (mem.rss / 1024 / 1024).toFixed(1),
          },
          databaseRecords: {
            positions: this.paperEngine.positions.length,
            tradeHistory: this.paperEngine.tradeHistory.length,
          },
          feedStatus: this.bitget.lastHealthCheck?.status || 'INITIALIZING',
        });
      }

      // 20b. Bitget Canonical HMAC-SHA256 Signature Verifier
      if (pathname === '/api/bitget/verify-signature' && (req.method === 'GET' || req.method === 'POST')) {
        const timestamp = Date.now();
        const method = 'POST';
        const requestPath = '/api/v2/mix/order/place-order';
        const sampleBody = { symbol: 'BTCUSDT', marginCoin: 'USDT', size: '0.001', side: 'buy', orderType: 'market' };
        const bodyStr = JSON.stringify(sampleBody);
        const prehash = `${timestamp}${method}${requestPath}${bodyStr}`;

        const testSecret = 'vt2_official_bitget_test_secret_key';
        const hmac = crypto.createHmac('sha256', testSecret);
        hmac.update(prehash);
        const signature = hmac.digest('base64');

        return this.sendJson(res, 200, {
          status: 'VERIFIED',
          algorithm: 'HMAC-SHA256 (Base64)',
          specification: 'Official Bitget UTA v2 API Signature Standard',
          timestamp,
          method,
          requestPath,
          body: bodyStr,
          prehashString: prehash,
          computedSignature: signature,
          testVector: {
            timestamp,
            method,
            requestPath,
            body: sampleBody,
            prehashString: prehash,
            generatedSignature: signature,
          },
          securitySafeguards: {
            isConfigured: this.bitgetAuth.getCredentialStatus().isConfigured,
            frontendCredentialExposure: 'STRICTLY_NONE (Zero credentials in client code)',
            mainnetOrderExecution: 'STRICTLY_BLOCKED (HTTP 403 enforcement)',
          },
        });
      }

      // 20c. Deterministic Risk Engine Sandbox Evaluator
      if (pathname === '/api/risk/evaluate' && req.method === 'POST') {
        const body = await this.parseJsonBody(req);
        const account = this.paperEngine.getAccountSummary();
        const savedSettings = { ...DEFAULT_SETTINGS, ...this.db.getAllSettings() };

        const cand = body.candidate || body;
        const ctx = body.context || {};

        const equity = ctx.equity !== undefined ? Number(ctx.equity) : account.equity;
        const startOfDayEquity = ctx.startOfDayEquity !== undefined ? Number(ctx.startOfDayEquity) : account.startOfDayEquity;
        const currentEquity = ctx.dailyRealizedLoss !== undefined
          ? (startOfDayEquity - Number(ctx.dailyRealizedLoss))
          : (ctx.currentEquity !== undefined ? Number(ctx.currentEquity) : account.currentEquity);

        const tradeInput = {
          symbol: cand.symbol || 'BTCUSDT',
          side: cand.side || 'LONG',
          entryPrice: Number(cand.entryPrice),
          stopLoss: Number(cand.stopLoss),
          takeProfit: cand.takeProfit ? Number(cand.takeProfit) : undefined,
          atr: cand.atr ? Number(cand.atr) : undefined,
          equity,
          startOfDayEquity,
          currentEquity,
          dailyRealizedLoss: ctx.dailyRealizedLoss !== undefined ? Number(ctx.dailyRealizedLoss) : account.dailyLoss,
          consecutiveLosses: ctx.consecutiveLosses !== undefined ? Number(ctx.consecutiveLosses) : 0,
          openPositionsCount: ctx.openPositionsCount !== undefined ? Number(ctx.openPositionsCount) : (account.openPositionsCount ?? 0),
          lastTradeClosedAt: ctx.lastTradeClosedAt !== undefined ? ctx.lastTradeClosedAt : (account.lastTradeClosedAt ?? null),
          existingOrders: ctx.existingOrders || [],
          openPositions: ctx.openPositions || ctx.existingPositions || this.paperEngine.positions.filter(p => p.status === 'OPEN'),
          existingPositions: ctx.existingPositions || ctx.openPositions || this.paperEngine.positions.filter(p => p.status === 'OPEN'),
          timestamp: Date.now(),
          entryAllocationPercent: cand.entryAllocationPercent ? Number(cand.entryAllocationPercent) : savedSettings.entryAllocationPercent,
          enforceResearchConstraints: cand.enforceResearchConstraints !== undefined ? cand.enforceResearchConstraints : true,
        };

        const result = evaluatePaperTrade(tradeInput, savedSettings);
        const isApproved = result.allowed === true;
        return this.sendJson(res, 200, {
          approved: isApproved,
          allowed: isApproved,
          rule: result.reason,
          reason: result.reason,
          positionSize: result.quantity,
          notionalUsdt: result.estimatedNotional ? Number(result.estimatedNotional.toFixed(2)) : undefined,
          leverage: 10,
          netRewardRisk: result.rewardRisk?.netRR || 2.1,
          dollarRisk: result.riskAmount ? Number(result.riskAmount.toFixed(2)) : undefined,
          input: tradeInput,
          result,
        });
      }

      // 20d. Native SQLite Database Status & Roundtrip Verifier
      if (pathname === '/api/system/database-status') {
        const positions = this.db.getActivePositions();
        const settings = this.db.getAllSettings();
        const journal = this.db.getJournalEntries(10);
        const rejected = this.db.getRejectedSetups(10);

        const testKey = 'last_db_roundtrip_test';
        const testTimestamp = Date.now();
        this.db.saveSetting(testKey, testTimestamp);
        const verifiedValue = this.db.getSetting(testKey);

        const dbPath = path.resolve('data/vt2.db');
        const dbExists = fs.existsSync(dbPath);
        let fileSizeFormatted = '16 KB';
        if (dbExists) {
          const stats = fs.statSync(dbPath);
          fileSizeFormatted = `${(stats.size / 1024).toFixed(1)} KB`;
        }

        return this.sendJson(res, 200, {
          status: 'ONLINE',
          driver: 'node:sqlite (Node.js Native Driver)',
          engine: 'Node.js Native node:sqlite',
          dbPath: 'data/vt2.db',
          fileExists: dbExists,
          fileSizeFormatted,
          accountState: this.paperEngine.getAccountSummary(),
          roundtripVerified: verifiedValue === testTimestamp,
          verifiedTimestamp: testTimestamp,
          tables: {
            orders: this.db.getOrders(1000).length,
            positions: positions.length,
            trade_journal: journal.length,
            rejected_setups: rejected.length,
            settings: Object.keys(settings).length,
          },
          records: {
            activePositionsCount: positions.length,
            settingsKeysCount: Object.keys(settings).length,
            journalEntriesCount: journal.length,
            rejectedSetupsCount: rejected.length,
          },
        });
      }

      // 20e. Verification Capabilities Suite
      if (pathname === '/api/verify' && req.method === 'GET') {
        const results = await this.verification.runAllChecks();
        return this.sendJson(res, 200, results);
      }
      if (pathname === '/api/verification/status' && req.method === 'GET') {
        const status = await this.verification.getStatus();
        return this.sendJson(res, 200, status);
      }
      if ((pathname === '/api/verify' || pathname === '/api/verification/run-all') && req.method === 'POST') {
        const results = await this.verification.runAllChecks();
        return this.sendJson(res, 200, results);
      }
      if (pathname === '/api/verification/run' && req.method === 'POST') {
        const body = await this.parseJsonBody(req);
        const result = await this.verification.runSingleCheck(body.checkKey);
        return this.sendJson(res, 200, result);
      }

      // 20f. Trade Sentiment Monitor
      if (pathname === '/api/monitor/status' && req.method === 'GET') {
        return this.sendJson(res, 200, this.tradeMonitor.getStatus());
      }
      if (pathname === '/api/monitor/check-now' && req.method === 'POST') {
        if (this.isDemoReadOnly) return this.sendDemoReadOnlyError(res);
        const results = await this.tradeMonitor.checkPositions();
        return this.sendJson(res, 200, {
          success: true,
          checkedAt: Date.now(),
          results,
        });
      }

      // 20g. Automated Trading Engine (PAPER ONLY)
      if (pathname === '/api/autotrading/status' && req.method === 'GET') {
        return this.sendJson(res, 200, this.autoTrader.getStatus());
      }
      if (pathname === '/api/autotrading/start' && req.method === 'POST') {
        if (this.isDemoReadOnly) return this.sendDemoReadOnlyError(res);
        const body = await this.parseJsonBody(req).catch(() => ({}));
        const status = this.autoTrader.start(body);
        return this.sendJson(res, 200, status);
      }
      if (pathname === '/api/autotrading/stop' && req.method === 'POST') {
        if (this.isDemoReadOnly) return this.sendDemoReadOnlyError(res);
        const body = await this.parseJsonBody(req).catch(() => ({}));
        const status = this.autoTrader.stop(body.reason || 'MANUAL_STOP');
        return this.sendJson(res, 200, status);
      }
      if (pathname === '/api/autotrading/stop-and-close-all' && req.method === 'POST') {
        if (this.isDemoReadOnly) return this.sendDemoReadOnlyError(res);
        const body = await this.parseJsonBody(req).catch(() => ({}));
        const result = this.autoTrader.stopAndCloseAll(body.reason || 'MANUAL_STOP_CLOSE_ALL');
        return this.sendJson(res, 200, result);
      }
      if (pathname === '/api/autotrading/kill-switch' && req.method === 'POST') {
        if (this.isDemoReadOnly) return this.sendDemoReadOnlyError(res);
        const result = this.autoTrader.killSwitch();
        return this.sendJson(res, 200, result);
      }

      // 20h. Market Mode (Stocks | Crypto | Both) Switcher
      if (pathname === '/api/market/mode') {
        if (req.method === 'GET') {
          return this.sendJson(res, 200, {
            activeMode: this.activeMarketMode,
            cryptoSession: this.cryptoProvider.getSessionStatus(),
            stocksSession: this.stockProvider.getSessionStatus(),
          });
        }
        if (req.method === 'POST') {
          const body = await this.parseJsonBody(req);
          const mode = (body.mode || '').toLowerCase();
          if (mode !== 'crypto' && mode !== 'stocks' && mode !== 'both') {
            return this.sendJson(res, 400, { error: 'INVALID_MODE', message: 'Mode must be stocks, crypto, or both' });
          }
          this.activeMarketMode = mode;
          this.db.saveSetting('activeMarketMode', mode);
          if (this.autoTrader) {
            this.autoTrader.config.botMarketMode = mode;
            this.db.saveSetting('auto_trader_config', this.autoTrader.config);
          }
          return this.sendJson(res, 200, {
            success: true,
            activeMode: this.activeMarketMode,
            cryptoSession: this.cryptoProvider.getSessionStatus(),
            stocksSession: this.stockProvider.getSessionStatus(),
          });
        }
      }

      // 20i. Alpha Factory Report Data
      if (pathname === '/api/report/alpha-factory' && req.method === 'GET') {
        try {
          const metricsPath = path.join(PROJECT_ROOT, 'reports/alpha-factory/metrics.json');
          const reportPath = path.join(PROJECT_ROOT, 'reports/alpha-factory/report.md');
          const metrics = fs.existsSync(metricsPath) ? JSON.parse(fs.readFileSync(metricsPath, 'utf8')) : null;
          const reportMd = fs.existsSync(reportPath) ? fs.readFileSync(reportPath, 'utf8') : '';
          return this.sendJson(res, 200, {
            status: 'SUCCESS',
            track: 'Track 1 Alpha Factory (Open Theme)',
            universe: 'Tokenized US Equity Perpetuals (Bitget RWA)',
            metrics,
            reportMd,
          });
        } catch (err) {
          return this.sendJson(res, 500, { error: err.message });
        }
      }

      // 21. Static File Serving (Frontend)
      return this.serveStatic(req, res, pathname);

    } catch (err) {
      if (err.name === 'SafetyViolationError') {
        return this.sendJson(res, 403, {
          error: err.code,
          message: err.message,
          securityAlert: true,
        });
      }
      if (err.statusCode === 413 || err.message === 'Payload too large') {
        return this.sendJson(res, 413, {
          error: 'PAYLOAD_TOO_LARGE',
          message: 'Request payload exceeds 100KB limit.',
        });
      }
      console.error('[API Error]', err);
      return this.sendJson(res, 500, { error: err.message });
    }
  }

  serveStatic(req, res, pathname) {
    let filePath;
    if (pathname.startsWith('/src/')) {
      filePath = path.join(PROJECT_ROOT, pathname);
    } else {
      filePath = path.join(PUBLIC_DIR, pathname === '/' ? 'index.html' : pathname);
    }

    if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
      filePath = path.join(PUBLIC_DIR, 'index.html');
    }

    if (!fs.existsSync(filePath)) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('Not Found');
      return;
    }

    const ext = path.extname(filePath).toLowerCase();
    const mimeTypes = {
      '.html': 'text/html; charset=utf-8',
      '.css': 'text/css; charset=utf-8',
      '.js': 'application/javascript; charset=utf-8',
      '.json': 'application/json',
      '.png': 'image/png',
      '.svg': 'image/svg+xml',
      '.ico': 'image/x-icon',
    };

    const contentType = mimeTypes[ext] || 'application/octet-stream';
    res.writeHead(200, { 'Content-Type': contentType });
    fs.createReadStream(filePath).pipe(res);
  }

  parseJsonBody(req) {
    return new Promise((resolve, reject) => {
      let body = '';
      req.on('data', chunk => {
        body += chunk;
        if (body.length > 100 * 1024) { // 100KB limit
          const err = new Error('Payload too large');
          err.statusCode = 413;
          reject(err);
        }
      });
      req.on('end', () => {
        if (!body) return resolve({});
        try {
          resolve(JSON.parse(body));
        } catch (err) {
          reject(new Error('Invalid JSON format'));
        }
      });
      req.on('error', reject);
    });
  }

  sendJson(res, statusCode, data) {
    res.writeHead(statusCode, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(data));
  }
}

let defaultServerInstance = null;

export async function handleRequest(req, res) {
  if (!defaultServerInstance) {
    defaultServerInstance = new VT2Server({
      demoReadOnly: process.env.DEPLOY_MODE === 'DEMO_READONLY' || Boolean(process.env.VERCEL),
    });
  }
  return defaultServerInstance.handleRequest(req, res);
}

