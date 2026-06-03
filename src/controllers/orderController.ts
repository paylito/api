import { Request, Response } from 'express';

import { Order } from '../models/Order';

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
