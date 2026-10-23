/**
 * Session filter for Tokenized US Equities.
 * Accurately determines if a UTC timestamp falls within US Regular Trading Hours (RTH)
 * in America/New_York timezone (09:30 to 16:00 ET, Monday-Friday, excluding NYSE holidays).
 */

const NYSE_HOLIDAYS_2026 = new Set([
  '2026-01-01', // New Year's Day
  '2026-01-19', // Martin Luther King, Jr. Day
  '2026-02-16', // Washington's Birthday
  '2026-04-03', // Good Friday
  '2026-05-25', // Memorial Day
  '2026-06-19', // Juneteenth National Independence Day
  '2026-07-03', // Independence Day (Observed)
  '2026-09-07', // Labor Day
  '2026-11-26', // Thanksgiving Day
  '2026-12-25', // Christmas Day
]);

const nyFormatter = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/New_York',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
});

/**
 * Checks if a given timestamp is within US Regular Trading Hours (09:30 - 16:00 ET).
 * @param {number} timestamp - Epoch timestamp in ms
 * @param {string} assetClass - 'EQUITY' or 'CRYPTO'
 * @returns {boolean}
 */
export function isRegularTradingHours(timestamp, assetClass = 'EQUITY') {
  if (assetClass === 'CRYPTO') {
    return true; // Crypto trades 24/7 continuous
  }

  const d = new Date(timestamp);
  const parts = nyFormatter.formatToParts(d);
  const partMap = {};
  for (const p of parts) {
    partMap[p.type] = p.value;
  }

  const year = partMap.year;
  const month = partMap.month;
  const day = partMap.day;
  const hour = parseInt(partMap.hour, 10);
  const minute = parseInt(partMap.minute, 10);

  const dateStr = `${year}-${month}-${day}`;
  if (NYSE_HOLIDAYS_2026.has(dateStr)) {
    return false;
  }

  // Day of week in NY
  // Construct date in NY to get weekday
  const nyDate = new Date(`${dateStr}T12:00:00Z`);
  const dayOfWeek = nyDate.getUTCDay(); // 0 = Sun, 6 = Sat
  if (dayOfWeek === 0 || dayOfWeek === 6) {
    return false;
  }

  const minutesFromMidnight = hour * 60 + minute;
  const marketOpen = 9 * 60 + 30; // 09:30
  const marketClose = 16 * 60;    // 16:00

  return minutesFromMidnight >= marketOpen && minutesFromMidnight < marketClose;
}
