import { BigNumber } from 'bignumber.js';

import { NETWORKS } from './tokens';
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
  const feeConfigsArr = await FeeConfig.find();

  const serviceFeeUsd = getServiceFee(order.amount);

  const pricing = feeConfigsArr
    .map((cfg) => {
      const network = NETWORKS[cfg.network as keyof typeof NETWORKS];

      if (!network) return null;

      const networkFeeUsd = new BigNumber(cfg.minFee);

      const tokens = network.supportedTokens.map((token) => {
        const priceUsd = rates[token.symbol as keyof IRates] as number;

        if (!priceUsd) {
          throw new Error(`Missing rate for ${token.symbol}`);
        }

        // Convert each USD figure to the token, rounding UP to the token's
        // acceptable precision (3 dp for stablecoins, 4 otherwise). Rounding up
        // keeps the payer at/above the true cost; the total is the sum of the
        // rounded parts, so the displayed breakdown adds up exactly to the amount
        // the gateway charges and the listener verifies.
        const dp = token.acceptableDecimals;
        const price = new BigNumber(priceUsd);

        const amount = new BigNumber(order.amount).div(price).decimalPlaces(dp, BigNumber.ROUND_UP);
        const serviceFee = serviceFeeUsd.div(price).decimalPlaces(dp, BigNumber.ROUND_UP);
        const networkFee = networkFeeUsd.div(price).decimalPlaces(dp, BigNumber.ROUND_UP);
        const total = amount.plus(serviceFee).plus(networkFee);

        const totalUsd = new BigNumber(order.amount).plus(serviceFeeUsd).plus(networkFeeUsd);

        return {
          symbol: token.symbol,
          priceUsd: price.toString(),

          amountUsd: new BigNumber(order.amount).toString(),
          amount: amount.toString(),

          serviceFeeUsd: serviceFeeUsd.toString(),
          serviceFee: serviceFee.toString(),

          networkFeeUsd: networkFeeUsd.toString(),
          networkFee: networkFee.toString(),

          totalUsd: totalUsd.toString(),
          total: total.toString(),
        };
      });

      return {
        network: network.id,
        networkFeeUsd: networkFeeUsd.toString(),
        tokens,
      };
    })
    .filter(Boolean) as IOrderPricing;

  return pricing;
};
