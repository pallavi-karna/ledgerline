const sqlite3 = require('sqlite3').verbose();
const path = require('node:path');

const dbPath = path.join(__dirname, 'ledgerline.db');
const db = new sqlite3.Database(dbPath);

db.serialize(() => {
  // Enforce foreign key constraints
  db.run('PRAGMA foreign_keys = ON');

  // Users table
  db.run(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE NOT NULL,
      password TEXT NOT NULL,
      role TEXT NOT NULL CHECK(role IN ('ADMIN', 'AUDITOR', 'ACCOUNT_HOLDER')),
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // Accounts table (balance in minor units/paise, guaranteed non-negative)
  db.run(`
    CREATE TABLE IF NOT EXISTS accounts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      account_number TEXT UNIQUE NOT NULL,
      user_id INTEGER NOT NULL,
      balance INTEGER NOT NULL DEFAULT 0 CHECK(balance >= 0),
      currency TEXT NOT NULL DEFAULT 'INR',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id)
    )
  `);

  // Transactions table
  db.run(`
    CREATE TABLE IF NOT EXISTS transactions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      idempotency_key TEXT UNIQUE NOT NULL,
      from_account_id INTEGER,
      to_account_id INTEGER,
      amount INTEGER NOT NULL CHECK(amount > 0),
      currency TEXT NOT NULL DEFAULT 'INR',
      status TEXT NOT NULL CHECK(status IN ('PENDING', 'COMPLETED', 'FAILED')),
      reference TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (from_account_id) REFERENCES accounts(id),
      FOREIGN KEY (to_account_id) REFERENCES accounts(id)
    )
  `);

  // Double-entry ledger entries table (DEBIT / CREDIT legs)
  db.run(`
    CREATE TABLE IF NOT EXISTS ledger_entries (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      transaction_id INTEGER NOT NULL,
      account_id INTEGER NOT NULL,
      entry_type TEXT NOT NULL CHECK(entry_type IN ('DEBIT', 'CREDIT')),
      amount INTEGER NOT NULL CHECK(amount > 0),
      balance_after INTEGER NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (transaction_id) REFERENCES transactions(id),
      FOREIGN KEY (account_id) REFERENCES accounts(id)
    )
  `);

  // Cryptographic audit logs table
  db.run(`
    CREATE TABLE IF NOT EXISTS audit_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      prev_hash TEXT NOT NULL,
      hash TEXT NOT NULL,
      action TEXT NOT NULL,
      actor_id INTEGER,
      details TEXT NOT NULL,
      created_at DATETIME NOT NULL
    )
  `);
});

module.exports = db;