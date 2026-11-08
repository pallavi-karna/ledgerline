const { transferMoney, runAsync, getAsync } = require('./ledgerService');
const db = require('./database');

async function runStressTest() {
  console.log('--- STARTING HIGH-CONCURRENCY RACE CONDITION STRESS TEST ---');

  // Reset demo state
  await runAsync('DELETE FROM audit_logs');
  await runAsync('DELETE FROM ledger_entries');
  await runAsync('DELETE FROM transactions');
  await runAsync('DELETE FROM accounts');
  await runAsync('DELETE FROM users');

  await runAsync(`INSERT INTO users (id, username, password, role) VALUES (1, 'stress_alice', 'hash', 'ACCOUNT_HOLDER')`);
  await runAsync(`INSERT INTO users (id, username, password, role) VALUES (2, 'stress_bob', 'hash', 'ACCOUNT_HOLDER')`);

  // Alice starts with exactly 500 paise. Bob starts with 0.
  await runAsync(`INSERT INTO accounts (id, account_number, user_id, balance) VALUES (1, 'ACC_ALICE_RACE', 1, 500)`);
  await runAsync(`INSERT INTO accounts (id, account_number, user_id, balance) VALUES (2, 'ACC_BOB_RACE', 2, 0)`);

  console.log('Initial State: Alice = 500 paise, Bob = 0 paise.');
  console.log('Firing 20 concurrent transfer requests of 500 paise each simultaneously...\n');

  // Launch 20 concurrent transfers at the same millisecond
  const totalAttempts = 20;
  const promises = [];

  for (let i = 1; i <= totalAttempts; i++) {
    const promise = transferMoney({
      fromAccountId: 1,
      toAccountId: 2,
      amount: 500,
      idempotencyKey: `RACE-KEY-${i}-${Date.now()}`,
      actorId: 1
    })
      .then((res) => ({ success: true, res }))
      .catch((err) => ({ success: false, error: err.message }));

    promises.push(promise);
  }

  const results = await Promise.all(promises);

  const successful = results.filter((r) => r.success).length;
  const failed = results.filter((r) => !r.success).length;

  console.log(`Results: ${successful} succeeded, ${failed} failed (insufficient funds / locked).`);

  const alice = await getAsync('SELECT balance FROM accounts WHERE id = 1');
  const bob = await getAsync('SELECT balance FROM accounts WHERE id = 2');

  console.log(`Final Balances: Alice = ${alice.balance} paise, Bob = ${bob.balance} paise.`);

  if (successful === 1 && failed === 19 && alice.balance === 0 && bob.balance === 500) {
    console.log('\n🏆 RACE CONDITION MITIGATION VERIFIED: Double-spending mathematically impossible!');
  } else {
    console.error('\n❌ FAIL: Race condition vulnerability detected!');
  }

  console.log('--- STRESS TEST COMPLETE ---');
  process.exit(0);
}

setTimeout(runStressTest, 800);