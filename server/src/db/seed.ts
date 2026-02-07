import { db } from './index.js';
import argon2 from 'argon2';
import { nanoid } from 'nanoid';

async function seed() {
  const email = process.env.SEED_EMAIL ?? 'demo@harborfm.local';
  const password = process.env.SEED_PASSWORD ?? 'demo12345';
  const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(email);
  if (existing) {
    console.log('Seed user already exists:', email);
    return;
  }
  const id = nanoid();
  const password_hash = await argon2.hash(password);
  db.prepare(
    'INSERT INTO users (id, email, password_hash) VALUES (?, ?, ?)'
  ).run(id, email, password_hash);
  console.log('Created seed user:', email, '(password:', password, ')');
}

seed().catch(console.error);
