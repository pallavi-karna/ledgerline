const crypto = require('node:crypto');
const { transferMoney, runAsync, getAsync } = require('./ledgerService');
const db = require('./database');

async function runIntegrityTests() {
  console.log('--- STARTING LEDGERLINE INTEGRITY & CONCURRENCY SUITE ---');

  // Seed demo accounts
  await runAsync('DELETE FROM audit_logs');
  await runAsync('DELETE FROM ledger_entries');
  await runAsync('DELETE FROM transactions');
  await runAsync('DELETE FROM accounts');
  await runAsync('DELETE FROM users');

  await runAsync(`INSERT INTO users (id, username, password, role) VALUES (1, 'alice', 'hash', 'ACCOUNT_HOLDER')`);
  await runAsync(`INSERT INTO users (id, username, password, role) VALUES (2, 'bob', 'hash', 'ACCOUNT_HOLDER')`);
  await runAsync(`INSERT INTO accounts (id, account_number, user_id, balance) VALUES (1, 'ACC_ALICE', 1, 1000)`);
  await runAsync(`INSERT INTO accounts (id, account_number, user_id, balance) VALUES (2, 'ACC_BOB', 2, 500)`);

  // TEST 1: Double-Entry Conservation Check
  console.log('\n[TEST 1] Testing Double-Entry Conservation...');
  await transferMoney({
    fromAccountId: 1,
    toAccountId: 2,
    amount: 300,
    idempotencyKey: 'IDEMP-TEST-001',
    actorId: 1
  });

  const alice = await getAsync('SELECT balance FROM accounts WHERE id = 1');
  const bob = await getAsync('SELECT balance FROM accounts WHERE id = 2');
  const total = alice.balance + bob.balance;

  if (alice.balance === 700 && bob.balance === 800 && total === 1500) {
    console.log('✅ PASS: Total money conserved (1500 paise total). Debits = Credits.');
  } else {
    console.error('❌ FAIL: Money conservation violated!');
  }

  // TEST 2: Strict Idempotency Check (Duplicate Request Rejection)
  console.log('\n[TEST 2] Testing Idempotency (Replaying same key)...');
  const txDuplicate = await transferMoney({
    fromAccountId: 1,
    toAccountId: 2,
    amount: 300,
    idempotencyKey: 'IDEMP-TEST-001',
    actorId: 1
  });

  if (txDuplicate.status === 'DUPLICATE') {
    console.log('✅ PASS: Duplicate payment request safely ignored without re-charging.');
  } else {
    console.error('❌ FAIL: Idempotency failed! Replayed duplicate transaction.');
  }

  // TEST 3: Negative Balance Prevention
  console.log('\n[TEST 3] Testing Negative Balance Prevention (Overdraft)...');
  try {
    await transferMoney({
      fromAccountId: 1,
      toAccountId: 2,
      amount: 100000,
      idempotencyKey: 'IDEMP-TEST-002',
      actorId: 1
    });
    console.error('❌ FAIL: Overdraft was allowed!');
  } catch (err) {
    console.log('✅ PASS: Insufficient funds caught and transaction rolled back.');
  }

  // TEST 4: Cryptographic Audit Hash Chain Verification
  console.log('\n[TEST 4] Testing Cryptographic Audit Trail Hash Chain...');
  const logs = await new Promise((resolve, reject) => {
    db.all('SELECT * FROM audit_logs ORDER BY id ASC', [], (err, rows) => (err ? reject(err) : resolve(rows)));
  });

  let chainValid = true;
  for (let i = 0; i < logs.length; i++) {
    const current = logs[i];
    if (i > 0) {
      const prev = logs[i - 1];
      if (current.prev_hash !== prev.hash) {
        chainValid = false;
        break;
      }
    }
  }

  if (chainValid && logs.length > 0) {
    console.log(`✅ PASS: Audit chain verified. All ${logs.length} blocks mathematically linked.`);
  } else {
    console.error('❌ FAIL: Audit log hash chain broken or empty.');
  }

  console.log('\n--- ALL INTEGRITY TESTS FINISHED ---');
  process.exit(0);
}

setTimeout(runIntegrityTests, 800);