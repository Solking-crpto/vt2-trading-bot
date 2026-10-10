import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { VT2Server } from './src/server.js';

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

// Launch server if executed as entry point
if (process.argv[1] && path.resolve(fileURLToPath(import.meta.url)) === path.resolve(process.argv[1])) {
  const server = new VT2Server();
  server.start();
}
