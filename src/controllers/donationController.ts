import { Request, Response } from 'express';

import { DonationLink } from '../models/DonationLink';

export const getDonationByUsername = async (req: Request, res: Response) => {
  try {
    // Usernames are stored lowercase + trimmed, so normalise the lookup the same
    // way the schema normalises on write.
    const raw = req.params.username;
    const username = (Array.isArray(raw) ? raw[0] : raw)?.toLowerCase().trim();

    const donation = await DonationLink.findOne({ username })
      // The payout destination is resolved server-side later (via the donation
      // reference on the payment link), so it stays private on this public
      // lookup — same posture as the order endpoint.
      .select('-destinationToken -destinationNetwork -destinationAddress -user')
      .lean();

    if (!donation) {
      return res.status(404).json({
        success: false,
        message: 'Donation link not found',
      });
    }

    return res.status(200).json({
      success: true,
      data: donation,
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: 'Error fetching donation link',
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  }
};
