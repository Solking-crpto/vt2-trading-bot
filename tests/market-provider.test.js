import test from 'node:test';
import assert from 'node:assert/strict';
import { BitgetCryptoProvider, StockMarketProvider } from '../src/adapters/market-provider.js';

test('BitgetCryptoProvider reports 24/7 continuous session', () => {
  const provider = new BitgetCryptoProvider({
    checkHealth: async () => ({ isLive: true }),
    forceFixtureMode: true,
  });

  const session = provider.getSessionState();
  assert.equal(session.isOpen, true);
  assert.equal(session.session, '24_7');
  assert.equal(session.canGenerateSignals, true);
});

test('StockMarketProvider models US market hours for underlying and 24/7 continuous for perpetuals', () => {
  const provider = new StockMarketProvider({ allowExtendedHours: false });

  // 1. Default session for tokenized equity perpetuals is 24/7 continuous
  const perpSession = provider.getSessionState();
  assert.equal(perpSession.isOpen, true);
  assert.equal(perpSession.session, '24_7');
  assert.equal(perpSession.canGenerateSignals, true);

  // 2. Underlying market regular hours (Wednesday 11:30 AM ET)
  const wedRegular = new Date('2026-10-14T15:30:00Z');
  const regSession = provider.getSessionState(wedRegular);
  assert.equal(regSession.isOpen, true);
  assert.equal(regSession.session, 'REGULAR');
  assert.equal(regSession.canGenerateSignals, true);

  // 3. Underlying market weekend (Saturday -> exchanges closed)
  const satClosed = new Date('2026-10-17T16:00:00Z');
  const satSession = provider.getSessionState(satClosed);
  assert.equal(satSession.isOpen, false);
  assert.equal(satSession.session, 'CLOSED');
  assert.equal(satSession.canGenerateSignals, false);
});

test('StockMarketProvider formats order quantity strictly according to contract rules rather than whole shares', () => {
  const provider = new StockMarketProvider();

  // Real Bitget contract rules for SPYUSDT (stepSize: 0.01)
  assert.equal(provider.formatQuantity(14.85239, 'SPYUSDT'), 14.85);
  assert.equal(provider.formatQuantity(0.019, 'SPYUSDT'), 0.01);

  // Real Bitget contract rules for NVDAUSDT (stepSize: 0.01)
  assert.equal(provider.formatQuantity(2.3489, 'NVDAUSDT'), 2.34);

  // Real Bitget contract rules for TSLAUSDT (stepSize: 0.01)
  assert.equal(provider.formatQuantity(0.551, 'TSLAUSDT'), 0.55);
});
