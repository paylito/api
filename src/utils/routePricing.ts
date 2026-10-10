import { BigNumber } from 'bignumber.js';
import { NETWORKS, TOKENS, getTokenDecimals } from './tokens';
import { getLifiConfig, lifiRequest } from './lifiRequest';

const NATIVE = '0x0000000000000000000000000000000000000000';

/** Kept identical in API and bot. Quote costs before showing a deposit amount. */
export const quotePaymentCost = async (
  order: { amount: string; smartAccount: string; destinationNetwork: string; destinationToken: string; destinationAddress: string },
  rates: Record<string, unknown>,
  networkId: string,
  symbol: string,
  baseFeeUsd: InstanceType<typeof BigNumber>,
): Promise<InstanceType<typeof BigNumber>> => {
  if (networkId === order.destinationNetwork && symbol === order.destinationToken) return baseFeeUsd;
  const source = NETWORKS[networkId as keyof typeof NETWORKS];
  const dest = NETWORKS[order.destinationNetwork as keyof typeof NETWORKS];
  const fromToken = TOKENS[symbol as keyof typeof TOKENS];
  const toToken = TOKENS[order.destinationToken as keyof typeof TOKENS];
  const sourcePrice = new BigNumber(String(rates[symbol]));
  const destPrice = new BigNumber(String(rates[order.destinationToken]));
  if (!source || !dest || !('chainId' in source) || !('chainId' in dest) || source.type !== 'evm' || dest.type !== 'evm' || !fromToken || !toToken ||
      !sourcePrice.isFinite() || !sourcePrice.gt(0) || !destPrice.isFinite() || !destPrice.gt(0)) {
    throw new Error('Unsupported payment route');
  }
  const fromAddress = fromToken.isNative ? NATIVE : (fromToken.contractAddresses as Record<string, string>)[networkId];
  const toAddress = toToken.isNative ? NATIVE : (toToken.contractAddresses as Record<string, string>)[order.destinationNetwork];
  if (!fromAddress || !toAddress) throw new Error('Missing route token address');
  const decimals = getTokenDecimals(symbol, networkId);
  const target = new BigNumber(order.amount).div(destPrice).shiftedBy(getTokenDecimals(order.destinationToken, order.destinationNetwork)).integerValue(BigNumber.ROUND_UP);
  // This is conversion/execution cost recovery, independent of the service fee.
  const marginUsd = BigNumber.maximum(new BigNumber(order.amount).times('0.01'), '0.05');
  const coreRaw = new BigNumber(order.amount).div(sourcePrice).shiftedBy(decimals);
  let input = coreRaw.plus(baseFeeUsd.plus(marginUsd).div(sourcePrice).shiftedBy(decimals)).integerValue(BigNumber.ROUND_UP);
  const { integrator } = getLifiConfig();
  for (let i = 0; i < 4; i += 1) {
    const query = new URLSearchParams({
      fromChain: String(source.chainId), toChain: String(dest.chainId), fromToken: fromAddress, toToken: toAddress,
      fromAmount: input.toFixed(0), fromAddress: order.smartAccount, toAddress: order.destinationAddress,
      integrator, slippage: process.env.LIFI_SLIPPAGE || '0.005',
      order: 'CHEAPEST', skipSimulation: 'true',
    });
    const response = await lifiRequest('quote', query, 10_000);
    const quote = await response.json() as { estimate: { fromAmount: string; toAmountMin: string }; transactionRequest: { value?: string } };
    const floor = new BigNumber(quote.estimate.toAmountMin);
    const used = new BigNumber(quote.estimate.fromAmount);
    const callValue = new BigNumber(quote.transactionRequest.value || '0');
    if (!floor.isFinite() || !floor.gt(0) || !used.eq(input) || !callValue.isFinite() || callValue.lt(0)) throw new Error('Invalid payment route quote');
    // Paymaster sponsorship pays gas, not native value required by a bridge.
    if (!fromToken.isNative && !callValue.isZero()) throw new Error('Route requires an extra native deposit');
    if (fromToken.isNative && callValue.gt(input)) input = callValue.integerValue(BigNumber.ROUND_UP);
    if (floor.gte(target)) {
      return BigNumber.maximum(baseFeeUsd, input.minus(coreRaw).shiftedBy(-decimals).times(sourcePrice).plus(marginUsd));
    }
    input = input.times(target.div(floor)).plus(marginUsd.div(sourcePrice).shiftedBy(decimals)).integerValue(BigNumber.ROUND_UP);
  }
  throw new Error('Payment route cannot cover the merchant amount');
};
