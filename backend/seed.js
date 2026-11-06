const bcrypt = require('bcryptjs');
const { runAsync, logAudit } = require('./ledgerService');
const db = require('./database');

async function seed() {
  console.log('Seeding initial accounts and roles...');
  const passwordHash = await bcrypt.hash('password123', 10);

  // Clean existing demo data
  await runAsync('DELETE FROM audit_logs');
  await runAsync('DELETE FROM ledger_entries');
  await runAsync('DELETE FROM transactions');
  await runAsync('DELETE FROM accounts');
  await runAsync('DELETE FROM users');

  // Insert Users
  await runAsync(`INSERT INTO users (id, username, password, role) VALUES (1, 'admin', ?, 'ADMIN')`, [passwordHash]);
  await runAsync(`INSERT INTO users (id, username, password, role) VALUES (2, 'auditor', ?, 'AUDITOR')`, [passwordHash]);
  await runAsync(`INSERT INTO users (id, username, password, role) VALUES (3, 'alice', ?, 'ACCOUNT_HOLDER')`, [passwordHash]);
  await runAsync(`INSERT INTO users (id, username, password, role) VALUES (4, 'bob', ?, 'ACCOUNT_HOLDER')`, [passwordHash]);

  // Insert Accounts (Balances in paise: 50000 = ₹500.00)
  await runAsync(`INSERT INTO accounts (id, account_number, user_id, balance) VALUES (1, 'ACC_ALICE_01', 3, 50000)`);
  await runAsync(`INSERT INTO accounts (id, account_number, user_id, balance) VALUES (2, 'ACC_BOB_01', 4, 25000)`);

  await logAudit('SYSTEM_BOOTSTRAP', 1, { message: 'Demo accounts and roles seeded successfully' });

  console.log('✅ Seeding complete:');
  console.log('   Admin: admin / password123');
  console.log('   Auditor: auditor / password123');
  console.log('   Account Holders: alice / password123 (ACC #1), bob / password123 (ACC #2)');
  process.exit(0);
}

setTimeout(seed, 600);