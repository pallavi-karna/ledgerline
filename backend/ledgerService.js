const crypto = require('node:crypto');
const db = require('./database');

// Helper to wrap SQLite calls in Promises
const runAsync = (sql, params = []) =>
  new Promise((resolve, reject) => {
    db.run(sql, params, function (err) {
      if (err) reject(err);
      else resolve(this);
    });
  });

const getAsync = (sql, params = []) =>
  new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => {
      if (err) reject(err);
      else resolve(row);
    });
  });

// 1. Calculate SHA-256 for cryptographic append-only audit trail
async function logAudit(action, actorId, details) {
  const lastLog = await getAsync('SELECT hash FROM audit_logs ORDER BY id DESC LIMIT 1');
  const prevHash = lastLog ? lastLog.hash : 'GENESIS_HASH_0000000000000000';
  
  const payload = `${prevHash}|${action}|${actorId}|${JSON.stringify(details)}|${Date.now()}`;
  const hash = crypto.createHash('sha256').update(payload).digest('hex');

  await runAsync(
    `INSERT INTO audit_logs (action, actor_id, details, prev_hash, hash) VALUES (?, ?, ?, ?, ?)`,
    [action, actorId, JSON.stringify(details), prevHash, hash]
  );
}

// 2. Atomic Money Transfer with Strict Concurrency & Idempotency
async function transferMoney({ fromAccountId, toAccountId, amount, idempotencyKey, actorId }) {
  if (amount <= 0 || !Number.isInteger(amount)) {
    throw new Error('Amount must be a positive integer in smallest currency unit (e.g., paise).');
  }
  if (fromAccountId === toAccountId) {
    throw new Error('Source and destination accounts must be different.');
  }

  // Idempotency Check: prevent duplicate execution
  const existingTx = await getAsync('SELECT * FROM transactions WHERE idempotency_key = ?', [idempotencyKey]);
  if (existingTx) {
    return { status: 'DUPLICATE', transaction: existingTx, message: 'Request already processed.' };
  }

  // BEGIN EXCLUSIVE TRANSACTION (SQLite concurrency lock)
  await runAsync('BEGIN EXCLUSIVE TRANSACTION');

  try {
    // Lock and check sender balance
    const sender = await getAsync('SELECT balance FROM accounts WHERE id = ?', [fromAccountId]);
    if (!sender) throw new Error('Sender account not found.');
    if (sender.balance < amount) throw new Error('Insufficient funds.');

    const receiver = await getAsync('SELECT balance FROM accounts WHERE id = ?', [toAccountId]);
    if (!receiver) throw new Error('Receiver account not found.');

    // Record Transaction
    const txResult = await runAsync(
      `INSERT INTO transactions (idempotency_key, type, amount, status) VALUES (?, 'TRANSFER', ?, 'SUCCESS')`,
      [idempotencyKey, amount]
    );
    const transactionId = txResult.lastID;

    // Double-Entry Ledger: 1 Debit + 1 Credit (Sum must equal 0)
    await runAsync(
      `INSERT INTO ledger_entries (transaction_id, account_id, entry_type, amount) VALUES (?, ?, 'DEBIT', ?)`,
      [transactionId, fromAccountId, amount]
    );
    await runAsync(
      `INSERT INTO ledger_entries (transaction_id, account_id, entry_type, amount) VALUES (?, ?, 'CREDIT', ?)`,
      [transactionId, toAccountId, amount]
    );

    // Apply Balances
    await runAsync('UPDATE accounts SET balance = balance - ? WHERE id = ?', [amount, fromAccountId]);
    await runAsync('UPDATE accounts SET balance = balance + ? WHERE id = ?', [amount, toAccountId]);

    // Append cryptographic audit entry
    await logAudit('TRANSFER', actorId, { transactionId, fromAccountId, toAccountId, amount });

    await runAsync('COMMIT');

    return { status: 'SUCCESS', transactionId, amount };
  } catch (err) {
    await runAsync('ROLLBACK');
    throw err;
  }
}

module.exports = {
  transferMoney,
  logAudit,
  runAsync,
  getAsync
};