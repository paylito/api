import express from 'express';

import { getDonationByUsername } from '../controllers/donationController';

const router = express.Router();

// GET /donations/:username - Get a donation link by its public username
router.get('/:username', getDonationByUsername);

export default router;
