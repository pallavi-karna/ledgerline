const express = require('express');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const db = require('./database');
const { transferMoney, logAudit, runAsync, getAsync } = require('./ledgerService');

const app = express();
app.use(cors());
app.use(express.json());

const JWT_SECRET = process.env.JWT_SECRET || 'ledgerline_super_secure_secret_key_2026';

// 1. Health check endpoint (Mandatory for live testing)
app.get('/api/health', (req, res) => {
  res.json({ status: 'UP', timestamp: new Date().toISOString() });
});

// 2. Authentication Middleware with Role Checks
const authenticate = (roles = []) => {
  return (req, res, next) => {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Missing or malformed Authorization header.' });
    }

    const token = authHeader.split(' ')[1];
    try {
      const decoded = jwt.verify(token, JWT_SECRET);
      if (roles.length && !roles.includes(decoded.role)) {
        return res.status(403).json({ error: 'Forbidden: Insufficient privileges.' });
      }
      req.user = decoded;
      next();
    } catch (err) {
      return res.status(401).json({ error: 'Invalid or expired token.' });
    }
  };
};

// 3. User Registration (Admin only or bootstrap)
app.post('/api/auth/register', async (req, res) => {
  const { username, password, role } = req.body;
  if (!username || !password || !role) {
    return res.status(400).json({ error: 'Username, password, and role are required.' });
  }

  try {
    const hashedPassword = await bcrypt.hash(password, 10);
    const result = await runAsync(
      `INSERT INTO users (username, password, role) VALUES (?, ?, ?)`,
      [username, hashedPassword, role]
    );

    await logAudit('USER_REGISTERED', result.lastID, { username, role });
    res.status(201).json({ id: result.lastID, username, role });
  } catch (err) {
    res.status(400).json({ error: 'Username already exists or database constraint failed.' });
  }
});

// 4. User Login
app.post('/api/auth/login', async (req, res) => {
  const { username, password } = req.body;
  try {
    const user = await getAsync(`SELECT * FROM users WHERE username = ?`, [username]);
    if (!user || !(await bcrypt.compare(password, user.password))) {
      return res.status(401).json({ error: 'Invalid credentials.' });
    }

    const token = jwt.sign({ id: user.id, username: user.username, role: user.role }, JWT_SECRET, {
      expiresIn: '8h',
    });

    await logAudit('USER_LOGIN', user.id, { username });
    res.json({ token, role: user.role, username: user.username });
  } catch (err) {
    res.status(500).json({ error: 'Internal server error during login.' });
  }
});

// 5. Account Creation (Admin or Account Holder)
app.post('/api/accounts', authenticate(['ADMIN']), async (req, res) => {
  const { userId, accountNumber, initialBalance = 0 } = req.body;
  try {
    const result = await runAsync(
      `INSERT INTO accounts (account_number, user_id, balance) VALUES (?, ?, ?)`,
      [accountNumber, userId, initialBalance]
    );

    await logAudit('ACCOUNT_CREATED', req.user.id, { accountNumber, userId, initialBalance });
    res.status(201).json({ id: result.lastID, accountNumber, balance: initialBalance });
  } catch (err) {
    res.status(400).json({ error: 'Account number already exists or invalid data.' });
  }
});

// 6. View Accounts
app.get('/api/accounts', authenticate(['ADMIN', 'AUDITOR', 'ACCOUNT_HOLDER']), async (req, res) => {
  try {
    let rows;
    if (req.user.role === 'ACCOUNT_HOLDER') {
      rows = await new Promise((resolve, reject) => {
        db.all('SELECT * FROM accounts WHERE user_id = ?', [req.user.id], (err, r) => (err ? reject(err) : resolve(r)));
      });
    } else {
      rows = await new Promise((resolve, reject) => {
        db.all('SELECT * FROM accounts', [], (err, r) => (err ? reject(err) : resolve(r)));
      });
    }
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: 'Failed to retrieve accounts.' });
  }
});

// 7. Execute Transfer (Enforces Idempotency Header & Double-Entry)
app.post('/api/transfers', authenticate(['ADMIN', 'ACCOUNT_HOLDER']), async (req, res) => {
  const idempotencyKey = req.headers['idempotency-key'] || req.body.idempotencyKey;
  if (!idempotencyKey) {
    return res.status(400).json({ error: 'Idempotency-Key header is required for transfers.' });
  }

  const { fromAccountId, toAccountId, amount } = req.body;

  try {
    // If account holder, verify they own the source account
    if (req.user.role === 'ACCOUNT_HOLDER') {
      const source = await getAsync('SELECT user_id FROM accounts WHERE id = ?', [fromAccountId]);
      if (!source || source.user_id !== req.user.id) {
        return res.status(403).json({ error: 'Unauthorized to transfer from this account.' });
      }
    }

    const outcome = await transferMoney({
      fromAccountId,
      toAccountId,
      amount: parseInt(amount, 10),
      idempotencyKey,
      actorId: req.user.id,
    });

    res.status(outcome.status === 'DUPLICATE' ? 200 : 201).json(outcome);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// 8. View Audit Trail (Auditor & Admin Only)
app.get('/api/audit', authenticate(['ADMIN', 'AUDITOR']), async (req, res) => {
  try {
    const logs = await new Promise((resolve, reject) => {
      db.all('SELECT * FROM audit_logs ORDER BY id ASC', [], (err, rows) => (err ? reject(err) : resolve(rows)));
    });
    res.json(logs);
  } catch (err) {
    res.status(500).json({ error: 'Failed to retrieve audit records.' });
  }
});

const path = require('path');

// Serve frontend build in production
app.use(express.static(path.join(__dirname, '../frontend/dist')));
app.use((req, res) => {
  res.sendFile(path.join(__dirname, '../frontend/dist/index.html'));
});

const PORT = process.env.PORT || 8080;
app.listen(PORT, () => {
  console.log(`LedgerLine backend running on port ${PORT}`);
});