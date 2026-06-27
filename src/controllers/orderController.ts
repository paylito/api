import { BigNumber } from 'bignumber.js';
import { Request, Response } from 'express';
import { isValidObjectId } from 'mongoose';

import { Order } from '../models/Order';
import { envs } from '../configs/envs';
import { logger } from '../configs/logger';
import { DonationLink } from '../models/DonationLink';
import { createShortId, getLatestRates, getPricing } from '../utils/helpers';
import {
  createSecretKey,
  getSmartAccount,
  getAllAddressesFromPrivateKey,
} from '../utils/accounts';

const { PAYMENT_GATEWAY_URI } = envs();

// How long a freshly created order stays payable before it expires.
const ORDER_TTL_MS = 20 * 60 * 1000; // 20 minutes
// Reject order creation if the latest rates snapshot is older than this.
const MAX_RATES_AGE_MS = 30_000;

export const getOrderById = async (req: Request, res: Response) => {
  try {
    const order = await Order.findOne({ id: req.params.id })
      .select(
        '-privateKey -destinationToken -destinationNetwork -destinationAddress -user -receiptChatId -receiptMessageId -paidAt -payment',
      )
      .lean()
      .populate('rates');

    if (!order) {
      return res.status(404).json({
        success: false,
        message: 'Order not found',
      });
    }

    if (order.status !== 'pending') {
      return res.status(200).json({
        success: true,
        data: `Order is ${order.status}`,
      });
    }

    return res.status(200).json({
      success: true,
      data: order,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Error fetching order',
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  }
};

// Create an order from a donation link. The donor supplies an amount (and an
// optional message); the destination payout and owner are taken from the
// donation link. Mirrors the telegram bot's createOrder: generate a deposit
// wallet across every chain, snapshot the latest rates + pricing, then return
// the gateway URL the donor is redirected to.
export const createOrder = async (req: Request, res: Response) => {
  try {
    const { amount, text, donationId } = req.body;

    if (amount === undefined || amount === null || new BigNumber(amount).isNaN()) {
      return res.status(400).json({ success: false, message: 'A valid amount is required' });
    }

    if (new BigNumber(amount).isLessThanOrEqualTo(0)) {
      return res
        .status(400)
        .json({ success: false, message: 'Amount must be greater than zero' });
    }

    // The donation link is required: it provides both the payout destination and
    // the owning user that the order is attached to.
    if (!donationId || !isValidObjectId(donationId)) {
      return res
        .status(400)
        .json({ success: false, message: 'A valid donationId is required' });
    }

    const donation = await DonationLink.findById(donationId);

    if (!donation) {
      return res.status(404).json({ success: false, message: 'Donation link not found' });
    }

    // Pricing is computed against the most recent rates snapshot; refuse to
    // create an order off stale data (a feeder keeps Rates fresh).
    const latestRates = await getLatestRates();

    if (!latestRates) {
      return res
        .status(503)
        .json({ success: false, message: 'Cannot fetch exchange rates. Please try later.' });
    }

    const ratesAge = Date.now() - new Date(latestRates.createdAt).getTime();

    if (ratesAge > MAX_RATES_AGE_MS) {
      return res
        .status(503)
        .json({ success: false, message: 'Rates data is outdated. Please try again.' });
    }

    const keypair = createSecretKey();
    const smartAccount = await getSmartAccount(keypair.privateKey);
    const addresses = getAllAddressesFromPrivateKey(keypair.privateKey);

    const order = new Order({
      user: donation.user,
      amount: new BigNumber(amount).toString(),
      smartAccount,
      status: 'pending',
      rates: latestRates,
      id: createShortId(),
      createdAt: new Date(),
      evmAddress: addresses.evm,
      tronAddress: addresses.tron,
      privateKey: keypair.privateKey,
      solanaAddress: addresses.solana,
      stellarAddress: addresses.stellar,
      bitcoinLegacyAddress: addresses.bitcoinLegacy,
      bitcoinSegwitAddress: addresses.bitcoinSegwit,
      destinationToken: donation.destinationToken,
      destinationNetwork: donation.destinationNetwork,
      destinationAddress: donation.destinationAddress,
      expiresAt: new Date(Date.now() + ORDER_TTL_MS),
      donation: donation._id,
      ...(text ? { text: String(text) } : {}),
    });

    order.pricing = await getPricing(order, latestRates);

    await order.save();

    // The gateway page lives at PAYMENT_GATEWAY_URI/<order.id>; the donor is
    // redirected there to complete the payment.
    const url = `${PAYMENT_GATEWAY_URI.replace(/\/+$/, '')}/${order.id}`;

    return res.status(201).json({
      success: true,
      data: { id: order.id, url },
    });
  } catch (error) {
    logger.error(error);

    return res.status(500).json({
      success: false,
      message: 'Failed to create order',
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  }
};
