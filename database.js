const { Pool } = require('pg');

// Use DATABASE_URL from Railway or fallback to local
const connectionString = process.env.DATABASE_URL || 'postgresql://localhost:5432/wmc_ac';

const pool = new Pool({
  connectionString,
  ssl: process.env.DATABASE_URL ? { rejectUnauthorized: false } : false
});

// Initialize database
async function initDatabase() {
  const client = await pool.connect();
  try {
    const createUsersTable = `
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        username VARCHAR(255) UNIQUE NOT NULL,
        password VARCHAR(255) NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `;
    await client.query(createUsersTable);
    console.log('✅ Database initialized: users table ready.');
  } catch (error) {
    console.error('❌ Database initialization error:', error);
  } finally {
    client.release();
  }
}

module.exports = {
  pool,
  initDatabase
};
