const crypto = require('node:crypto');
const db = require('./database');

// Ensure SQLite queues simultaneous incoming queries instead of crashing with SQLITE_BUSY
db.configure('busyTimeout', 5000);

const GENESIS_HASH = '0000000000000000000000000000000000000000000000000000000000000000';

function runAsync(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function (err) {
      if (err) reject(err);
      else resolve(this);
    });
  });
}

function getAsync(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => {
      if (err) reject(err);
      else resolve(row);
    });
  });
}

function allAsync(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => {
      if (err) reject(err);
      else resolve(rows);
    });
  });
}

// SHA-256 Hash Chained Audit Logger
async function logAudit(action, actorId, details) {
  const lastLog = await getAsync('SELECT hash FROM audit_logs ORDER BY id DESC LIMIT 1');
  const prevHash = lastLog ? lastLog.hash : GENESIS_HASH;
  const timestamp = new Date().toISOString();
  const detailsStr = typeof details === 'string' ? details : JSON.stringify(details);

  const payload = `${prevHash}|${action}|${actorId}|${detailsStr}|${timestamp}`;
  const currentHash = crypto.createHash('sha256').update(payload).digest('hex');

  await runAsync(
    `INSERT INTO audit_logs (prev_hash, hash, action, actor_id, details, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [prevHash, currentHash, action, actorId, detailsStr, timestamp]
  );

  return currentHash;
}

// Cryptographic Audit Chain Verification
async function verifyAuditChain() {
  const logs = await allAsync('SELECT * FROM audit_logs ORDER BY id ASC');
  if (logs.length === 0) return { valid: true, count: 0 };

  for (let i = 0; i < logs.length; i++) {
    const current = logs[i];
    const expectedPrev = i === 0 ? GENESIS_HASH : logs[i - 1].hash;

    if (current.prev_hash !== expectedPrev) {
      return { valid: false, brokenAtIndex: current.id, reason: 'prev_hash mismatch' };
    }

    const payload = `${current.prev_hash}|${current.action}|${current.actor_id}|${current.details}|${current.created_at}`;
    const calculatedHash = crypto.createHash('sha256').update(payload).digest('hex');

    if (current.hash !== calculatedHash) {
      return { valid: false, brokenAtIndex: current.id, reason: 'tampered payload hash' };
    }
  }

  return { valid: true, count: logs.length };
}

// Core Double-Entry Money Transfer
async function transferMoney({ fromAccountId, toAccountId, amount, idempotencyKey, actorId }) {
  // Input Validation Guards
  if (!Number.isInteger(amount) || amount <= 0) {
    throw new Error('Transfer amount must be a positive integer in minor units (paise).');
  }

  if (parseInt(fromAccountId) === parseInt(toAccountId)) {
    throw new Error('Self-transfer rejected: Sender and recipient accounts cannot be identical.');
  }

  if (!idempotencyKey || typeof idempotencyKey !== 'string') {
    throw new Error('Missing or invalid Idempotency-Key.');
  }

  // Calculate signature of the payload to catch key replay with altered amounts
  const requestPayloadSig = crypto
    .createHash('sha256')
    .update(`${fromAccountId}->${toAccountId}:${amount}`)
    .digest('hex');

  // Check if idempotency key was already seen
  const existingTx = await getAsync(
    'SELECT * FROM transactions WHERE idempotency_key = ?',
    [idempotencyKey]
  );

  if (existingTx) {
    if (existingTx.reference !== requestPayloadSig) {
      throw new Error('409 Conflict: Idempotency key reused with mismatched transfer parameters.');
    }
    return { status: 'DUPLICATE', transaction: existingTx };
  }

  // Execute transfer in exclusive write lock mode
  await runAsync('BEGIN EXCLUSIVE TRANSACTION');

  try {
    const source = await getAsync('SELECT * FROM accounts WHERE id = ?', [fromAccountId]);
    const dest = await getAsync('SELECT * FROM accounts WHERE id = ?', [toAccountId]);

    if (!source) throw new Error(`Source account #${fromAccountId} not found.`);
    if (!dest) throw new Error(`Destination account #${toAccountId} not found.`);
    if (source.balance < amount) {
      throw new Error(`Insufficient funds: Available ${source.balance} paise, requested ${amount} paise.`);
    }

    // Debit source
    await runAsync('UPDATE accounts SET balance = balance - ? WHERE id = ?', [amount, fromAccountId]);
    // Credit destination
    await runAsync('UPDATE accounts SET balance = balance + ? WHERE id = ?', [amount, toAccountId]);

    // Record parent transaction
    const txRes = await runAsync(
      `INSERT INTO transactions (idempotency_key, from_account_id, to_account_id, amount, currency, status, reference)
       VALUES (?, ?, ?, ?, ?, 'COMPLETED', ?)`,
      [idempotencyKey, fromAccountId, toAccountId, amount, source.currency, requestPayloadSig]
    );

    const txId = txRes.lastID;

    // Record double-entry legs: 1 DEBIT and 1 CREDIT
    await runAsync(
      `INSERT INTO ledger_entries (transaction_id, account_id, entry_type, amount, balance_after)
       VALUES (?, ?, 'DEBIT', ?, ?)`,
      [txId, fromAccountId, amount, source.balance - amount]
    );

    await runAsync(
      `INSERT INTO ledger_entries (transaction_id, account_id, entry_type, amount, balance_after)
       VALUES (?, ?, 'CREDIT', ?, ?)`,
      [txId, toAccountId, amount, dest.balance + amount]
    );

    // Cryptographic audit entry
    await logAudit('TRANSFER', actorId, {
      txId,
      fromAccountId,
      toAccountId,
      amount,
      currency: source.currency
    });

    await runAsync('COMMIT');

    return {
      status: 'SUCCESS',
      transactionId: txId,
      fromAccountId,
      toAccountId,
      amount,
      newSourceBalance: source.balance - amount
    };
  } catch (err) {
    await runAsync('ROLLBACK');
    throw err;
  }
}

module.exports = {
  runAsync,
  getAsync,
  allAsync,
  logAudit,
  verifyAuditChain,
  transferMoney
};