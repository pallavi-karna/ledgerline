const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const dbPath = path.resolve(__dirname, 'ledgerline.db');
const db = new sqlite3.Database(dbPath);

db.serialize(() => {
  // 1. Users table (Admin, Auditor, Account Holder)
  db.run(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE NOT NULL,
      password TEXT NOT NULL,
      role TEXT CHECK(role IN ('ADMIN', 'AUDITOR', 'ACCOUNT_HOLDER')) NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // 2. Accounts table (Enforces non-negative balance at the database engine level)
  db.run(`
    CREATE TABLE IF NOT EXISTS accounts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      account_number TEXT UNIQUE NOT NULL,
      user_id INTEGER NOT NULL,
      balance INTEGER NOT NULL DEFAULT 0 CHECK(balance >= 0),
      currency TEXT DEFAULT 'INR',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(user_id) REFERENCES users(id)
    )
  `);

  // 3. Transactions table (Enforces strict idempotency key uniqueness)
  db.run(`
    CREATE TABLE IF NOT EXISTS transactions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      idempotency_key TEXT UNIQUE NOT NULL,
      type TEXT CHECK(type IN ('DEPOSIT', 'WITHDRAWAL', 'TRANSFER')) NOT NULL,
      amount INTEGER NOT NULL CHECK(amount > 0),
      status TEXT CHECK(status IN ('SUCCESS', 'FAILED')) NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // 4. Double-Entry Ledger Entries (Debits & Credits)
  db.run(`
    CREATE TABLE IF NOT EXISTS ledger_entries (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      transaction_id INTEGER NOT NULL,
      account_id INTEGER NOT NULL,
      entry_type TEXT CHECK(entry_type IN ('DEBIT', 'CREDIT')) NOT NULL,
      amount INTEGER NOT NULL CHECK(amount > 0),
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(transaction_id) REFERENCES transactions(id),
      FOREIGN KEY(account_id) REFERENCES accounts(id)
    )
  `);

  // 5. Cryptographic Append-Only Audit Trail (Chained SHA-256 Hashes)
  db.run(`
    CREATE TABLE IF NOT EXISTS audit_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      action TEXT NOT NULL,
      actor_id INTEGER,
      details TEXT NOT NULL,
      prev_hash TEXT NOT NULL,
      hash TEXT NOT NULL,
      timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);
});

module.exports = db;