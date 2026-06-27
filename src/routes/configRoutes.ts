import express from 'express';

import { getConfig } from '../controllers/configController';

const router = express.Router();

// GET /config - Get supported networks and tokens
router.get('/', getConfig);

export default router;
