/**
 * Market fixtures generator for offline paper trading, backtesting, and automated tests.
 * Generates mathematically consistent OHLCV candles with realistic price action,
 * volatility, and volume dynamics for 4h, 15m, and 5m timeframes.
 */

/**
 * Generates an array of realistic OHLCV candles.
 * @param {Object} options
 * @param {number} options.startPrice
 * @param {number} options.count - number of candles
 * @param {number} options.intervalMinutes - candle timeframe in minutes
 * @param {number} [options.volatility=0.005] - bar-to-bar volatility
 * @param {number} [options.trendBias=0.0002] - slight upward/downward drift
 * @param {number} [options.baseVolume=1000]
 * @param {number} [options.startTime] - timestamp in ms
 * @returns {Array<{ timestamp: number, open: number, high: number, low: number, close: number, volume: number, isClosed: boolean }>}
 */
export function generateCandleSeries({
  startPrice,
  count = 100,
  intervalMinutes = 15,
  volatility = 0.004,
  trendBias = 0.0001,
  baseVolume = 500,
  startTime = Date.now() - ((count - 1) * intervalMinutes * 60 * 1000),
}) {
  const candles = [];
  let currentPrice = startPrice;
  const intervalMs = intervalMinutes * 60 * 1000;

  // Use a deterministic seed-like pseudo-random generator for reproducible fixtures
  let seed = Math.floor(startPrice * 100) % 2147483647;
  const pseudoRandom = () => {
    seed = (seed * 16807) % 2147483647;
    return (seed - 1) / 2147483646;
  };

  for (let i = 0; i < count; i++) {
    const ts = startTime + (i * intervalMs);
    const r1 = pseudoRandom();
    const r2 = pseudoRandom();
    const r3 = pseudoRandom();

    // Box-Muller approx for normal distribution
    const changePct = (r1 - 0.5) * 2 * volatility + trendBias;
    const open = Number(currentPrice.toFixed(4));
    const close = Number((open * (1 + changePct)).toFixed(4));

    const wickHighPct = r2 * volatility * 0.8;
    const wickLowPct = r3 * volatility * 0.8;
    const high = Number((Math.max(open, close) * (1 + wickHighPct)).toFixed(4));
    const low = Number((Math.min(open, close) * (1 - wickLowPct)).toFixed(4));

    // Occasional volume spike
    const isVolumeSpike = i % 18 === 0 || i === count - 2;
    const volMultiplier = isVolumeSpike ? (1.8 + (r1 * 0.7)) : (0.7 + (r2 * 0.6));
    const volume = Number((baseVolume * volMultiplier).toFixed(2));

    // The last candle is still forming (isClosed: false)
    const isClosed = i < count - 1;

    candles.push({
      timestamp: ts,
      open,
      high,
      low,
      close,
      volume,
      isClosed,
    });

    currentPrice = close;
  }

  return candles;
}

/**
 * Default multi-timeframe market fixtures for eligible Bitget USDT perp symbols.
 */
export const DEFAULT_MARKET_FIXTURES = {
  'BTCUSDT': {
    symbol: 'BTCUSDT',
    currentPrice: 64250.0,
    priceChange24h: 2.35,
    volume24h: 342150.8,
    lastUpdate: Date.now(),
    candles: {
      '4h': generateCandleSeries({ startPrice: 62800, count: 60, intervalMinutes: 240, volatility: 0.012, trendBias: 0.0008, baseVolume: 2500 }),
      '15m': generateCandleSeries({ startPrice: 63900, count: 80, intervalMinutes: 15, volatility: 0.004, trendBias: 0.0003, baseVolume: 800 }),
      '5m': generateCandleSeries({ startPrice: 64100, count: 100, intervalMinutes: 5, volatility: 0.002, trendBias: 0.0002, baseVolume: 350 }),
    },
  },
  'ETHUSDT': {
    symbol: 'ETHUSDT',
    currentPrice: 3480.5,
    priceChange24h: 1.82,
    volume24h: 182400.5,
    lastUpdate: Date.now(),
    candles: {
      '4h': generateCandleSeries({ startPrice: 3380, count: 60, intervalMinutes: 240, volatility: 0.014, trendBias: 0.0007, baseVolume: 1800 }),
      '15m': generateCandleSeries({ startPrice: 3440, count: 80, intervalMinutes: 15, volatility: 0.005, trendBias: 0.0003, baseVolume: 600 }),
      '5m': generateCandleSeries({ startPrice: 3470, count: 100, intervalMinutes: 5, volatility: 0.0025, trendBias: 0.0002, baseVolume: 250 }),
    },
  },
  'SOLUSDT': {
    symbol: 'SOLUSDT',
    currentPrice: 152.4,
    priceChange24h: 4.15,
    volume24h: 512000.0,
    lastUpdate: Date.now(),
    candles: {
      '4h': generateCandleSeries({ startPrice: 144, count: 60, intervalMinutes: 240, volatility: 0.018, trendBias: 0.0012, baseVolume: 3200 }),
      '15m': generateCandleSeries({ startPrice: 149, count: 80, intervalMinutes: 15, volatility: 0.007, trendBias: 0.0005, baseVolume: 1100 }),
      '5m': generateCandleSeries({ startPrice: 151, count: 100, intervalMinutes: 5, volatility: 0.0035, trendBias: 0.0003, baseVolume: 450 }),
    },
  },
  'XRPUSDT': {
    symbol: 'XRPUSDT',
    currentPrice: 0.5842,
    priceChange24h: -0.65,
    volume24h: 980000.0,
    lastUpdate: Date.now(),
    candles: {
      '4h': generateCandleSeries({ startPrice: 0.592, count: 60, intervalMinutes: 240, volatility: 0.015, trendBias: -0.0004, baseVolume: 5000 }),
      '15m': generateCandleSeries({ startPrice: 0.589, count: 80, intervalMinutes: 15, volatility: 0.006, trendBias: -0.0002, baseVolume: 1600 }),
      '5m': generateCandleSeries({ startPrice: 0.585, count: 100, intervalMinutes: 5, volatility: 0.003, trendBias: -0.0001, baseVolume: 700 }),
    },
  },
  'DOGEUSDT': {
    symbol: 'DOGEUSDT',
    assetClass: 'CRYPTO',
    currentPrice: 0.1245,
    priceChange24h: 3.20,
    volume24h: 750000.0,
    lastUpdate: Date.now(),
    candles: {
      '4h': generateCandleSeries({ startPrice: 0.118, count: 60, intervalMinutes: 240, volatility: 0.02, trendBias: 0.001, baseVolume: 6000 }),
      '15m': generateCandleSeries({ startPrice: 0.121, count: 80, intervalMinutes: 15, volatility: 0.008, trendBias: 0.0004, baseVolume: 2000 }),
      '5m': generateCandleSeries({ startPrice: 0.1235, count: 100, intervalMinutes: 5, volatility: 0.004, trendBias: 0.0002, baseVolume: 800 }),
    },
  },
  'SPYUSDT': {
    symbol: 'SPYUSDT',
    assetClass: 'EQUITY',
    currentPrice: 582.5,
    priceChange24h: 0.85,
    volume24h: 2450000.0,
    lastUpdate: Date.now(),
    candles: {
      '4h': generateCandleSeries({ startPrice: 575, count: 60, intervalMinutes: 240, volatility: 0.008, trendBias: 0.0006, baseVolume: 12000 }),
      '15m': generateCandleSeries({ startPrice: 580, count: 80, intervalMinutes: 15, volatility: 0.003, trendBias: 0.0002, baseVolume: 3500 }),
      '5m': generateCandleSeries({ startPrice: 581.8, count: 100, intervalMinutes: 5, volatility: 0.0015, trendBias: 0.0001, baseVolume: 1200 }),
    },
  },
  'NVDAUSDT': {
    symbol: 'NVDAUSDT',
    assetClass: 'EQUITY',
    currentPrice: 124.6,
    priceChange24h: 2.15,
    volume24h: 4200000.0,
    lastUpdate: Date.now(),
    candles: {
      '4h': generateCandleSeries({ startPrice: 119, count: 60, intervalMinutes: 240, volatility: 0.015, trendBias: 0.0012, baseVolume: 22000 }),
      '15m': generateCandleSeries({ startPrice: 122, count: 80, intervalMinutes: 15, volatility: 0.006, trendBias: 0.0005, baseVolume: 7500 }),
      '5m': generateCandleSeries({ startPrice: 123.8, count: 100, intervalMinutes: 5, volatility: 0.0028, trendBias: 0.0003, baseVolume: 2600 }),
    },
  },
  'TSLAUSDT': {
    symbol: 'TSLAUSDT',
    assetClass: 'EQUITY',
    currentPrice: 242.8,
    priceChange24h: -1.25,
    volume24h: 3100000.0,
    lastUpdate: Date.now(),
    candles: {
      '4h': generateCandleSeries({ startPrice: 248, count: 60, intervalMinutes: 240, volatility: 0.018, trendBias: -0.0006, baseVolume: 18000 }),
      '15m': generateCandleSeries({ startPrice: 245, count: 80, intervalMinutes: 15, volatility: 0.007, trendBias: -0.0003, baseVolume: 6000 }),
      '5m': generateCandleSeries({ startPrice: 243.5, count: 100, intervalMinutes: 5, volatility: 0.0035, trendBias: -0.0002, baseVolume: 2100 }),
    },
  },
};
