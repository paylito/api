import express from 'express';

import { getOrderById, createOrder } from '../controllers/orderController';

const router = express.Router();

// POST /orders - Create an order from a donation link
router.post('/', createOrder);

// GET /orders/:id - Get order by ID
router.get('/:id', getOrderById);

export default router;
