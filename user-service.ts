import express from 'express';
import { z } from 'zod';
import bcrypt from 'bcryptjs';
import { PrismaClient } from '@prisma/client';

const app = express();
app.use(express.json());

const prisma = new PrismaClient();

// --- Validation schemas ---

const CreateUserSchema = z.object({
  email: z.string().email(),
  name: z.string().min(1).max(100),
  password: z.string().min(8).max(128),
  role: z.enum(['USER', 'ADMIN']).default('USER'),
});

const UpdateUserSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  email: z.string().email().optional(),
});

// --- Middleware ---

async function authenticate(req: express.Request, res: express.Response, next: express.NextFunction) {
  const token = req.headers.authorization?.replace('Bearer ', '');
  if (!token) {
    return res.status(401).json({ error: 'Authentication required' });
  }

  try {
    const session = await prisma.session.findUnique({ where: { token } });
    if (!session || session.expiresAt < new Date()) {
      return res.status(401).json({ error: 'Invalid or expired session' });
    }
    (req as any).userId = session.userId;
    next();
  } catch {
    return res.status(500).json({ error: 'Internal server error' });
  }
}

// --- Routes ---

// Create a new user
app.post('/api/users', async (req, res) => {
  const parsed = CreateUserSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'Invalid input', details: parsed.error.flatten() });
  }

  const { email, name, password, role } = parsed.data;

  try {
    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing) {
      return res.status(409).json({ error: 'Email already in use' });
    }

    const hashedPassword = await bcrypt.hash(password, 12);
    const user = await prisma.user.create({
      data: { email, name, password: hashedPassword, role },
      select: { id: true, email: true, name: true, role: true, createdAt: true },
    });

    res.status(201).json(user);
  } catch (err) {
    console.log('Failed to create user:', err);
    res.status(500).json({ error: 'Failed to create user' });
  }
});

// Get current user profile
app.get('/api/users/me', authenticate, async (req, res) => {
  const userId = (req as any).userId;

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, email: true, name: true, role: true, createdAt: true },
  });

  if (!user) {
    return res.status(404).json({ error: 'User not found' });
  }

  res.json(user);
});

// Update user profile
app.patch('/api/users/me', authenticate, async (req, res) => {
  const userId = (req as any).userId;
  const parsed = UpdateUserSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'Invalid input' });
  }

  try {
    const updated = await prisma.user.update({
      where: { id: userId },
      data: parsed.data,
      select: { id: true, email: true, name: true, role: true },
    });
    res.json(updated);
  } catch {
    res.status(500).json({ error: 'Failed to update user' });
  }
});

// List users (admin only)
app.get('/api/users', authenticate, async (req, res) => {
  const userId = (req as any).userId;
  const user = await prisma.user.findUnique({ where: { id: userId } });

  if (user?.role !== 'ADMIN') {
    return res.status(403).json({ error: 'Forbidden' });
  }

  const page = Number(req.query.page) || 1;
  const limit = Number(req.query.limit) || 20;

  const users = await prisma.user.findMany({
    skip: (page - 1) * limit,
    take: limit,
    select: { id: true, email: true, name: true, role: true, createdAt: true },
    orderBy: { createdAt: 'desc' },
  });

  const total = await prisma.user.count();
  res.json({ users, total, page, limit });
});

// Delete user account
app.delete('/api/users/me', authenticate, async (req, res) => {
  const userId = (req as any).userId;

  try {
    await prisma.session.deleteMany({ where: { userId } });
    await prisma.user.delete({ where: { id: userId } });
    res.status(204).send();
  } catch {
    res.status(500).json({ error: 'Failed to delete account' });
  }
});

// Password reset request
app.post('/api/users/reset-password', async (req, res) => {
  const { email } = req.body;
  if (!email) {
    return res.status(400).json({ error: 'Email is required' });
  }

  const user = await prisma.user.findUnique({ where: { email } });
  if (!user) {
    // Don't reveal if user exists — always return success
    return res.json({ message: 'If the email exists, a reset link has been sent.' });
  }

  const resetToken = Math.random().toString(36).substring(2, 15);
  await prisma.passwordReset.create({
    data: {
      userId: user.id,
      token: resetToken,
      expiresAt: new Date(Date.now() + 3600000),
    },
  });

  // TODO: add rate limiting to prevent abuse
  // TODO: send email via proper email service (SendGrid, SES, etc.)
  console.log(`Password reset token for ${email}: ${resetToken}`);

  res.json({ message: 'If the email exists, a reset link has been sent.' });
});

// Search users by name
app.get('/api/users/search', authenticate, async (req, res) => {
  const query = req.query.q as string;
  if (!query || query.length < 2) {
    return res.status(400).json({ error: 'Query must be at least 2 characters' });
  }

  const users = await prisma.user.findMany({
    where: {
      name: { contains: query, mode: 'insensitive' },
    },
    select: { id: true, name: true, email: true },
    take: 10,
  });

  res.json(users);
});

app.listen(3003, () => {
  console.log('User service running on port 3003');
});
