import test from 'node:test';
import assert from 'node:assert/strict';
import { AutoTrader, BOT_STATUS } from '../src/execution/auto-trader.js';
import { PaperExecutionEngine } from '../src/execution/paper-engine.js';
import { StrategyEngine } from '../src/strategy/engine.js';
import { MultiAgentCoordinator } from '../src/agents/index.js';
import { Database } from '../src/storage/db.js';

test('AutoTrader starts in PAPER mode and halts when maxTradesPerDay is reached', async () => {
  const db = new Database(':memory:').init();
  const paper = new PaperExecutionEngine(10000);
  const strategy = new StrategyEngine();
  const coordinator = new MultiAgentCoordinator();

  const bot = new AutoTrader({
    db,
    paperEngine: paper,
    bitget: {
      checkHealth: async () => ({ isLive: true }),
      getLiveUniverseCandles: async () => ({}),
      forceFixtureMode: true,
    },
    strategy,
    coordinator,
  });

  // Start bot with maxTradesPerDay = 2
  bot.start({ maxTradesPerDay: 2, maxConcurrentPositions: 1 });
  assert.equal(bot.status, BOT_STATUS.RUNNING);
  assert.equal(bot.tradesToday, 0);

  // Simulate trade 1
  bot.tradesToday = 1;
  await bot.runCycle();
  assert.equal(bot.status, BOT_STATUS.RUNNING);

  // Simulate reaching trade 2
  bot.tradesToday = 2;
  await bot.runCycle();

  // Bot must pause automatically when quota is reached
  assert.equal(bot.status, BOT_STATUS.PAUSED);
  assert.ok(bot.pauseReason.includes('Daily trade quota reached'));
  bot.stop();
});

test('Stop Bot preserves open positions while Stop & Close All closes them', () => {
  const db = new Database(':memory:').init();
  const paper = new PaperExecutionEngine(10000);
  const bot = new AutoTrader({
    db,
    paperEngine: paper,
    bitget: {},
    strategy: new StrategyEngine(),
    coordinator: new MultiAgentCoordinator(),
  });

  // Seed open position
  paper.positions = [{
    id: 'pos-test-1',
    symbol: 'BTCUSDT',
    side: 'LONG',
    entryPrice: 60000,
    currentPrice: 60500,
    currentQuantity: 0.05,
    stopLoss: 59600,
    takeProfit: 61500,
    status: 'OPEN',
  }];

  // 1. Stop Bot keeps open position
  bot.start();
  bot.stop('TEST_STOP');
  assert.equal(bot.status, BOT_STATUS.STOPPED);
  assert.equal(paper.positions.length, 1);

  // 2. Stop Bot and Close All closes all positions
  bot.start();
  const closeAllResult = bot.stopAndCloseAll();
  assert.equal(bot.status, BOT_STATUS.STOPPED);
  assert.equal(paper.positions.length, 0);
  assert.equal(closeAllResult.closedPositionsCount, 1);
});

test('Master Kill Switch engages emergency halt and closes all open positions', () => {
  const db = new Database(':memory:').init();
  const paper = new PaperExecutionEngine(10000);
  const bot = new AutoTrader({
    db,
    paperEngine: paper,
    bitget: {},
    strategy: new StrategyEngine(),
    coordinator: new MultiAgentCoordinator(),
  });

  paper.positions = [
    {
      id: 'pos-k1',
      symbol: 'BTCUSDT',
      side: 'LONG',
      entryPrice: 60000,
      currentPrice: 60500,
      currentQuantity: 0.05,
      stopLoss: 59600,
      takeProfit: 61500,
      status: 'OPEN',
    },
    {
      id: 'pos-k2',
      symbol: 'ETHUSDT',
      side: 'LONG',
      entryPrice: 3000,
      currentPrice: 3050,
      currentQuantity: 1.0,
      stopLoss: 2950,
      takeProfit: 3150,
      status: 'OPEN',
    },
  ];

  bot.start();
  const killResult = bot.killSwitch();

  assert.equal(bot.status, BOT_STATUS.STOPPED);
  assert.equal(paper.positions.length, 0);
  assert.equal(killResult.killedPositionsCount, 2);
});
