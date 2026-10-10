import {
  ELIGIBLE_CONTRACTS,
  getContractSpec,
  isEligibleContract,
  isEquityContract,
  isCryptoContract,
  classifyInstrument,
  EQUITY_PERPS_LIST,
  validateContractsAgainstLive,
} from '../config/contracts.js';
import { DEFAULT_MARKET_FIXTURES } from '../data/market-fixtures.js';
import { BitgetWebSocketClient } from './bitget-ws.js';

export const CONNECTION_STATUS = Object.freeze({
  ONLINE: 'ONLINE',
  OFFLINE: 'OFFLINE',
  TIMEOUT: 'TIMEOUT',
  SIMULATED_FIXTURE: 'SIMULATED_FIXTURE',
});

export function mapBitgetGranularity(granularity) {
  const g = String(granularity || '15m').trim();
  if (g.toLowerCase() === '4h') return '4H';
  if (g.toLowerCase() === '1h') return '1H';
  if (g.toLowerCase() === '6h') return '6H';
  if (g.toLowerCase() === '12h') return '12H';
  if (g.toLowerCase() === '1d') return '1D';
  if (g.toLowerCase() === '1w') return '1W';
  if (g.toLowerCase() === '1m') return '1m';
  if (g.toLowerCase() === '3m') return '3m';
  if (g.toLowerCase() === '5m') return '5m';
  if (g.toLowerCase() === '15m') return '15m';
  if (g.toLowerCase() === '30m') return '30m';
  return g;
}

/**
 * Asserts strict chronological ascending order and uniqueness of candles.
 * Throws a fatal integrity error if candles are descending, reversed, or contain duplicate timestamps.
 * @param {Array<{timestamp: number}>} candles
 * @param {string} [granularity='15m']
 */
export function assertCandleIntegrity(candles, granularity = '15m') {
  if (!Array.isArray(candles) || candles.length <= 1) return;
  for (let i = 1; i < candles.length; i++) {
    const prev = candles[i - 1];
    const curr = candles[i];
    if (curr.timestamp === prev.timestamp) {
      throw new Error(`CANDLE_INTEGRITY_VIOLATION: Duplicate candle timestamp ${curr.timestamp} detected at indices ${i - 1} and ${i} (${granularity}).`);
    }
    if (curr.timestamp < prev.timestamp) {
      throw new Error(`CANDLE_INTEGRITY_VIOLATION: Non-ascending / reversed candles detected: bar[${i}].timestamp (${curr.timestamp}) < bar[${i - 1}].timestamp (${prev.timestamp}) (${granularity}).`);
    }
  }
}

/**
 * Concurrency runner for high-throughput parallel HTTP requests.
 */
async function runConcurrent(tasks, limit = 12) {
  const results = [];
  const executing = new Set();
  for (const task of tasks) {
    const p = Promise.resolve().then(() => task());
    results.push(p);
    executing.add(p);
    const clean = () => executing.delete(p);
    p.then(clean, clean);
    if (executing.size >= limit) {
      await Promise.race(executing);
    }
  }
  return Promise.all(results);
}

/**
 * Adapter for Bitget Public Market Data
 * Communicates with official Bitget REST & WebSocket endpoints.
 * Read-only, strictly enforces paper trading boundaries.
 */
export class BitgetAdapter {
  constructor(options = {}) {
    this.baseUrl = options.baseUrl || process.env.BITGET_API_BASE_URL || 'https://api.bitget.com';
    this.timeoutMs = options.timeoutMs || 3500;
    this.environment = 'PAPER'; // Immutable paper trading mode
    this.lastHealthCheck = null;
    this.forceFixtureMode = options.forceFixtureMode || false;

    this.scannerCache = new Map(); // key `${marketMode}_${limit}` -> { markets, time }
    this.candleCache = new Map(); // `${symbol}_${granularity}` -> { candles, time, isLive, source }
    this.lastContractsAudit = null;

    // Real-Time Public WebSocket Client
    this.wsClient = new BitgetWebSocketClient({
      wsUrl: options.wsUrl || 'wss://ws.bitget.com/v2/ws/public',
    });
    if (!this.forceFixtureMode && process.env.NODE_ENV !== 'test') {
      try {
        this.wsClient.start();
      } catch (err) {
        console.warn('[BitgetAdapter] WS init skipped:', err.message);
      }
    }
  }

  close() {
    if (this.wsClient) {
      this.wsClient.close();
    }
  }

  /**
   * Health check on Bitget market connectivity.
   * Uses real-time WebSocket heartbeat when connected or REST probe with measured round-trip.
   * @returns {Promise<{ status: string, latencyMs: number, lastCheckedAt: number, isLive: boolean, wsConnected: boolean, lastDataTimestamp: number }>}
   */
  async checkHealth() {
    if (this.forceFixtureMode) {
      const result = {
        status: CONNECTION_STATUS.SIMULATED_FIXTURE,
        latencyMs: 1,
        lastCheckedAt: Date.now(),
        lastDataTimestamp: Date.now(),
        isLive: false,
        wsConnected: false,
        note: 'Using local verified market fixtures for paper testing.',
      };
      this.lastHealthCheck = result;
      return result;
    }

    const wsHealth = this.wsClient.getHealth();
    if (wsHealth.isConnected && wsHealth.latencyMs > 0) {
      const result = {
        status: CONNECTION_STATUS.ONLINE,
        latencyMs: wsHealth.latencyMs,
        lastCheckedAt: Date.now(),
        lastDataTimestamp: wsHealth.lastDataTimestamp || Date.now(),
        isLive: true,
        wsConnected: true,
        note: `Bitget V2 WebSocket connected (${wsHealth.latencyMs}ms latency).`,
      };
      this.lastHealthCheck = result;
      return result;
    }

    const start = Date.now();
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), this.timeoutMs);

      const response = await fetch(`${this.baseUrl}/api/v2/mix/market/contracts?productType=USDT-FUTURES`, {
        signal: controller.signal,
        headers: { 'Accept': 'application/json' },
      });
      clearTimeout(timer);

      const latencyMs = Date.now() - start;

      if (response.ok) {
        const body = await response.json();
        if (body.code === '00000') {
          // Perform startup contracts audit if not already run
          if (!this.lastContractsAudit && Array.isArray(body.data)) {
            this.lastContractsAudit = validateContractsAgainstLive(body.data);
          }

          const result = {
            status: CONNECTION_STATUS.ONLINE,
            latencyMs,
            lastCheckedAt: Date.now(),
            lastDataTimestamp: Date.now(),
            isLive: true,
            wsConnected: false,
            note: 'Official Bitget V2 market-data feed connected via REST.',
          };
          this.lastHealthCheck = result;
          return result;
        }
      }

      const result = {
        status: CONNECTION_STATUS.OFFLINE,
        latencyMs,
        lastCheckedAt: Date.now(),
        lastDataTimestamp: 0,
        isLive: false,
        wsConnected: false,
        error: `Bitget returned HTTP status ${response.status}`,
      };
      this.lastHealthCheck = result;
      return result;
    } catch (err) {
      const latencyMs = Date.now() - start;
      const isTimeout = err.name === 'AbortError' || err.message?.includes('timeout') || err.code === 'UND_ERR_CONNECT_TIMEOUT';
      const result = {
        status: isTimeout ? CONNECTION_STATUS.TIMEOUT : CONNECTION_STATUS.OFFLINE,
        latencyMs,
        lastCheckedAt: Date.now(),
        lastDataTimestamp: 0,
        isLive: false,
        wsConnected: false,
        error: err.message,
        note: 'Live connection unavailable; serving verified market fixtures.',
      };
      this.lastHealthCheck = result;
      return result;
    }
  }

  /**
   * Fetches tickers for eligible USDT perpetual contracts.
   * Prioritizes live WebSocket feed, falling back to REST.
   * @returns {Promise<{ data: Array, isLive: boolean, source: string, timestamp: number }>}
   */
  async getTickers() {
    const health = await this.checkHealth();

    if (health.isLive) {
      try {
        const response = await fetch(`${this.baseUrl}/api/v2/mix/market/tickers?productType=USDT-FUTURES`, {
          headers: { 'Accept': 'application/json' },
        });
        if (response.ok) {
          const json = await response.json();
          if (json.code === '00000' && Array.isArray(json.data)) {
            const filtered = json.data.filter(t => isEligibleContract(t.symbol));

            // Subscribe active symbols to WebSocket
            const topSymbols = filtered.slice(0, 40).map(t => t.symbol);
            this.wsClient.subscribeSymbols(topSymbols);

            return {
              data: filtered,
              isLive: true,
              source: 'BITGET_V2_REST',
              timestamp: Date.now(),
            };
          }
        }
      } catch {}
    }

    // Transparent simulated fixture fallback
    const fixtureTickers = Object.values(DEFAULT_MARKET_FIXTURES).map(f => ({
      symbol: f.symbol,
      lastPr: String(f.currentPrice),
      change24h: String(f.priceChange24h),
      usdtVolume: String(f.volume24h),
      high24h: String((f.currentPrice * 1.025).toFixed(4)),
      low24h: String((f.currentPrice * 0.975).toFixed(4)),
      ts: String(f.lastUpdate),
    }));

    return {
      data: fixtureTickers,
      isLive: false,
      source: 'SYNTHETIC',
      timestamp: Date.now(),
      disclaimer: 'Live Bitget feed offline. Showing synthetic market fixtures for paper testing.',
    };
  }

  /**
   * Fetches OHLCV candles with in-memory caching and REST fallback.
   * @param {string} symbol
   * @param {string} granularity
   * @param {number} [limit=60]
   * @param {boolean} [forceFresh=false]
   */
  async getCandles(symbol, granularity = '15m', limit = 60, forceFresh = false) {
    const sym = symbol.toUpperCase();
    const cacheKey = `${sym}_${granularity}`;
    const cached = this.candleCache.get(cacheKey);

    if (!forceFresh && cached && (Date.now() - cached.time < 30000)) {
      return cached;
    }

    if (this.forceFixtureMode) {
      const fixture = DEFAULT_MARKET_FIXTURES[sym] || DEFAULT_MARKET_FIXTURES['BTCUSDT'];
      const stdG = granularity.toLowerCase();
      const candles = fixture?.candles?.[stdG] || fixture?.candles?.['15m'] || [];
      const entry = {
        symbol: sym,
        granularity,
        candles: candles.slice(-limit),
        isLive: false,
        source: 'SYNTHETIC',
        time: Date.now(),
      };
      this.candleCache.set(cacheKey, entry);
      return entry;
    }

    try {
      const bitgetGranularity = mapBitgetGranularity(granularity);
      const url = `${this.baseUrl}/api/v2/mix/market/candles?symbol=${sym}&granularity=${bitgetGranularity}&productType=USDT-FUTURES&limit=${limit}`;
      const res = await fetch(url, { headers: { 'Accept': 'application/json' } });
      if (res.ok) {
        const json = await res.json();
        if (json.code === '00000' && Array.isArray(json.data) && json.data.length > 0) {
          const sorted = [...json.data].sort((a, b) => Number(a[0]) - Number(b[0]));
          const parsed = sorted.map((c, idx) => ({
            timestamp: Number(c[0]),
            open: Number(c[1]),
            high: Number(c[2]),
            low: Number(c[3]),
            close: Number(c[4]),
            volume: Number(c[5]),
            isClosed: idx < sorted.length - 1,
          }));

          assertCandleIntegrity(parsed, granularity);

          const entry = {
            symbol: sym,
            granularity,
            candles: parsed,
            isLive: true,
            source: 'BITGET_V2_REST',
            time: Date.now(),
          };
          this.candleCache.set(cacheKey, entry);
          return entry;
        }
      }
    } catch (err) {
      if (err.message && err.message.includes('CANDLE_INTEGRITY_VIOLATION')) {
        throw err;
      }
    }

    const fixture = DEFAULT_MARKET_FIXTURES[sym] || DEFAULT_MARKET_FIXTURES['BTCUSDT'];
    const stdG = granularity.toLowerCase();
    const candles = fixture?.candles?.[stdG] || fixture?.candles?.['15m'] || [];
    assertCandleIntegrity(candles, granularity);
    const entry = {
      symbol: sym,
      granularity,
      candles: candles.slice(-limit),
      isLive: false,
      source: 'SYNTHETIC',
      time: Date.now(),
    };
    this.candleCache.set(cacheKey, entry);
    return entry;
  }

  /**
   * Fetches real historical candles from Bitget for backtesting up to 1000 candles.
   */
  async getHistoricalCandles(symbol, granularity = '15m', limit = 1000) {
    if (this.forceFixtureMode) {
      const fixture = DEFAULT_MARKET_FIXTURES[symbol] || DEFAULT_MARKET_FIXTURES['BTCUSDT'];
      const stdG = granularity.toLowerCase();
      const candles = fixture?.candles?.[stdG] || fixture?.candles?.['15m'] || [];
      assertCandleIntegrity(candles, granularity);
      return {
        symbol,
        granularity,
        candles,
        isLive: false,
        source: 'Synthetic',
        timestamp: Date.now(),
      };
    }

    try {
      const bitgetG = mapBitgetGranularity(granularity);
      const url = `${this.baseUrl}/api/v2/mix/market/candles?symbol=${symbol}&granularity=${bitgetG}&productType=USDT-FUTURES&limit=${Math.min(limit, 1000)}`;
      const res = await fetch(url, { headers: { 'Accept': 'application/json' } });
      if (res.ok) {
        const json = await res.json();
        if (json.code === '00000' && Array.isArray(json.data) && json.data.length > 0) {
          const sorted = [...json.data].sort((a, b) => Number(a[0]) - Number(b[0]));
          const parsed = sorted.map(c => ({
            timestamp: Number(c[0]),
            open: Number(c[1]),
            high: Number(c[2]),
            low: Number(c[3]),
            close: Number(c[4]),
            volume: Number(c[5]),
          }));
          assertCandleIntegrity(parsed, granularity);

          return {
            symbol,
            granularity,
            candles: parsed,
            isLive: true,
            source: 'Bitget historical',
            timestamp: Date.now(),
          };
        }
      }
    } catch {}

    const fixture = DEFAULT_MARKET_FIXTURES[symbol] || DEFAULT_MARKET_FIXTURES['BTCUSDT'];
    const stdG = granularity.toLowerCase();
    return {
      symbol,
      granularity,
      candles: fixture?.candles?.[stdG] || fixture?.candles?.['15m'] || [],
      isLive: false,
      source: 'Synthetic',
      timestamp: Date.now(),
    };
  }

  /**
   * High-Performance Multi-Market Universe Scanner
   * Enforces strict asset-class filtering (Stocks / Crypto / Both),
   * parallelized candle fetches (target <3s), and real-time WebSocket price overlay.
   * @param {Object} [options]
   * @param {string} [options.marketMode='stocks'] - 'stocks' | 'crypto' | 'both'
   * @param {number} [options.limit=30]
   * @param {boolean} [options.forceFresh=false]
   */
  async getLiveUniverseCandles(options = {}, legacyForceFresh = false) {
    let limit = 30;
    let minLiquidity = 10000000;
    let forceFresh = false;
    let marketMode = 'stocks'; // DEFAULT: STOCKS FIRST

    if (Array.isArray(options)) {
      forceFresh = Boolean(legacyForceFresh);
    } else if (typeof options === 'object' && options !== null) {
      limit = Number(options.limit) || 30;
      minLiquidity = Number(options.minLiquidity) || 10000000;
      forceFresh = Boolean(options.forceFresh);
      if (options.marketMode) marketMode = options.marketMode;
    }

    const cacheKey = `${marketMode}_${limit}`;
    const cached = this.scannerCache.get(cacheKey);
    if (!forceFresh && cached && (Date.now() - cached.time < 15000)) {
      return cached.markets;
    }

    const filterFixtures = (mode) => {
      const all = Object.values(DEFAULT_MARKET_FIXTURES);
      let selected = all;
      if (mode === 'stocks') {
        selected = all.filter(f => isEquityContract(f.symbol));
      } else if (mode === 'crypto') {
        selected = all.filter(f => isCryptoContract(f.symbol));
      }
      return Object.fromEntries(selected.map(f => [f.symbol, f]));
    };

    if (this.forceFixtureMode) {
      return filterFixtures(marketMode);
    }

    const health = await this.checkHealth();
    if (!health.isLive) {
      return filterFixtures(marketMode);
    }

    const tickersMap = new Map();
    let targetSymbols = [];

    try {
      const tickersRes = await this.getTickers();
      if (tickersRes && Array.isArray(tickersRes.data)) {
        for (const t of tickersRes.data) {
          tickersMap.set(t.symbol, t);
        }

        if (marketMode === 'stocks') {
          // STRICT STOCKS ONLY: Zero crypto allowed
          const stockTickers = tickersRes.data
            .filter(t => isEquityContract(t.symbol, t))
            .map(t => ({
              symbol: t.symbol,
              volume: Number(t.usdtVolume || t.quoteVolume || 0),
            }))
            .sort((a, b) => b.volume - a.volume);

          targetSymbols = stockTickers.slice(0, limit).map(s => s.symbol);
          if (!targetSymbols.includes('SPYUSDT') && tickersMap.has('SPYUSDT')) {
            targetSymbols.unshift('SPYUSDT');
          }
        } else if (marketMode === 'crypto') {
          // STRICT CRYPTO ONLY: Zero equities allowed
          const cryptoTickers = tickersRes.data
            .filter(t => isCryptoContract(t.symbol, t))
            .map(t => ({
              symbol: t.symbol,
              volume: Number(t.usdtVolume || t.quoteVolume || 0),
            }))
            .sort((a, b) => b.volume - a.volume);

          targetSymbols = cryptoTickers.slice(0, limit).map(s => s.symbol);
          if (!targetSymbols.includes('BTCUSDT') && tickersMap.has('BTCUSDT')) {
            targetSymbols.unshift('BTCUSDT');
          }
        } else {
          // BOTH MODE: Equities + Crypto combined
          const halfLimit = Math.floor(limit / 2);
          const stockTickers = tickersRes.data
            .filter(t => isEquityContract(t.symbol, t))
            .map(t => ({ symbol: t.symbol, volume: Number(t.usdtVolume || 0) }))
            .sort((a, b) => b.volume - a.volume)
            .slice(0, halfLimit);

          const cryptoTickers = tickersRes.data
            .filter(t => isCryptoContract(t.symbol, t))
            .map(t => ({ symbol: t.symbol, volume: Number(t.usdtVolume || 0) }))
            .sort((a, b) => b.volume - a.volume)
            .slice(0, limit - stockTickers.length);

          targetSymbols = [...stockTickers.map(s => s.symbol), ...cryptoTickers.map(c => c.symbol)];
          if (!targetSymbols.includes('SPYUSDT') && tickersMap.has('SPYUSDT')) targetSymbols.push('SPYUSDT');
          if (!targetSymbols.includes('BTCUSDT') && tickersMap.has('BTCUSDT')) targetSymbols.push('BTCUSDT');
        }
      }
    } catch (err) {
      console.warn('[BitgetAdapter] Error getting tickers:', err.message);
    }

    if (targetSymbols.length === 0) {
      targetSymbols = marketMode === 'stocks'
        ? ['SPYUSDT', 'QQQUSDT', 'NVDAUSDT', 'TSLAUSDT', 'AAPLUSDT', 'MSTRUSDT', 'SOXLUSDT', 'MUUSDT']
        : ['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'XRPUSDT', 'DOGEUSDT'];
    }

    // Subscribe scanned universe to real-time WebSocket stream
    this.wsClient.subscribeSymbols(targetSymbols);

    const markets = {};

    // High-performance parallel fetch with concurrency limit of 12
    const fetchTasks = targetSymbols.map(sym => async () => {
      try {
        const [c4h, c15m, c5m] = await Promise.all([
          this.getCandles(sym, '4h', 60, forceFresh),
          this.getCandles(sym, '15m', 60, forceFresh),
          this.getCandles(sym, '5m', 60, forceFresh),
        ]);

        const ticker = tickersMap.get(sym);
        const wsTicker = this.wsClient.getTicker(sym);
        const livePrice = wsTicker ? wsTicker.price : (ticker ? Number(ticker.lastPr) : 0);

        const contract = getContractSpec(sym);
        const assetClass = contract?.assetClass || classifyInstrument(sym);

        markets[sym] = {
          symbol: sym,
          underlyingTicker: contract?.underlyingTicker || sym.replace(/USDT$/, ''),
          assetClass,
          currentPrice: livePrice || (c15m.candles?.[c15m.candles.length - 1]?.close || 100),
          priceChange24h: wsTicker ? wsTicker.change24h : Number(ticker?.change24h || 0),
          volume24h: wsTicker ? wsTicker.volume24h : Number(ticker?.usdtVolume || 0),
          sessionStatus: contract?.sessionStatus || 'NORMAL_24_7',
          candles: {
            '4h': c4h.candles,
            '15m': c15m.candles,
            '5m': c5m.candles,
          },
          isLive: c4h.isLive && c15m.isLive,
          source: (c4h.isLive && c15m.isLive) ? 'BITGET_V2_LIVE' : 'SYNTHETIC',
        };
      } catch (err) {
        markets[sym] = DEFAULT_MARKET_FIXTURES[sym] || DEFAULT_MARKET_FIXTURES['BTCUSDT'];
      }
    });

    await runConcurrent(fetchTasks, 12);

    if (Object.keys(markets).length > 0) {
      this.scannerCache.set(cacheKey, { markets, time: Date.now() });
      return markets;
    }

    return DEFAULT_MARKET_FIXTURES;
  }

  /**
   * Returns formatted equity universe table data for the Market Scanner.
   * @returns {Promise<Array<Object>>}
   */
  async getEquityUniverseTable() {
    const tickersRes = await this.getTickers();
    const map = new Map((tickersRes.data || []).map(t => [t.symbol, t]));

    return EQUITY_PERPS_LIST.map(eq => {
      const live = map.get(eq.symbol);
      const wsLive = this.wsClient.getTicker(eq.symbol);
      const price = wsLive ? wsLive.price : (live ? Number(live.lastPr) : 0);
      const change = wsLive ? wsLive.change24h : (live ? Number(live.change24h) : 0);
      const volume = wsLive ? wsLive.volume24h : (live ? Number(live.usdtVolume || 0) : 0);

      return {
        symbol: eq.symbol,
        underlyingTicker: eq.underlyingTicker,
        name: eq.name,
        assetClass: 'EQUITY',
        isBenchmark: Boolean(eq.isBenchmark),
        price,
        priceChange24h: change,
        volume24h: volume,
        sessionStatus: 'NORMAL_24_7', // Documented 24/7 continuous trading on Bitget
        maxLeverage: eq.defaultMaxLeverage,
        tickSize: eq.defaultTickSize,
        minSize: eq.defaultMinSize,
      };
    });
  }

  /**
   * Refuses any live exchange order placement.
   */
  async placeOrder() {
    throw new Error('SAFETY_VIOLATION: Live order placement strictly disabled. VT2 is operating in PAPER TRADING ONLY mode.');
  }
}
