import { Request, Response } from 'express';

import { Order } from '../models/Order';

export const getOrderById = async (req: Request, res: Response) => {
  try {
    const order = await Order.findOne({ id: req.params.id })
      .select('-privateKey -destinationToken -destinationNetwork -destinationAddress')
      .lean()
      .populate('rates');

    if (!order) {
      return res.status(404).json({
        success: false,
        message: 'Order not found',
      });
    }

    // TODO: when the Payment model is completed, only show this response when the Payment was made
    // and confirmed longer than 10 minutes. If it is recent, still show the order details.

    if (order.status === 'finished') {
      return res.status(200).json({
        success: true,
        data: 'Order has finished.',
      });
    }

    if (order.status === 'expired') {
      return res.status(200).json({
        success: true,
        data: 'Order has expired',
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
