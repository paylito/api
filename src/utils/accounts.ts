import { ethers } from 'ethers';
import * as ecc from 'tiny-secp256k1';
import { TronWeb } from 'tronweb';
import * as bitcoin from 'bitcoinjs-lib';
import { Keypair } from '@solana/web3.js';
import StellarSdk from '@stellar/stellar-sdk';
import { LocalAccountSigner } from '@aa-sdk/core';
import { createLightAccountAlchemyClient } from '@account-kit/smart-contracts';
import {
  bsc,
  base,
  polygon,
  mainnet,
  alchemy,
  arbitrum,
  optimism,
  celoMainnet,
} from '@account-kit/infra';
import { envs } from '../configs/envs';

// viem's `Hex` type, inlined so we don't take a direct dependency on viem
// (it's only pulled in transitively by account-kit).
type Hex = `0x${string}`;

bitcoin.initEccLib(ecc);

const supportedEVMNetworks = [arbitrum, base, bsc, polygon, optimism, mainnet, celoMainnet];

export function createSecretKey() {
  const privateKey = ethers.hexlify(ethers.randomBytes(32));

  const wallet = new ethers.Wallet(privateKey);

  const eoaAddress = wallet.address;

  return {
    privateKey,
    eoaAddress,
  };
}

export const getSmartAccount = async (privateKey: string) => {
  const { ALCHEMY_API_KEY } = envs();

  // Build the light-account clients for every supported chain in parallel. The
  // counterfactual address is identical across chains, so we just sanity-check
  // they all match instead of deriving them one slow request at a time.
  const clients = await Promise.all(
    supportedEVMNetworks.map((chain) =>
      createLightAccountAlchemyClient({
        transport: alchemy({ apiKey: ALCHEMY_API_KEY }),
        chain,
        signer: LocalAccountSigner.privateKeyToAccountSigner(privateKey as Hex),
      }),
    ),
  );

  const addresses = clients.map((c) => c.account.address);

  if (!addresses.every((a) => a === addresses[0])) {
    throw new Error('Smart account addresses are not the same');
  }

  return addresses[0];

  // todo
  // connect pimlico to the deployment process
  // check those tokens in those networks and see if there is a non-zero balance anywhere
  // deploy that specific aa on that specific network.
  // get the fund out, using LI.FI core to the user destination (for now, just base mainnet, USDT)
};

function privateKeyToBytes(privateKey: string) {
  let hex = privateKey;

  if (hex.startsWith('0x')) {
    hex = hex.slice(2);
  }

  if (hex.length !== 64) {
    throw new Error('Invalid private key length. Expected 64 hex characters.');
  }

  return Buffer.from(hex, 'hex');
}

function privateKeyToUint8Array(privateKey: string) {
  return new Uint8Array(privateKeyToBytes(privateKey));
}

export function privateKeyToTronAddress(privateKey: string) {
  try {
    let cleanPrivateKey = privateKey;
    if (cleanPrivateKey.startsWith('0x')) {
      cleanPrivateKey = cleanPrivateKey.slice(2);
    }

    const tronWeb = new TronWeb({
      fullHost: 'https://api.trongrid.io',
      solidityNode: 'https://api.trongrid.io',
      eventServer: 'https://api.trongrid.io',
    });

    tronWeb.setPrivateKey(cleanPrivateKey);
    const address = tronWeb.address.fromPrivateKey(cleanPrivateKey);

    return address;
  } catch (error) {
    throw new Error(`Failed to derive Tron address: ${error.message}`);
  }
}

export function privateKeyToSolanaAddress(privateKey: string) {
  try {
    const seed = privateKeyToBytes(privateKey);

    const keypair = Keypair.fromSeed(seed.slice(0, 32));

    return keypair.publicKey.toBase58();
  } catch (error) {
    throw new Error(`Failed to derive Solana address: ${error.message}`);
  }
}

export function privateKeyToSolanaAddressV2(privateKey: string) {
  try {
    const seed = privateKeyToUint8Array(privateKey);
    const keypair = Keypair.fromSeed(seed.slice(0, 32));
    return keypair.publicKey.toBase58();
  } catch (error) {
    throw new Error(`Failed to derive Solana address: ${error.message}`);
  }
}

export function privateKeyToStellarAddress(privateKey: string) {
  try {
    const seed = privateKeyToBytes(privateKey);
    const keypair = StellarSdk.Keypair.fromRawEd25519Seed(seed.slice(0, 32));

    return keypair.publicKey();
  } catch (error) {
    throw new Error(`Failed to derive Stellar address: ${error.message}`);
  }
}

export function privateKeyToBitcoinAddress(privateKey: string) {
  try {
    let hex = privateKey;
    if (hex.startsWith('0x')) hex = hex.slice(2);

    const net = bitcoin.networks.bitcoin;
    const privateKeyBuffer = Buffer.from(hex, 'hex');

    const publicKey = ecc.pointFromScalar(privateKeyBuffer, true);

    if (!publicKey) throw new Error('Failed to derive public key');

    const legacy = bitcoin.payments.p2pkh({ pubkey: publicKey, network: net }).address;
    const segwit = bitcoin.payments.p2wpkh({ pubkey: publicKey, network: net }).address;

    return { legacy, segwit };
  } catch (error) {
    throw new Error(`Failed to derive Bitcoin SegWit address: ${error.message}`);
  }
}

export function privateKeyToEvmAddress(privateKey: string) {
  try {
    const wallet = new ethers.Wallet(privateKey);
    return wallet.address;
  } catch (error) {
    throw new Error(`Failed to derive EVM address: ${error.message}`);
  }
}

export function getAllAddressesFromPrivateKey(privateKey: string) {
  const evm = privateKeyToEvmAddress(privateKey);
  const tron = privateKeyToTronAddress(privateKey);
  const solana = privateKeyToSolanaAddress(privateKey);
  const stellar = privateKeyToStellarAddress(privateKey);
  const bitcoinLegacy = privateKeyToBitcoinAddress(privateKey).legacy;
  const bitcoinSegwit = privateKeyToBitcoinAddress(privateKey).segwit;

  return {
    evm,
    tron,
    solana,
    stellar,
    bitcoinLegacy,
    bitcoinSegwit,
  };
}
