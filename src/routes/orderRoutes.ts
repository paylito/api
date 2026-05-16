import express from 'express';

import { getOrderById } from '../controllers/orderController';

const router = express.Router();

// GET /orders/:id - Get order by ID
router.get('/:id', getOrderById);

export default router;
