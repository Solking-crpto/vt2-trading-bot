/**
 * Quantitative Technical Indicators for VT2 Trading Bot
 * Strictly avoids look-ahead bias; returns null when candle series is insufficient.
 */

/**
 * Calculates Simple Moving Average (SMA).
 * @param {number[]} values
 * @param {number} period
 * @returns {number[]} array matching input length (padded with nulls)
 */
export function calculateSMA(values, period) {
  if (!Array.isArray(values) || values.length < period || period <= 0) {
    return values.map(() => null);
  }

  const result = new Array(values.length).fill(null);
  let sum = 0;

  for (let i = 0; i < period; i++) {
    sum += values[i];
  }
  result[period - 1] = Number((sum / period).toFixed(6));

  for (let i = period; i < values.length; i++) {
    sum += values[i] - values[i - period];
    result[i] = Number((sum / period).toFixed(6));
  }

  return result;
}

/**
 * Calculates Exponential Moving Average (EMA).
 * @param {number[]} values
 * @param {number} period
 * @returns {number[]} array matching input length (padded with nulls)
 */
export function calculateEMA(values, period) {
  if (!Array.isArray(values) || values.length < period || period <= 0) {
    return values.map(() => null);
  }

  const result = new Array(values.length).fill(null);
  const k = 2 / (period + 1);

  // Initialize with SMA
  let initialSum = 0;
  for (let i = 0; i < period; i++) {
    initialSum += values[i];
  }
  let prevEma = initialSum / period;
  result[period - 1] = Number(prevEma.toFixed(6));

  for (let i = period; i < values.length; i++) {
    prevEma = (values[i] - prevEma) * k + prevEma;
    result[i] = Number(prevEma.toFixed(6));
  }

  return result;
}

/**
 * Calculates Relative Strength Index (RSI) using Wilder's smoothing.
 * @param {number[]} closes
 * @param {number} [period=14]
 * @returns {number[]} array matching input length (padded with nulls)
 */
export function calculateRSI(closes, period = 14) {
  if (!Array.isArray(closes) || closes.length <= period || period <= 0) {
    return closes.map(() => null);
  }

  const result = new Array(closes.length).fill(null);
  const changes = [];
  for (let i = 1; i < closes.length; i++) {
    changes.push(closes[i] - closes[i - 1]);
  }

  let gains = 0;
  let losses = 0;

  for (let i = 0; i < period; i++) {
    const change = changes[i];
    if (change > 0) gains += change;
    else losses += Math.abs(change);
  }

  let avgGain = gains / period;
  let avgLoss = losses / period;

  if (avgLoss === 0) {
    result[period] = 100;
  } else {
    const rs = avgGain / avgLoss;
    result[period] = Number((100 - (100 / (1 + rs))).toFixed(2));
  }

  for (let i = period + 1; i < closes.length; i++) {
    const change = changes[i - 1];
    const gain = change > 0 ? change : 0;
    const loss = change < 0 ? Math.abs(change) : 0;

    avgGain = (avgGain * (period - 1) + gain) / period;
    avgLoss = (avgLoss * (period - 1) + loss) / period;

    if (avgLoss === 0) {
      result[i] = 100;
    } else {
      const rs = avgGain / avgLoss;
      result[i] = Number((100 - (100 / (1 + rs))).toFixed(2));
    }
  }

  return result;
}

/**
 * Calculates Average True Range (ATR) using Wilder's smoothing.
 * @param {Array<{ high: number, low: number, close: number }>} candles
 * @param {number} [period=14]
 * @returns {number[]} array matching input length (padded with nulls)
 */
export function calculateATR(candles, period = 14) {
  if (!Array.isArray(candles) || candles.length <= period || period <= 0) {
    return candles.map(() => null);
  }

  const result = new Array(candles.length).fill(null);
  const trueRanges = [];

  // First TR is simply high - low
  trueRanges.push(candles[0].high - candles[0].low);

  for (let i = 1; i < candles.length; i++) {
    const high = candles[i].high;
    const low = candles[i].low;
    const prevClose = candles[i - 1].close;

    const tr = Math.max(
      high - low,
      Math.abs(high - prevClose),
      Math.abs(low - prevClose)
    );
    trueRanges.push(tr);
  }

  // Initial ATR is simple average of first 'period' TRs
  let initialTrSum = 0;
  for (let i = 0; i < period; i++) {
    initialTrSum += trueRanges[i];
  }
  let prevAtr = initialTrSum / period;
  result[period - 1] = Number(prevAtr.toFixed(6));

  // Wilder's smoothing
  for (let i = period; i < candles.length; i++) {
    prevAtr = (prevAtr * (period - 1) + trueRanges[i]) / period;
    result[i] = Number(prevAtr.toFixed(6));
  }

  return result;
}

/**
 * Calculates Relative Volume (RVOL) compared to a 20-candle moving average.
 * @param {number[]} volumes
 * @param {number} [period=20]
 * @returns {Array<{ avgVolume: number|null, relativeVolume: number|null, isSpike: boolean }>}
 */
export function calculateRelativeVolume(volumes, period = 20, spikeThreshold = 1.5) {
  const sma = calculateSMA(volumes, period);
  return volumes.map((vol, idx) => {
    // Prefer prior 20-candle SMA if available, otherwise current
    const priorAvg = idx >= period ? sma[idx - 1] : sma[idx];
    if (priorAvg === null || priorAvg === 0) {
      return { avgVolume: null, relativeVolume: null, isSpike: false };
    }
    const rvol = Number((vol / priorAvg).toFixed(2));
    return {
      avgVolume: priorAvg,
      relativeVolume: rvol,
      isSpike: rvol >= spikeThreshold,
    };
  });
}

/**
 * Computes all technical indicators for a given candle series.
 * @param {Array<{ high: number, low: number, close: number, volume: number }>} candles
 * @returns {Object} enriched indicators object
 */
export function computeIndicators(candles) {
  if (!Array.isArray(candles) || candles.length === 0) {
    return null;
  }

  const closes = candles.map(c => c.close);
  const volumes = candles.map(c => c.volume);

  const ema20 = calculateEMA(closes, 20);
  const ema50 = calculateEMA(closes, 50);
  const ema200 = calculateEMA(closes, 200);
  const rsi14 = calculateRSI(closes, 14);
  const atr14 = calculateATR(candles, 14);
  const rvol = calculateRelativeVolume(volumes, 20, 1.5);

  const lastIdx = candles.length - 1;

  return {
    ema20,
    ema50,
    ema200,
    rsi14,
    atr14,
    relativeVolume: rvol,
    current: {
      close: closes[lastIdx],
      ema20: ema20[lastIdx],
      ema50: ema50[lastIdx],
      ema200: ema200[lastIdx],
      rsi: rsi14[lastIdx],
      atr: atr14[lastIdx],
      volume: volumes[lastIdx],
      avgVolume: rvol[lastIdx].avgVolume,
      rvol: rvol[lastIdx].relativeVolume,
      isVolumeSpike: rvol[lastIdx].isSpike,
    },
  };
}
