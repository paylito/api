import express from 'express';

import { getOrderById, createOrder } from '../controllers/orderController';
import { requestOrderReceipt } from '../controllers/receiptController';

const router = express.Router();

// POST /orders - Create an order from a donation link
router.post('/', createOrder);

// GET /orders/:id - Get order by ID
router.get('/:id', getOrderById);

// POST /orders/:id/receipt - Email a one-time receipt for a finished order
router.post('/:id/receipt', requestOrderReceipt);

export default router;
