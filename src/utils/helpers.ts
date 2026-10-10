import { BigNumber } from 'bignumber.js';

import { NETWORKS } from './tokens';
import { quotePaymentCost } from './routePricing';
import { randomBytes } from 'crypto';
import { logger } from '../configs/logger';
import { FeeConfig } from '../models/FeeConfig';
import { IRates, Rates } from '../models/Rates';
import { IOrder, IOrderPricing } from '../models/Order';

export const createShortId = () => {
  return randomBytes(5).toString('hex');
};

export const getLatestRates = async (): Promise<IRates | null> => {
  try {
    const latestRates = await Rates.findOne().sort({ createdAt: -1 });

    return latestRates;
  } catch (error) {
    logger.error('Error fetching latest rates:', error);

    throw new Error('Failed to fetch latest rates');
  }
};

const DEFAULT_SERVICE_FEE_PERCENTAGE = 3;
const DEFAULT_SERVICE_FEE_MAX = 6;

// Platform service fee: SERVICE_FEE_PERCENTAGE percent of the order amount,
// capped at SERVICE_FEE_MAX dollars. Both are optional (read from process.env
// like the other optional config) and default to 3% / $6 — so the cap is reached
// at $200, e.g. $80 -> $2.40, $500 -> $6.00.
export const getServiceFeeConfig = () => ({
  percentage: new BigNumber(process.env.SERVICE_FEE_PERCENTAGE || DEFAULT_SERVICE_FEE_PERCENTAGE),
  cap: new BigNumber(process.env.SERVICE_FEE_MAX || DEFAULT_SERVICE_FEE_MAX),
});

export const getServiceFee = (amountUsd: string | number) => {
  const { percentage, cap } = getServiceFeeConfig();

  const fee = new BigNumber(amountUsd).times(percentage).div(100);

  return BigNumber.minimum(fee, cap);
};

export const getPricing = async (order: IOrder, rates: IRates) => {
  const configs = await FeeConfig.find();
  const serviceFeeUsd = getServiceFee(order.amount);
  const pricing: IOrderPricing = [];
  for (const cfg of configs) {
    const network = NETWORKS[cfg.network as keyof typeof NETWORKS];
    if (!network || !network.isAllowed || !network.supportedTokens.length) continue;
    const baseFeeUsd = new BigNumber(cfg.minFee);
    // At most three concurrent provider requests. Keep one fee per network so
    // the existing checkout breakdown remains accurate for every offered token.
    const quoted = await Promise.all(network.supportedTokens.map(async (token) => {
      try {
        const fee = await quotePaymentCost(order, rates as unknown as Record<string, unknown>, network.id, token.symbol, baseFeeUsd);
        return { token, fee };
      } catch (error) {
        logger.warn(`Payment option unavailable: ${network.id}/${token.symbol}: ${(error as Error).message}`);
        return null;
      }
    }));
    const available = quoted.filter((entry): entry is NonNullable<typeof entry> => entry !== null);
    if (!available.length) continue;
    const networkFeeUsd = BigNumber.maximum(baseFeeUsd, ...available.map(entry => entry.fee));
    const tokens = available.map(({ token }) => {
      const price = new BigNumber(String(rates[token.symbol as keyof IRates]));
      if (!price.isFinite() || !price.gt(0)) throw new Error(`Missing rate for ${token.symbol}`);
      const dp = token.acceptableDecimals;
      const amount = new BigNumber(order.amount).div(price).decimalPlaces(dp, BigNumber.ROUND_UP);
      const serviceFee = serviceFeeUsd.div(price).decimalPlaces(dp, BigNumber.ROUND_UP);
      const networkFee = networkFeeUsd.div(price).decimalPlaces(dp, BigNumber.ROUND_UP);
      return {
        symbol: token.symbol, priceUsd: price.toString(), amountUsd: new BigNumber(order.amount).toString(), amount: amount.toString(),
        serviceFeeUsd: serviceFeeUsd.toString(), serviceFee: serviceFee.toString(),
        networkFeeUsd: networkFeeUsd.toString(), networkFee: networkFee.toString(),
        totalUsd: new BigNumber(order.amount).plus(serviceFeeUsd).plus(networkFeeUsd).toString(),
        total: amount.plus(serviceFee).plus(networkFee).toString(),
      };
    });
    pricing.push({ network: network.id, networkFeeUsd: networkFeeUsd.toString(), tokens });
  }
  if (!pricing.length) throw new Error('No executable payment routes available. Please try again later.');
  return pricing;
};
