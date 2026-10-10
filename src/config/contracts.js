import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load curated Bitget Tokenized Equity Perps specification
let rawEquityPerps = [];
try {
  const equityPath = path.resolve(__dirname, '../../config/equity-perps.json');
  if (fs.existsSync(equityPath)) {
    rawEquityPerps = JSON.parse(fs.readFileSync(equityPath, 'utf8'));
  }
} catch (err) {
  console.warn('[Contracts] Warning reading config/equity-perps.json:', err.message);
}

export const EQUITY_PERPS_LIST = Object.freeze(rawEquityPerps);
export const ALL_EQUITY_SYMBOLS = Object.freeze(rawEquityPerps.map(e => e.symbol.toUpperCase()));
export const EQUITY_PERPS_MAP = new Map(rawEquityPerps.map(e => [e.symbol.toUpperCase(), e]));

/**
 * Verified base USDT Perpetual Contract Specifications
 */
const BASE_CONTRACTS = {
  // Major Cryptocurrencies
  'BTCUSDT': {
    symbol: 'BTCUSDT',
    baseCoin: 'BTC',
    underlyingTicker: 'BTC',
    quoteCoin: 'USDT',
    assetClass: 'CRYPTO',
    productType: 'USDT-FUTURES',
    tickSize: 0.1,
    stepSize: 0.001,
    minOrderQty: 0.001,
    maxOrderQty: 1000,
    maxLeverage: 150,
    minNotional: 5.0,
    makerFeeRate: 0.0002,
    takerFeeRate: 0.0005,
    defaultFundingRate8h: 0.0001,
    baseSlippage: 0.0002,
    sessionStatus: 'NORMAL_24_7',
    isActive: true,
  },
  'ETHUSDT': {
    symbol: 'ETHUSDT',
    baseCoin: 'ETH',
    underlyingTicker: 'ETH',
    quoteCoin: 'USDT',
    assetClass: 'CRYPTO',
    productType: 'USDT-FUTURES',
    tickSize: 0.01,
    stepSize: 0.01,
    minOrderQty: 0.01,
    maxOrderQty: 5000,
    maxLeverage: 125,
    minNotional: 5.0,
    makerFeeRate: 0.0002,
    takerFeeRate: 0.0005,
    defaultFundingRate8h: 0.0001,
    baseSlippage: 0.0002,
    sessionStatus: 'NORMAL_24_7',
    isActive: true,
  },
  'SOLUSDT': {
    symbol: 'SOLUSDT',
    baseCoin: 'SOL',
    underlyingTicker: 'SOL',
    quoteCoin: 'USDT',
    assetClass: 'CRYPTO',
    productType: 'USDT-FUTURES',
    tickSize: 0.01,
    stepSize: 0.1,
    minOrderQty: 0.1,
    maxOrderQty: 10000,
    maxLeverage: 100,
    minNotional: 5.0,
    makerFeeRate: 0.0002,
    takerFeeRate: 0.0005,
    defaultFundingRate8h: 0.00015,
    baseSlippage: 0.0003,
    sessionStatus: 'NORMAL_24_7',
    isActive: true,
  },
  'XRPUSDT': {
    symbol: 'XRPUSDT',
    baseCoin: 'XRP',
    underlyingTicker: 'XRP',
    quoteCoin: 'USDT',
    assetClass: 'CRYPTO',
    productType: 'USDT-FUTURES',
    tickSize: 0.0001,
    stepSize: 1,
    minOrderQty: 1,
    maxOrderQty: 500000,
    maxLeverage: 75,
    minNotional: 5.0,
    makerFeeRate: 0.0002,
    takerFeeRate: 0.0005,
    defaultFundingRate8h: 0.0001,
    baseSlippage: 0.0003,
    sessionStatus: 'NORMAL_24_7',
    isActive: true,
  },
  'DOGEUSDT': {
    symbol: 'DOGEUSDT',
    baseCoin: 'DOGE',
    underlyingTicker: 'DOGE',
    quoteCoin: 'USDT',
    assetClass: 'CRYPTO',
    productType: 'USDT-FUTURES',
    tickSize: 0.00001,
    stepSize: 10,
    minOrderQty: 10,
    maxOrderQty: 1000000,
    maxLeverage: 75,
    minNotional: 5.0,
    makerFeeRate: 0.0002,
    takerFeeRate: 0.0005,
    defaultFundingRate8h: 0.0001,
    baseSlippage: 0.0004,
    sessionStatus: 'NORMAL_24_7',
    isActive: true,
  },
};

// Populate verified equities into ELIGIBLE_CONTRACTS
for (const eq of rawEquityPerps) {
  const sym = eq.symbol.toUpperCase();
  BASE_CONTRACTS[sym] = {
    symbol: sym,
    baseCoin: eq.underlyingTicker,
    underlyingTicker: eq.underlyingTicker,
    name: eq.name,
    quoteCoin: 'USDT',
    assetClass: 'EQUITY',
    isBenchmark: Boolean(eq.isBenchmark),
    productType: 'USDT-FUTURES',
    tickSize: eq.defaultTickSize || 0.01,
    stepSize: eq.defaultMinSize || 0.01,
    minOrderQty: eq.defaultMinSize || 0.01,
    maxOrderQty: 10000,
    maxLeverage: eq.defaultMaxLeverage || 20,
    minNotional: 5.0,
    makerFeeRate: 0.0002,
    takerFeeRate: 0.0005,
    defaultFundingRate8h: 0.0001,
    baseSlippage: 0.0002,
    sessionStatus: 'NORMAL_24_7',
    isActive: true,
  };
}

export const ELIGIBLE_CONTRACTS = Object.freeze(BASE_CONTRACTS);

// Dynamic Live-discovered RWA Contracts set and specifications
export const DYNAMIC_RWA_SYMBOLS = new Set(rawEquityPerps.map(e => e.symbol.toUpperCase()));
export const DYNAMIC_RWA_SPECS = new Map();

/**
 * Configurable Correlation Groups for Multi-Asset and Leveraged/Inverse Risk Management
 */
export const CORRELATION_GROUPS = Object.freeze({
  NASDAQ_100: {
    id: 'NASDAQ_100',
    name: 'Nasdaq-100 ETF & Leveraged Derivatives',
    symbols: {
      'QQQUSDT': { underlying: 'QQQ', direction: 'LONG', leverage: 1, label: 'Unleveraged ETF' },
      'TQQQUSDT': { underlying: 'QQQ', direction: 'LONG', leverage: 3, label: '3x Leveraged Long' },
      'SQQQUSDT': { underlying: 'QQQ', direction: 'SHORT', leverage: 3, label: '3x Inverse Short' },
    },
  },
  SEMICONDUCTOR: {
    id: 'SEMICONDUCTOR',
    name: 'Semiconductors Bull / Bear 3x',
    symbols: {
      'SOXLUSDT': { underlying: 'SOX', direction: 'LONG', leverage: 3, label: '3x Leveraged Long' },
      'SOXSUSDT': { underlying: 'SOX', direction: 'SHORT', leverage: 3, label: '3x Inverse Short' },
    },
  },
  SP500: {
    id: 'SP500',
    name: 'S&P 500 Index Benchmark',
    symbols: {
      'SPYUSDT': { underlying: 'SPY', direction: 'LONG', leverage: 1, label: 'Core Benchmark ETF' },
    },
  },
});

/**
 * Returns correlation group metadata for a given symbol, if configured.
 * @param {string} symbol
 * @returns {Object|null}
 */
export function getCorrelationGroup(symbol) {
  if (!symbol) return null;
  const s = symbol.toUpperCase();
  for (const group of Object.values(CORRELATION_GROUPS)) {
    if (group.symbols[s]) {
      return {
        groupId: group.id,
        groupName: group.name,
        instrumentInfo: group.symbols[s],
        allGroupSymbols: Object.keys(group.symbols),
      };
    }
  }
  return null;
}

/**
 * Returns leveraged or inverse classification info for scanner badges.
 * @param {string} symbol
 * @returns {{ isLeveragedOrInverse: boolean, label: string|null, direction: string|null, leverage: number|null }}
 */
export function getLeveragedProductInfo(symbol) {
  const group = getCorrelationGroup(symbol);
  if (group && (group.instrumentInfo.leverage > 1 || group.instrumentInfo.direction === 'SHORT')) {
    return {
      isLeveragedOrInverse: true,
      label: group.instrumentInfo.label,
      direction: group.instrumentInfo.direction,
      leverage: group.instrumentInfo.leverage,
      groupId: group.groupId,
    };
  }
  return {
    isLeveragedOrInverse: false,
    label: null,
    direction: null,
    leverage: null,
    groupId: null,
  };
}

/**
 * Updates dynamic RWA symbols and contract specifications from live Bitget contracts data.
 * Emits logs for newly listed and delisted RWA contracts.
 * @param {Array<Object>} liveContracts
 * @returns {{ rwaCount: number, newlyListed: string[], delisted: string[] }}
 */
export function updateContractsFromLive(liveContracts) {
  if (!Array.isArray(liveContracts) || liveContracts.length === 0) {
    return { rwaCount: DYNAMIC_RWA_SYMBOLS.size, newlyListed: [], delisted: [] };
  }

  const previousRwa = new Set(DYNAMIC_RWA_SYMBOLS);
  const currentRwa = new Set();
  const newlyListed = [];

  for (const c of liveContracts) {
    const sym = c.symbol?.toUpperCase();
    if (!sym) continue;

    const isRwaContract = c.isRwa === 'YES' || c.isRwa === true || String(c.isRwa).toUpperCase() === 'YES';
    if (isRwaContract) {
      currentRwa.add(sym);
      DYNAMIC_RWA_SYMBOLS.add(sym);

      // Save or update real contract spec from Bitget exchange data
      DYNAMIC_RWA_SPECS.set(sym, {
        symbol: sym,
        minTradeNum: Number(c.minTradeNum || 0.01),
        sizeMultiplier: Number(c.sizeMultiplier || 0.01),
        pricePlace: Number(c.pricePlace || 2),
        volumePlace: Number(c.volumePlace || 2),
        priceEndStep: Number(c.priceEndStep || 1),
        maxTradeNum: Number(c.maxTradeNum || 10000),
        maxLever: Number(c.maxLever || 50),
        isRwa: 'YES',
        assetClass: 'EQUITY',
        symbolStatus: c.symbolStatus || 'normal',
      });

      if (!previousRwa.has(sym)) {
        newlyListed.push(sym);
      }
    }
  }

  const delisted = [];
  for (const sym of previousRwa) {
    if (!currentRwa.has(sym)) {
      delisted.push(sym);
    }
  }

  if (newlyListed.length > 0) {
    console.log(`[Contracts Audit] Detected ${newlyListed.length} newly listed RWA contracts:`, newlyListed.slice(0, 10).join(', ') + (newlyListed.length > 10 ? '...' : ''));
  }
  if (delisted.length > 0) {
    console.warn(`[Contracts Audit] Detected ${delisted.length} delisted RWA contracts:`, delisted.join(', '));
  }

  return {
    rwaCount: currentRwa.size,
    newlyListed,
    delisted,
  };
}

/**
 * Classifies an instrument as EQUITY or CRYPTO.
 * Primary classifier: Bitget's live isRwa flag and dynamic live RWA discovery.
 * Secondary / fallback: Curated allow-list config.
 * @param {string} symbol
 * @param {Object} [bitgetContract]
 * @returns {'EQUITY'|'CRYPTO'}
 */
export function classifyInstrument(symbol, bitgetContract = null) {
  if (!symbol || typeof symbol !== 'string') return 'CRYPTO';
  const s = symbol.toUpperCase().trim();

  // 1. Primary classifier: live contract object isRwa flag
  if (bitgetContract && (bitgetContract.isRwa === 'YES' || bitgetContract.isRwa === true || String(bitgetContract.isRwa).toUpperCase() === 'YES')) {
    return 'EQUITY';
  }

  // 2. Primary classifier: dynamic live-discovered RWA set
  if (DYNAMIC_RWA_SYMBOLS.has(s)) {
    return 'EQUITY';
  }

  // 3. Fallback / allow-list from equity-perps.json
  if (EQUITY_PERPS_MAP.has(s)) {
    return 'EQUITY';
  }

  return 'CRYPTO';
}

/**
 * Checks if a symbol represents an equity perpetual contract.
 * @param {string} symbol
 * @param {Object} [bitgetContract]
 * @returns {boolean}
 */
export function isEquityContract(symbol, bitgetContract = null) {
  return classifyInstrument(symbol, bitgetContract) === 'EQUITY';
}

/**
 * Checks if a symbol represents a crypto perpetual contract.
 * @param {string} symbol
 * @param {Object} [bitgetContract]
 * @returns {boolean}
 */
export function isCryptoContract(symbol, bitgetContract = null) {
  return classifyInstrument(symbol, bitgetContract) === 'CRYPTO';
}

/**
 * Validates whether an instrument is an eligible USDT perpetual contract.
 * @param {string} symbol
 * @returns {boolean}
 */
export function isEligibleContract(symbol) {
  if (!symbol || typeof symbol !== 'string') return false;
  const s = symbol.toUpperCase().trim();
  if (ELIGIBLE_CONTRACTS[s]) return Boolean(ELIGIBLE_CONTRACTS[s].isActive);
  if (DYNAMIC_RWA_SYMBOLS.has(s)) return true;
  // Support standard active USDT perpetual pairs (e.g. NEARUSDT, AVAXUSDT, PEPEUSDT)
  if (/^[A-Z0-9]+USDT$/.test(s) && !s.includes('_') && s.length >= 6) {
    return true;
  }
  return false;
}

/**
 * Gets verified contract specification for a symbol.
 * Uses real Bitget exchange parameters (minTradeNum, sizeMultiplier, pricePlace, volumePlace, maxLever)
 * for accurate sizing and rounding.
 * @param {string} symbol
 * @param {Object} [liveContractData]
 * @returns {Object|null}
 */
export function getContractSpec(symbol, liveContractData = null) {
  if (!symbol || typeof symbol !== 'string') return null;
  const s = symbol.toUpperCase().trim();

  let spec = null;
  if (ELIGIBLE_CONTRACTS[s]) {
    spec = { ...ELIGIBLE_CONTRACTS[s] };
  } else if (isEligibleContract(s)) {
    const assetClass = classifyInstrument(s, liveContractData);
    const baseCoin = s.replace(/USDT$/, '');
    spec = {
      symbol: s,
      baseCoin,
      underlyingTicker: baseCoin,
      quoteCoin: 'USDT',
      assetClass,
      productType: 'USDT-FUTURES',
      tickSize: 0.01,
      stepSize: 0.01,
      minOrderQty: 0.01,
      maxOrderQty: 500000,
      maxLeverage: 50,
      minNotional: 5.0,
      makerFeeRate: 0.0002,
      takerFeeRate: 0.0005,
      defaultFundingRate8h: 0.0001,
      baseSlippage: 0.0003,
      sessionStatus: 'NORMAL_24_7',
      isActive: true,
    };
  }

  // Check dynamic live-discovered RWA specs
  const dynamicSpec = DYNAMIC_RWA_SPECS.get(s);
  if (spec && dynamicSpec) {
    spec.stepSize = dynamicSpec.minTradeNum;
    spec.minOrderQty = dynamicSpec.minTradeNum;
    spec.maxLeverage = dynamicSpec.maxLever;
    spec.tickSize = Math.pow(10, -dynamicSpec.pricePlace);
    spec.volumePlace = dynamicSpec.volumePlace;
  }

  if (spec && liveContractData) {
    if (liveContractData.minTradeNum) spec.stepSize = Number(liveContractData.minTradeNum);
    if (liveContractData.minTradeNum) spec.minOrderQty = Number(liveContractData.minTradeNum);
    if (liveContractData.maxLever) spec.maxLeverage = Number(liveContractData.maxLever);
    if (liveContractData.pricePlace) spec.tickSize = Math.pow(10, -Number(liveContractData.pricePlace));
    if (liveContractData.volumePlace) spec.volumePlace = Number(liveContractData.volumePlace);
    if (liveContractData.symbolStatus) {
      spec.sessionStatus = liveContractData.symbolStatus === 'normal' ? 'NORMAL_24_7' : 'STALE/CLOSED';
      if (liveContractData.symbolStatus !== 'normal') spec.isActive = false;
    }
  }

  return spec;
}

/**
 * Startup check that validates configured equity symbols against live Bitget contracts.
 * Flags any unknown or delisted symbols and updates dynamic RWA state.
 * @param {Array<Object>} liveContracts
 * @returns {{ verifiedCount: number, totalCount: number, delistedSymbols: string[] }}
 */
export function validateContractsAgainstLive(liveContracts) {
  if (!Array.isArray(liveContracts) || liveContracts.length === 0) {
    return { verifiedCount: 0, totalCount: rawEquityPerps.length, delistedSymbols: [] };
  }

  // Update dynamic RWA database
  updateContractsFromLive(liveContracts);

  const liveMap = new Map(liveContracts.map(c => [c.symbol?.toUpperCase(), c]));
  const delistedSymbols = [];
  let verifiedCount = 0;

  for (const eq of rawEquityPerps) {
    const sym = eq.symbol.toUpperCase();
    const live = liveMap.get(sym);
    if (live) {
      verifiedCount++;
    } else {
      delistedSymbols.push(sym);
      console.warn(`[Contracts Audit] WARNING: Equity symbol ${sym} not found in Bitget live contracts! Marked delisted.`);
    }
  }

  return {
    verifiedCount,
    totalCount: rawEquityPerps.length,
    delistedSymbols,
  };
}
