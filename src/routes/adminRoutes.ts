import express from 'express';

import { adminAuth } from '../middlewares/adminAuth';
import {
  adminMe,
  adminLogin,
  getOverview,
  getPayments,
  getMerchants,
  getDonatees,
} from '../controllers/adminController';

const router = express.Router();

// POST /admin/login - exchange the two shared secrets for a JWT (public).
router.post('/login', adminLogin);

// Everything below requires a valid admin JWT.
router.use(adminAuth);

// GET /admin/me - confirm the current token is valid.
router.get('/me', adminMe);

// GET /admin/overview - aggregate KPIs and breakdowns for the landing page.
router.get('/overview', getOverview);

// GET /admin/payments - paginated, filterable list of payments (orders).
router.get('/payments', getPayments);

// GET /admin/merchants - paginated list of merchants (users).
router.get('/merchants', getMerchants);

// GET /admin/donatees - paginated list of donatees (donation links).
router.get('/donatees', getDonatees);

export default router;
