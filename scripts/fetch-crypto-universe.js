import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

function run() {
  console.log('Querying Bitget USDT-FUTURES tickers via curl...');
  const url = 'https://api.bitget.com/api/v2/mix/market/tickers?productType=USDT-FUTURES';
  const tmpFile = path.resolve('data/history/temp_tickers.json');
  execSync(`curl.exe -s --max-time 30 -o "${tmpFile}" "${url}"`);
  const raw = fs.readFileSync(tmpFile, 'utf8');
  try { fs.unlinkSync(tmpFile); } catch {}

  const parsed = JSON.parse(raw);
  if (parsed.code !== '00000') {
    throw new Error(`Bitget error: ${parsed.msg || parsed.code}`);
  }

  // Non-crypto exclusion set (equities, commodities, leveraged ETFs)
  const nonCrypto = new Set([
    'SPYUSDT', 'QQQUSDT', 'NVDAUSDT', 'TSLAUSDT', 'AAPLUSDT',
    'MSFTUSDT', 'AMZNUSDT', 'PLTRUSDT', 'SOXLUSDT', 'SQQQUSDT',
    'MUUSDT', 'AMDUSDT', 'SNDKUSDT', 'SMCIUSDT', 'AVGOUSDT',
    'QCOMUSDT', 'WMTUSDT', 'COSTUSDT', 'RKLBUSDT', 'VLOUSDT', 'BPUSDT',
    'CSTOCKUSDT', 'MDTUSDT', 'WALSINUSDT', 'YAGEOUSDT', 'WINBONDUSDT',
    'NANYAUSDT', 'TWUMCUSDT', 'TWASXUSDT', 'TWDELTAUSDT', 'TWTSMUSDT',
    'JIOUSDT', 'FASTRETAILINGUSDT', 'JPSONYUSDT', 'TAIYOYUDENUSDT',
    'KORUUSDT', 'XAUUSDT', 'SKHYNIXUSDT', 'SKHYUSDT', 'XAGUSDT', 'OILUSDT',
  ]);

  const tickers = parsed.data || [];
  const pureCrypto = tickers.filter(t => !nonCrypto.has(t.symbol) && t.symbol.endsWith('USDT'));
  pureCrypto.sort((a, b) => parseFloat(b.usdtVolume || 0) - parseFloat(a.usdtVolume || 0));

  const top10 = pureCrypto.slice(0, 10).map((t, i) => ({
    rank: i + 1,
    symbol: t.symbol,
    lastPrice: parseFloat(t.lastPr),
    usdtVolume24h: parseFloat(t.usdtVolume),
    high24h: parseFloat(t.high24h),
    low24h: parseFloat(t.low24h),
    assetClass: 'CRYPTO',
    productType: 'USDT-FUTURES',
  }));

  console.log('\n========================================================================');
  console.log('FROZEN TOP 10 CRYPTO USDT-FUTURES PERPETUALS (BY 24H VOLUME)');
  console.log('========================================================================');
  console.table(top10);

  const outPath = path.resolve('config/crypto-perps.json');
  fs.writeFileSync(outPath, JSON.stringify(top10, null, 2));
  console.log(`Saved frozen list to ${outPath}\n`);
}

run();
