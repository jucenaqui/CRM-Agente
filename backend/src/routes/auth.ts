import bcrypt from 'bcryptjs';
import { Router } from 'express';
import { z } from 'zod';
import { currentUser, requireAuth, signToken, toPublicUser } from '../lib/auth.js';
import { unauthorized } from '../lib/errors.js';
import { findUserByEmail, hashPassword, insertUser } from '../lib/users.js';
import { email, password, reqText, validate } from '../lib/validation.js';

const router = Router();

// `role` is intentionally not accepted: unknown keys are stripped, never trusted.
const registerSchema = z.object({ name: reqText(100), email: email(), password: password() });
const loginSchema = z.object({ email: email(), password: z.string().min(1).max(128) });

// Used to keep login timing similar whether or not the email exists.
const DUMMY_HASH = bcrypt.hashSync('dummy-password-for-timing', 10);

router.post('/register', async (req, res) => {
  const body = validate(registerSchema, req.body ?? {});
  const passwordHash = await hashPassword(body.password);
  const user = insertUser({ name: body.name, email: body.email, passwordHash });
  res.status(201).json({ token: signToken(user), user });
});

router.post('/login', async (req, res) => {
  const body = validate(loginSchema, req.body ?? {});
  const row = findUserByEmail(body.email);
  const ok = await bcrypt.compare(body.password, row?.passwordHash ?? DUMMY_HASH);
  if (!row || !ok) throw unauthorized('Invalid email or password', 'INVALID_CREDENTIALS');
  const user = toPublicUser(row);
  res.json({ token: signToken(user), user });
});

router.get('/me', requireAuth, (req, res) => {
  res.json(currentUser(req));
});

export default router;
