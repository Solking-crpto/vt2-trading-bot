import { EventEmitter } from 'node:events';

/**
 * Bitget V2 Public WebSocket Client
 * Connects to wss://ws.bitget.com/v2/ws/public
 * Subscribes to real-time ticker channels for USDT perpetual futures.
 * Maintains heartbeat ping/pong latency measurement and automatic reconnect.
 */
export class BitgetWebSocketClient extends EventEmitter {
  constructor(options = {}) {
    super();
    this.wsUrl = options.wsUrl || 'wss://ws.bitget.com/v2/ws/public';
    this.pingIntervalMs = options.pingIntervalMs || 20000;
    this.reconnectDelayMs = options.reconnectDelayMs || 3000;

    this.ws = null;
    this.isConnected = false;
    this.pingTimer = null;
    this.lastPingSentAt = 0;
    this.lastPongReceivedAt = 0;
    this.latencyMs = 0;
    this.lastDataTimestamp = 0;
    this.subscribedSymbols = new Set(options.initialSymbols || ['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'SPYUSDT', 'QQQUSDT', 'NVDAUSDT']);

    this.isClosing = false;
    this.reconnectTimer = null;
    this.tickerMap = new Map(); // symbol -> { price, bid, ask, change24h, volume24h, ts, lastUpdate }
  }

  start() {
    this.isClosing = false;
    this.connect();
  }

  close() {
    this.isClosing = true;
    this.stopHeartbeat();
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.ws) {
      try {
        this.ws.onclose = null;
        this.ws.onerror = null;
        this.ws.close();
      } catch {}
      this.ws = null;
    }
    this.isConnected = false;
  }

  connect() {
    if (this.isClosing) return;
    if (this.ws) {
      try { this.ws.close(); } catch {}
      this.ws = null;
    }

    try {
      this.ws = new WebSocket(this.wsUrl);

      this.ws.onopen = () => {
        this.isConnected = true;
        this.emit('connected');
        this.startHeartbeat();
        this.resubscribeAll();
      };

      this.ws.onmessage = (event) => {
        this.handleMessage(event.data);
      };

      this.ws.onerror = (err) => {
        if (this.listenerCount('error') > 0) {
          this.emit('error', err);
        } else {
          console.warn('[BitgetWebSocketClient] WS error caught:', err?.message || err);
        }
      };

      this.ws.onclose = () => {
        this.isConnected = false;
        this.stopHeartbeat();
        this.emit('disconnected');
        if (!this.isClosing) {
          if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
          this.reconnectTimer = setTimeout(() => this.connect(), this.reconnectDelayMs);
          if (this.reconnectTimer?.unref) this.reconnectTimer.unref();
        }
      };
    } catch (err) {
      this.isConnected = false;
      if (!this.isClosing) {
        if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
        this.reconnectTimer = setTimeout(() => this.connect(), this.reconnectDelayMs);
        if (this.reconnectTimer?.unref) this.reconnectTimer.unref();
      }
    }
  }

  startHeartbeat() {
    this.stopHeartbeat();
    this.pingTimer = setInterval(() => {
      if (this.ws && this.isConnected) {
        this.lastPingSentAt = Date.now();
        try {
          this.ws.send('ping');
        } catch {}
      }
    }, this.pingIntervalMs);
    if (this.pingTimer.unref) this.pingTimer.unref();
  }

  stopHeartbeat() {
    if (this.pingTimer) {
      clearInterval(this.pingTimer);
      this.pingTimer = null;
    }
  }

  handleMessage(data) {
    if (typeof data !== 'string') return;

    if (data === 'pong') {
      this.lastPongReceivedAt = Date.now();
      if (this.lastPingSentAt > 0) {
        this.latencyMs = Math.max(1, this.lastPongReceivedAt - this.lastPingSentAt);
      }
      return;
    }

    try {
      const msg = JSON.parse(data);
      if (msg.action === 'snapshot' || msg.action === 'update') {
        const arg = msg.arg;
        if (arg && arg.channel === 'ticker' && Array.isArray(msg.data)) {
          for (const item of msg.data) {
            const symbol = item.instId;
            const price = Number(item.lastPr);
            const entry = {
              symbol,
              price,
              bid: Number(item.bidPr || price),
              ask: Number(item.askPr || price),
              change24h: Number(item.change24h || 0),
              volume24h: Number(item.usdtVolume || 0),
              ts: Number(item.ts || Date.now()),
              lastUpdate: Date.now(),
            };
            this.tickerMap.set(symbol, entry);
            this.lastDataTimestamp = Date.now();
            this.emit('ticker', entry);
          }
        }
      }
    } catch {}
  }

  subscribeSymbols(symbols) {
    if (!Array.isArray(symbols)) return;
    const newSymbols = [];
    for (const sym of symbols) {
      const s = sym.toUpperCase();
      if (!this.subscribedSymbols.has(s)) {
        this.subscribedSymbols.add(s);
        newSymbols.push(s);
      }
    }

    if (newSymbols.length > 0 && this.ws && this.isConnected) {
      const args = newSymbols.map(instId => ({
        instType: 'USDT-FUTURES',
        channel: 'ticker',
        instId,
      }));
      try {
        this.ws.send(JSON.stringify({ op: 'subscribe', args }));
      } catch {}
    }
  }

  resubscribeAll() {
    if (!this.ws || !this.isConnected || this.subscribedSymbols.size === 0) return;
    const args = Array.from(this.subscribedSymbols).map(instId => ({
      instType: 'USDT-FUTURES',
      channel: 'ticker',
      instId,
    }));
    try {
      this.ws.send(JSON.stringify({ op: 'subscribe', args }));
    } catch {}
  }

  getTicker(symbol) {
    return this.tickerMap.get(symbol.toUpperCase()) || null;
  }

  getHealth() {
    const now = Date.now();
    const heartbeatAgeMs = this.lastPongReceivedAt > 0 ? now - this.lastPongReceivedAt : (this.isConnected ? 0 : 99999);
    const dataAgeMs = this.lastDataTimestamp > 0 ? now - this.lastDataTimestamp : 99999;
    const isStale = this.lastDataTimestamp > 0 && dataAgeMs > 60000;

    return {
      isConnected: this.isConnected,
      latencyMs: this.latencyMs,
      heartbeatAgeMs,
      lastDataTimestamp: this.lastDataTimestamp,
      isStale,
      subscribedCount: this.subscribedSymbols.size,
    };
  }

  stop() {
    this.stopHeartbeat();
    if (this.ws) {
      try { this.ws.close(); } catch {}
      this.ws = null;
    }
    this.isConnected = false;
  }
}
