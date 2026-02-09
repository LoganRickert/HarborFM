import type { FastifyInstance } from 'fastify';
import argon2 from 'argon2';
import { requireAdmin } from '../plugins/auth.js';
import { db } from '../db/index.js';

export interface User {
  id: string;
  email: string;
  created_at: string;
  role: 'user' | 'admin';
  disabled: number; // SQLite uses INTEGER for booleans (0 = false, 1 = true)
  disk_bytes_used: number;
  last_login_at: string | null;
  last_login_ip: string | null;
  last_login_location: string | null;
}

export async function usersRoutes(app: FastifyInstance) {
  app.get(
    '/api/users',
    { preHandler: [requireAdmin] },
    async (request, _reply) => {
      const query = request.query as { page?: string; limit?: string; search?: string } | undefined;
      const page = Math.max(1, parseInt(query?.page ?? '1', 10) || 1);
      const limit = Math.min(100, Math.max(10, parseInt(query?.limit ?? '50', 10) || 50));
      const offset = (page - 1) * limit;
      const search = query?.search?.trim() ?? '';

      // Build WHERE clause for search
      let whereClause = '';
      let searchParam: string | undefined;
      if (search) {
        whereClause = 'WHERE email LIKE ?';
        searchParam = `%${search}%`;
      }

      // Get total count with search filter
      const countQuery = search
        ? db.prepare(`SELECT COUNT(*) as count FROM users ${whereClause}`)
        : db.prepare('SELECT COUNT(*) as count FROM users');
      const totalCount = (search ? countQuery.get(searchParam!) : countQuery.get()) as { count: number };
      const total = totalCount.count;

      // Get paginated users (oldest to newest by default)
      const queryStr = `SELECT id, email, created_at, role, COALESCE(disabled, 0) as disabled, COALESCE(disk_bytes_used, 0) as disk_bytes_used, last_login_at, last_login_ip, last_login_location FROM users ${whereClause} ORDER BY created_at ASC LIMIT ? OFFSET ?`;
      const rows = search
        ? db.prepare(queryStr).all(searchParam, limit, offset) as User[]
        : db.prepare(queryStr).all(limit, offset) as User[];

      return {
        users: rows,
        pagination: {
          page,
          limit,
          total,
          totalPages: Math.ceil(total / limit),
        },
      };
    }
  );

  app.patch(
    '/api/users/:userId',
    { preHandler: [requireAdmin] },
    async (request, reply) => {
      const { userId } = request.params as { userId: string };
      const body = request.body as { email?: string; role?: 'user' | 'admin'; disabled?: boolean; password?: string } | undefined;

      // Check if user exists
      const user = db.prepare('SELECT id FROM users WHERE id = ?').get(userId) as { id: string } | undefined;
      if (!user) {
        return reply.code(404).send({ error: 'User not found' });
      }

      // Update user fields
      const updates: string[] = [];
      const values: (string | number)[] = [];

      if (body?.email !== undefined) {
        // Check if email is already taken by another user
        const existing = db.prepare('SELECT id FROM users WHERE email = ? AND id != ?').get(body.email, userId) as { id: string } | undefined;
        if (existing) {
          return reply.code(400).send({ error: 'Email already in use' });
        }
        updates.push('email = ?');
        values.push(body.email);
      }

      if (body?.role !== undefined) {
        updates.push('role = ?');
        values.push(body.role);
      }

      if (body?.disabled !== undefined) {
        updates.push('disabled = ?');
        values.push(body.disabled ? 1 : 0);
      }

      if (body?.password !== undefined && body.password.trim() !== '') {
        const password_hash = await argon2.hash(body.password);
        updates.push('password_hash = ?');
        values.push(password_hash);
      }

      if (updates.length === 0) {
        return reply.code(400).send({ error: 'No fields to update' });
      }

      values.push(userId);
      const sql = `UPDATE users SET ${updates.join(', ')} WHERE id = ?`;
      db.prepare(sql).run(...values);

      // Return updated user
      const updated = db.prepare('SELECT id, email, created_at, role, COALESCE(disabled, 0) as disabled, COALESCE(disk_bytes_used, 0) as disk_bytes_used, last_login_at, last_login_ip, last_login_location FROM users WHERE id = ?').get(userId) as User;
      return updated;
    }
  );

  app.get(
    '/api/users/:userId',
    { preHandler: [requireAdmin] },
    async (request, reply) => {
      const { userId } = request.params as { userId: string };
      const user = db
        .prepare('SELECT id, email, created_at, role, COALESCE(disabled, 0) as disabled, COALESCE(disk_bytes_used, 0) as disk_bytes_used, last_login_at, last_login_ip, last_login_location FROM users WHERE id = ?')
        .get(userId) as User | undefined;
      if (!user) {
        return reply.code(404).send({ error: 'User not found' });
      }
      return user;
    }
  );

  app.delete(
    '/api/users/:userId',
    { preHandler: [requireAdmin] },
    async (request, reply) => {
      const { userId } = request.params as { userId: string };

      // Check if user exists
      const user = db.prepare('SELECT id FROM users WHERE id = ?').get(userId) as { id: string } | undefined;
      if (!user) {
        return reply.code(404).send({ error: 'User not found' });
      }

      // Delete user
      db.prepare('DELETE FROM users WHERE id = ?').run(userId);

      return { success: true };
    }
  );
}
