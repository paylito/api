import express from 'express';
import { getPublicOverview, getPublicPayments } from '../controllers/publicController';

const router = express.Router();
router.get('/overview', getPublicOverview);
router.get('/payments', getPublicPayments);
export default router;
