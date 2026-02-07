import { db, closeDb } from './index.js';
import argon2 from 'argon2';
import * as readline from 'readline';

function promptPassword(question: string): Promise<string> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer);
    });
  });
}

async function resetFirstUserPassword() {
  try {
    // Get the first user (by created_at)
    const firstUser = db
      .prepare('SELECT id, email FROM users ORDER BY created_at ASC LIMIT 1')
      .get() as { id: string; email: string } | undefined;

    if (!firstUser) {
      console.error('No users found in the database.');
      process.exit(1);
    }

    console.log(`Resetting password for user: ${firstUser.email}`);

    // Prompt for new password
    const password = await promptPassword('Enter new password: ');
    if (!password) {
      console.error('Password cannot be empty.');
      process.exit(1);
    }

    // Prompt for confirmation
    const confirmPassword = await promptPassword('Confirm new password: ');
    if (password !== confirmPassword) {
      console.error('Passwords do not match.');
      process.exit(1);
    }

    // Hash the password
    const password_hash = await argon2.hash(password);

    // Update the user's password
    db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(password_hash, firstUser.id);

    console.log(`Password reset successfully for user: ${firstUser.email}`);
  } catch (error) {
    console.error('Error resetting password:', error);
    process.exit(1);
  } finally {
    closeDb();
  }
}

resetFirstUserPassword();
