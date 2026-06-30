import { Request, Response, NextFunction } from 'express';

import { verifyJwt, JwtPayload } from '../utils/jwt';
import { getAdminConfig } from '../configs/admin';

// Augment Express's Request so handlers can read the decoded admin token.
declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      admin?: JwtPayload;
    }
  }
}

/**
 * Gate for every admin endpoint except `/admin/login`. Expects a
 * `Authorization: Bearer <jwt>` header carrying a token issued by the login
 * route. Attaches the decoded payload to `req.admin` on success.
 */
export const adminAuth = (req: Request, res: Response, next: NextFunction) => {
  const { jwtSecret } = getAdminConfig();

  // If the panel was never configured, there is nothing to verify against.
  if (!jwtSecret) {
    return res.status(503).json({ success: false, message: 'Admin panel is not configured' });
  }

  const header = req.headers.authorization || '';
  const [scheme, token] = header.split(' ');

  if (scheme !== 'Bearer' || !token) {
    return res
      .status(401)
      .json({ success: false, message: 'Missing or invalid Authorization header' });
  }

  const payload = verifyJwt(token, jwtSecret);

  if (!payload || payload.sub !== 'admin') {
    return res.status(401).json({ success: false, message: 'Invalid or expired token' });
  }

  req.admin = payload;

  return next();
};
