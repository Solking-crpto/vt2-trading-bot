import fs from 'node:fs';
import path from 'node:path';
import { isRegularTradingHours } from '../strategy/v2/session-filter.js';

const PROFILES_PATH = path.resolve('config/profiles.json');

let cachedProfiles = null;

export function loadProfiles() {
  if (!cachedProfiles) {
    if (fs.existsSync(PROFILES_PATH)) {
      cachedProfiles = JSON.parse(fs.readFileSync(PROFILES_PATH, 'utf8'));
    } else {
      cachedProfiles = {
        crypto: {
          assetClass: 'crypto',
          name: 'Crypto Futures',
          tradingHours: '24/7',
          maxLeverage: 5,
          showFundingRateOnPreview: true,
          feeRatesSource: 'CONTRACT_SPEC',
          maxDailyTrades: 5,
          maxNotionalPerOrderUsd: 50,
          gapRiskWarning: false,
          demoSupported: true,
          demoSymbolPrefix: 'S',
          demoProductType: 'susdt-futures',
          demoMarginCoin: 'SUSDT',
        },
        equity: {
          assetClass: 'equity',
          name: 'Tokenized US Equity Perps',
          tradingHours: '24/7_UNDERLYING_RTH',
          timezone: 'America/New_York',
          maxLeverage: 3,
          underlyingMarketOpen: '09:30',
          underlyingMarketClose: '16:00',
          showUnderlyingMarketBadge: true,
          equityEntriesWhenUnderlyingClosed: 'ALLOW_WITH_WARNING',
          gapRiskNoteOnPreview: true,
          gapRiskWarning: 'Overnight & weekend holds carry equity gap risk upon US market open.',
          maxDailyTrades: 3,
          maxNotionalPerOrderUsd: 50,
          feeRatesSource: 'CONTRACT_SPEC',
          demoSupported: false,
          demoUnavailableReason: 'Equities: PAPER only, no Bitget demo contracts',
        },
      };
    }
  }
  return cachedProfiles;
}

export function getProfileForSymbol(symbol) {
  const profiles = loadProfiles();
  const cleanSym = (symbol || '').toUpperCase();

  const isCrypto =
    cleanSym.startsWith('BTC') ||
    cleanSym.startsWith('ETH') ||
    cleanSym.startsWith('SOL') ||
    cleanSym.startsWith('XRP') ||
    cleanSym.startsWith('DOGE') ||
    cleanSym.startsWith('SBTC') ||
    cleanSym.startsWith('SETH') ||
    cleanSym.startsWith('SXRP');

  return isCrypto ? profiles.crypto : profiles.equity;
}

export function getUnderlyingMarketStatus(timestamp = Date.now()) {
  const isOpen = isRegularTradingHours(timestamp, 'EQUITY');
  return {
    isOpen,
    session: isOpen ? 'OPEN' : 'CLOSED',
    timezone: 'America/New_York',
    rthSchedule: '09:30 - 16:00 ET (Mon-Fri, ex. NYSE Holidays)',
  };
}
