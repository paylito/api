import { logger } from '../configs/logger';
import { IRates, Rates } from '../models/Rates';

const symbols = [
  'BTCUSDT',
  'ETHUSDT',
  'SOLUSDT',
  'BNBUSDT',
  'XLMUSDT',
  'TRXUSDT',
  'CELOUSDT',
  'POLUSDT',
  'DAIUSDT',
  'USDCUSDT',
];

const BINANCE_BASE_URL = 'https://api.binance.com/api/v3/ticker/price?symbols=';
const COINBASE_USDT_URL = 'https://api.coinbase.com/v2/exchange-rates?currency=USDT';

export async function getRates() {
  try {
    const binanceRes = await fetch(`${BINANCE_BASE_URL}${JSON.stringify(symbols)}`);
    const binanceData: Array<{ symbol: string; price: string }> = await binanceRes.json();

    const usdtRes = await fetch(COINBASE_USDT_URL);
    const usdtData = await usdtRes.json();

    const usdtToUsd = parseFloat(usdtData.data.rates.USD);
    const pricesInUsd: Record<string, number> = {};

    for (const item of binanceData) {
      const priceInUsdt = parseFloat(item.price);

      pricesInUsd[item.symbol.slice(0, -4)] = priceInUsdt * usdtToUsd;
    }

    pricesInUsd.USDT = usdtToUsd;

    // @ts-ignore
    return pricesInUsd as IRates;
  } catch (e) {
    logger.error('Failed to get the rates.');
    return null;
  }
}

export async function getAndStoreRates() {
  try {
    const rates = await getRates();
    const newRates = new Rates(rates);

    await newRates.save();

    logger.info('Saved the rates in db.');
  } catch (e) {
    logger.error('Failed to save the rates in db.');
  }
}
