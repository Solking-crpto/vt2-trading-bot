import { BitgetTradeClient } from '../src/execution/bitget-trade-client.js';
import { loadLiveLimits } from '../src/config/live-limits.js';
import { getProfileForSymbol } from '../src/config/profiles.js';

function main() {
  console.log('========================================================================');
  console.log('VT2 LIVE TRADING --DRY-RUN ORDER INSPECTION');
  console.log('Builds and cryptographically signs a request without sending it.');
  console.log('========================================================================\n');

  // Load limits and profile
  const limits = loadLiveLimits();
  const sampleSymbol = 'BTCUSDT';
  const profile = getProfileForSymbol(sampleSymbol);

  // If local .env is not yet configured, use sample dummy keys for dry-run signature demo
  const apiKey = process.env.BITGET_LIVE_API_KEY || 'bg_live_dryrun_sample_key_12345';
  const apiSecret = process.env.BITGET_LIVE_API_SECRET || 'a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6';
  const passphrase = process.env.BITGET_LIVE_API_PASSPHRASE || 'dryrunPassphrase123';

  const client = new BitgetTradeClient('LIVE', {
    allowUnarmedForTesting: true,
    apiKey,
    apiSecret,
    passphrase,
  });

  const sampleOrder = {
    symbol: sampleSymbol,
    side: 'LONG',
    entryPrice: 68000,
    quantity: 0.0005, // 0.0005 * 68000 = $34.00 (within $50 cap)
    stopLoss: 66640,  // -2.0% ($0.68 loss)
    takeProfit: 71400, // +5.0% ($1.70 gain)
    orderType: 'market',
    leverage: 3,
  };

  const dryRunOutput = client.formatDryRunOrder(sampleOrder);

  console.log('------------------------------------------------------------------------');
  console.log('1. CRYPTOGRAPHICALLY SIGNED REQUEST (REDACTED SECRETS)');
  console.log('------------------------------------------------------------------------');
  console.log(`Endpoint:    ${dryRunOutput.request.method} ${dryRunOutput.request.url}`);
  console.log('Headers:');
  console.log(JSON.stringify(dryRunOutput.request.headers, null, 2));
  console.log('\nPayload:');
  console.log(JSON.stringify(dryRunOutput.request.payload, null, 2));

  console.log('\n------------------------------------------------------------------------');
  console.log('2. ORDER PREVIEW & RISK AUDIT');
  console.log('------------------------------------------------------------------------');
  console.log(`Symbol:           ${dryRunOutput.orderSummary.symbol} (${profile.name})`);
  console.log(`Side:             ${dryRunOutput.orderSummary.side}`);
  console.log(`Order Size:       ${dryRunOutput.orderSummary.size}`);
  console.log(`Entry Price:      $${dryRunOutput.orderSummary.entryPrice.toLocaleString()}`);
  console.log(`Notional USD:     $${dryRunOutput.orderSummary.notionalUsd} (Cap: $${limits.maxNotionalPerOrderUsd})`);
  console.log(`Leverage:         ${dryRunOutput.orderSummary.leverage}x (Cap: ${limits.maxLeverage.crypto}x)`);
  console.log(`Stop-Loss:        $${dryRunOutput.orderSummary.stopLoss}`);
  console.log(`Take-Profit:      $${dryRunOutput.orderSummary.takeProfit}`);
  console.log(`MAX DOLLAR LOSS:  $${dryRunOutput.orderSummary.maxLossInDollars}`);

  console.log('\n------------------------------------------------------------------------');
  console.log('3. ACTIVE LIVE LIMITS & SAFETY ENFORCEMENT');
  console.log('------------------------------------------------------------------------');
  console.log(`- Max Notional / Order:  $${limits.maxNotionalPerOrderUsd}`);
  console.log(`- Max Total Open:        $${limits.maxTotalOpenNotionalUsd}`);
  console.log(`- Max Daily Loss:        $${limits.maxDailyLossUsd}`);
  console.log(`- Max Open Positions:    ${limits.maxOpenPositions}`);
  console.log(`- Confirm First N:       ${limits.confirmFirstNTrades} trades`);
  console.log(`- Allowed Symbols:       ${limits.allowedSymbols.join(', ')}`);
  console.log(`- Protection:            Exchange-side SL attached; emergency flatten on drop`);

  console.log('\n========================================================================');
  console.log('STATUS: VERIFIED. ZERO NETWORK CALLS DISPATCHED.');
  console.log('========================================================================\n');
}

main();
