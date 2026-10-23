import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { VT2Server } from './src/vt2-server.js';
import { setupDailyLogRotation } from './src/service/log-rotator.js';

export { VT2Server };
export * from './src/risk-engine.js';
export * from './src/environment.js';
export * from './src/config/contracts.js';
export * from './src/adapters/bitget-adapter.js';
export * from './src/indicators/index.js';
export * from './src/strategy/engine.js';
export * from './src/agents/index.js';
export * from './src/execution/paper-engine.js';
export * from './src/backtest/engine.js';
export * from './src/storage/db.js';

// Launch server if executed as entry point or managed by PM2
const isDirectEntry = Boolean(process.argv[1] && path.resolve(fileURLToPath(import.meta.url)) === path.resolve(process.argv[1]));
const isPm2Entry = typeof process.env.pm_id !== 'undefined';
if (isDirectEntry || isPm2Entry) {
  setupDailyLogRotation(14);
  const server = new VT2Server();
  server.start();

  let isShuttingDown = false;
  const handleShutdown = async (signal) => {
    if (isShuttingDown) return;
    isShuttingDown = true;
    console.log(`\n[VT2 Service] Received ${signal}. Executing graceful shutdown...`);
    try {
      await server.stop();
      console.log('[VT2 Service] Graceful shutdown complete. Exiting clean.');
      process.exit(0);
    } catch (err) {
      console.error('[VT2 Service] Error during graceful shutdown:', err);
      process.exit(1);
    }
  };

  process.on('SIGTERM', () => handleShutdown('SIGTERM'));
  process.on('SIGINT', () => handleShutdown('SIGINT'));
}
