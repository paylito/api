import { BigNumber } from 'bignumber.js';

import { NETWORKS } from './tokens';
import { randomBytes } from 'crypto';
import { envs } from '../configs/envs';
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

export const getServiceFee = () => {
  const { SERVICE_FEE } = envs();

  return new BigNumber(SERVICE_FEE);
};

export const getPricing = async (order: IOrder, rates: IRates) => {
  const feeConfigsArr = await FeeConfig.find();

  const serviceFeeUsd = getServiceFee();

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

        const totalUsd = new BigNumber(order.amount).plus(serviceFeeUsd).plus(networkFeeUsd);

        return {
          symbol: token.symbol,
          priceUsd: new BigNumber(priceUsd).toString(),

          amountUsd: new BigNumber(order.amount).toString(),
          amount: new BigNumber(order.amount).div(priceUsd).toString(),

          serviceFeeUsd: serviceFeeUsd.toString(),
          serviceFee: serviceFeeUsd.div(priceUsd).toString(),

          networkFeeUsd: networkFeeUsd.toString(),
          networkFee: networkFeeUsd.div(priceUsd).toString(),

          totalUsd: totalUsd.toString(),
          total: totalUsd.div(priceUsd).toString(),
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
