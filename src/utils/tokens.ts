/**
 * Token + network catalog. This file is kept IDENTICAL across the listener,
 * api, and telegram-payment-gateway services — they are separate deployables
 * that share one database, so a drifted copy surfaces as pricing/settlement
 * disagreements. When you change it here, copy it to the other two.
 *
 * `supportedTokens` per network is the single menu that drives what payers can
 * pay with, what merchants can receive as a destination, and what the listener
 * monitors:
 *   - ethereum / arbitrum / optimism: USDC, USDT, ETH
 *   - base:                           USDC, ETH (USDT deliberately not offered)
 *   - bsc / polygon:                  USDC, USDT only (native BNB/POL excluded)
 */

enum NETWORK_NAMES {
  Ethereum = 'ethereum',
  Bsc = 'bsc',
  Polygon = 'polygon',
  Base = 'base',
  Arbitrum = 'arbitrum',
  Optimism = 'optimism',
  Celo = 'celo',
  Solana = 'solana',
  Bitcoin = 'bitcoin',
  Stellar = 'stellar',
  Tron = 'tron',
}

export const TOKENS = {
  USDC: {
    isAllowed: true,
    symbol: 'USDC',
    name: 'USD Coin',
    decimals: 6,
    acceptableDecimals: 3,
    isNative: false,
    // BSC's Binance-Peg USDC is an 18-decimal BEP20, unlike the 6-decimal
    // deployments everywhere else. Raw-unit math must resolve decimals through
    // getTokenDecimals(symbol, network) — reading `decimals` directly would
    // misread BSC amounts by a factor of 10^12.
    decimalsByNetwork: {
      [NETWORK_NAMES.Bsc]: 18,
    },
    contractAddresses: {
      [NETWORK_NAMES.Ethereum]: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
      [NETWORK_NAMES.Bsc]: '0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d',
      // Circle-native USDC on Polygon PoS — NOT the bridged USDC.e
      // (0x2791...4174), which exchanges are migrating away from.
      [NETWORK_NAMES.Polygon]: '0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359',
      [NETWORK_NAMES.Base]: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
      [NETWORK_NAMES.Arbitrum]: '0xaf88d065e77c8cC2239327C5EDb3A432268e5831',
      [NETWORK_NAMES.Optimism]: '0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85',
      [NETWORK_NAMES.Celo]: '0xcebA9300f2b948710d2653dD7B07f33A8B32118C',
    },
  },
  USDT: {
    isAllowed: true,
    symbol: 'USDT',
    name: 'Tether USD',
    decimals: 6,
    acceptableDecimals: 3,
    isNative: false,
    // Binance-Peg USDT on BSC is 18-decimal (see USDC note above).
    decimalsByNetwork: {
      [NETWORK_NAMES.Bsc]: 18,
    },
    // Base keeps its USDT address here even though base's supportedTokens no
    // longer offers USDT: a destination saved before that change must still
    // resolve at settlement time.
    contractAddresses: {
      [NETWORK_NAMES.Ethereum]: '0xdAC17F958D2ee523a2206206994597C13D831ec7',
      [NETWORK_NAMES.Bsc]: '0x55d398326f99059fF775485246999027B3197955',
      [NETWORK_NAMES.Polygon]: '0xc2132D05D31c914a87C6611C10748AEb04B58e8F',
      [NETWORK_NAMES.Base]: '0xfde4C96c8593536E31F229EA8f37b2ADa2699bb2',
      [NETWORK_NAMES.Arbitrum]: '0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9',
      [NETWORK_NAMES.Optimism]: '0x94b008aA00579c1307B0EF2c499aD98a8ce58e58',
      [NETWORK_NAMES.Celo]: '0x48065fbBE25f71C9282ddf5e1cD6D6A887483D5e',
    },
  },
  ETH: {
    isAllowed: true,
    symbol: 'ETH',
    name: 'Ethereum',
    decimals: 18,
    acceptableDecimals: 4,
    isNative: true,
    contractAddresses: {},
  },
  // Native BNB/POL are NOT payment or payout options — BSC and Polygon accept
  // stablecoins only (see the header comment) — but they stay in the catalog:
  // rates are fetched for them and a legacy destination saved as BNB/POL still
  // settles via LI.FI.
  BNB: {
    isAllowed: false,
    symbol: 'BNB',
    name: 'Binance Coin',
    decimals: 18,
    acceptableDecimals: 4,
    isNative: true,
    contractAddresses: {},
  },
  POL: {
    isAllowed: false,
    symbol: 'POL',
    name: 'Polygon',
    decimals: 18,
    acceptableDecimals: 4,
    isNative: true,
    contractAddresses: {},
  },
  CELO: {
    isAllowed: false,
    symbol: 'CELO',
    name: 'Celo',
    decimals: 18,
    acceptableDecimals: 4,
    isNative: true,
    contractAddresses: {},
  },
  SOL: {
    isAllowed: false,
    symbol: 'SOL',
    name: 'Solana',
    decimals: 9,
    acceptableDecimals: 4,
    isNative: true,
    isNonEvm: true,
    contractAddresses: {},
  },
  BTC: {
    isAllowed: false,
    symbol: 'BTC',
    name: 'Bitcoin',
    decimals: 8,
    acceptableDecimals: 4,
    isNative: true,
    isNonEvm: true,
    contractAddresses: {},
  },
  XLM: {
    isAllowed: false,
    symbol: 'XLM',
    name: 'Stellar Lumens',
    decimals: 7,
    acceptableDecimals: 4,
    isNative: true,
    isNonEvm: true,
    contractAddresses: {},
  },
  TRX: {
    isAllowed: false,
    symbol: 'TRX',
    name: 'Tron',
    decimals: 6,
    acceptableDecimals: 4,
    isNative: true,
    isNonEvm: true,
    contractAddresses: {},
  },
};

/**
 * Decimals of `symbol` as deployed on `network`. Token decimals are a per-chain
 * fact, not a global one (BSC's USDC/USDT are 18-decimal BEP20s while every
 * other deployment is 6-decimal), so all raw-unit math must resolve decimals
 * through this helper rather than TOKENS[x].decimals.
 */
export const getTokenDecimals = (symbol: string, network: string): number => {
  const token = (TOKENS as Record<string, any>)[symbol];

  if (!token) {
    throw new Error(`Unknown token symbol: ${symbol}`);
  }

  return token.decimalsByNetwork?.[network] ?? token.decimals;
};

// TODO: put rpcUrl from envs
export const NETWORKS = {
  [NETWORK_NAMES.Ethereum]: {
    id: NETWORK_NAMES.Ethereum,
    name: 'Ethereum',
    chainId: 1,
    type: 'evm',
    isAllowed: true,
    rpcUrl: 'https://ethereum-rpc.publicnode.com',
    blockExplorer: 'https://etherscan.io',
    nativeToken: TOKENS.ETH,
    supportedTokens: [TOKENS.USDC, TOKENS.USDT, TOKENS.ETH],
    multicall3: '0xcA11bde05977b3631167028862bE2a173976CA11',
  },
  [NETWORK_NAMES.Bsc]: {
    id: NETWORK_NAMES.Bsc,
    name: 'BNB Chain',
    chainId: 56,
    type: 'evm',
    isAllowed: true,
    rpcUrl: 'https://bsc-dataseed.binance.org',
    blockExplorer: 'https://bscscan.com',
    nativeToken: TOKENS.BNB,
    supportedTokens: [TOKENS.USDC, TOKENS.USDT],
    multicall3: '0xcA11bde05977b3631167028862bE2a173976CA11',
  },
  [NETWORK_NAMES.Polygon]: {
    id: NETWORK_NAMES.Polygon,
    name: 'Polygon',
    chainId: 137,
    type: 'evm',
    isAllowed: true,
    // polygon-rpc.com is dead ("tenant disabled") — publicnode is the reliable
    // free endpoint.
    rpcUrl: 'https://polygon-bor-rpc.publicnode.com',
    blockExplorer: 'https://polygonscan.com',
    nativeToken: TOKENS.POL,
    supportedTokens: [TOKENS.USDC, TOKENS.USDT],
    multicall3: '0xcA11bde05977b3631167028862bE2a173976CA11',
  },
  [NETWORK_NAMES.Base]: {
    id: NETWORK_NAMES.Base,
    name: 'Base',
    chainId: 8453,
    type: 'evm',
    isAllowed: true,
    rpcUrl: 'https://mainnet.base.org',
    blockExplorer: 'https://basescan.org',
    nativeToken: TOKENS.ETH,
    supportedTokens: [TOKENS.USDC, TOKENS.ETH],
    multicall3: '0xcA11bde05977b3631167028862bE2a173976CA11',
  },
  [NETWORK_NAMES.Arbitrum]: {
    id: NETWORK_NAMES.Arbitrum,
    name: 'Arbitrum',
    chainId: 42161,
    type: 'evm',
    isAllowed: true,
    rpcUrl: 'https://arb1.arbitrum.io/rpc',
    blockExplorer: 'https://arbiscan.io',
    nativeToken: TOKENS.ETH,
    supportedTokens: [TOKENS.USDC, TOKENS.USDT, TOKENS.ETH],
    multicall3: '0xcA11bde05977b3631167028862bE2a173976CA11',
  },
  [NETWORK_NAMES.Optimism]: {
    id: NETWORK_NAMES.Optimism,
    name: 'Optimism',
    chainId: 10,
    type: 'evm',
    isAllowed: true,
    rpcUrl: 'https://mainnet.optimism.io',
    blockExplorer: 'https://optimistic.etherscan.io',
    nativeToken: TOKENS.ETH,
    supportedTokens: [TOKENS.USDC, TOKENS.USDT, TOKENS.ETH],
    multicall3: '0xcA11bde05977b3631167028862bE2a173976CA11',
  },
  [NETWORK_NAMES.Celo]: {
    id: NETWORK_NAMES.Celo,
    name: 'Celo',
    chainId: 42220,
    type: 'evm',
    isAllowed: false,
    rpcUrl: 'https://forno.celo.org',
    blockExplorer: 'https://celoscan.io',
    nativeToken: TOKENS.CELO,
    supportedTokens: [TOKENS.USDC, TOKENS.USDT, TOKENS.CELO],
    multicall3: '0xcA11bde05977b3631167028862bE2a173976CA11',
  },
  [NETWORK_NAMES.Solana]: {
    id: NETWORK_NAMES.Solana,
    name: 'Solana',
    type: 'non-evm',
    isAllowed: false,
    rpcUrl: 'https://api.mainnet-beta.solana.com', // no need for now
    blockExplorer: 'https://explorer.solana.com',
    nativeToken: TOKENS.SOL,
    supportedTokens: [TOKENS.SOL],
  },
  [NETWORK_NAMES.Bitcoin]: {
    id: NETWORK_NAMES.Bitcoin,
    name: 'Bitcoin',
    type: 'non-evm',
    isAllowed: false,
    rpcUrl: 'https://blockstream.info/api', // no need for now
    blockExplorer: 'https://blockstream.info',
    nativeToken: TOKENS.BTC,
    supportedTokens: [TOKENS.BTC],
  },
  [NETWORK_NAMES.Stellar]: {
    id: NETWORK_NAMES.Stellar,
    name: 'Stellar',
    type: 'non-evm',
    isAllowed: false,
    rpcUrl: 'https://horizon.stellar.org', // no need for now
    blockExplorer: 'https://stellar.expert',
    nativeToken: TOKENS.XLM,
    supportedTokens: [TOKENS.XLM],
  },
  [NETWORK_NAMES.Tron]: {
    id: NETWORK_NAMES.Tron,
    name: 'Tron',
    type: 'non-evm',
    isAllowed: false,
    rpcUrl: 'https://api.trongrid.io', // no need for now
    blockExplorer: 'https://tronscan.org',
    nativeToken: TOKENS.TRX,
    supportedTokens: [TOKENS.TRX],
  },
};
