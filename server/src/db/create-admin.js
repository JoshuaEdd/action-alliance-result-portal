import bcrypt from 'bcrypt';
import { pool } from '../config/db.js';

// Usage: npm run create-admin -- "Full Name" email@example.com temporaryPassword123
async function main() {
  const [fullName, email, password] = process.argv.slice(2);
  if (!fullName || !email || !password) {
    console.error('Usage: npm run create-admin -- "Full Name" email@example.com temporaryPassword');
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
