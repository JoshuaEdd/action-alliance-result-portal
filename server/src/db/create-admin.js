import bcrypt from 'bcryptjs';
import readline from 'readline/promises';
import { pool } from '../config/db.js';

// Creates the first Chief Administrator account.
// Usage (all args): npm run create-admin -- "Full Name" email@example.com aPassword
// Or without args:  npm run create-admin   (prompts for each value)
async function main() {
  let [fullName, email, password] = process.argv.slice(2);

  if (!fullName || !email || !password) {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    const ask = (q) => rl.question(`${q} `);
    try {
      if (!fullName) fullName = (await ask('Full name:')).trim();
      if (!email) email = (await ask('Email:')).trim();
      if (!password) password = await ask('Temporary password (min 8 chars):');
    } finally {
      rl.close();
    }
  }

  if (!fullName || !email || !password) {
    console.error('Full name, email, and password are all required.');
    process.exitCode = 1;
    return;
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    console.error('That does not look like a valid email address.');
    process.exitCode = 1;
    return;
  }
  if (password.length < 8) {
    console.error('Password must be at least 8 characters.');
    process.exitCode = 1;
    return;
  }

  const passwordHash = await bcrypt.hash(password, 10);
  try {
    const { rows } = await pool.query(
      `INSERT INTO users (role, full_name, email, password_hash)
       VALUES ('chief_admin', $1, $2, $3)
       RETURNING id, full_name, email, role`,
      [fullName, email, passwordHash]
    );
    console.log('Created chief admin:', rows[0]);
  } catch (err) {
    console.error('Could not create admin:', err.message);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}

main();
