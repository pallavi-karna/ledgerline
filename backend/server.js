const express = require('express');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const path = require('node:path');

const {
  transferMoney,
  getAsync,
  allAsync,
  verifyAuditChain
} = require('./ledgerService');

const app = express();
const JWT_SECRET = process.env.JWT_SECRET || 'ledgerline_super_secret_jwt_key_2026';

app.use(cors());
app.use(express.json());

// Authentication Middleware
function authenticateToken(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    return res.status(401).json({ error: 'Access token required.' });
  }

  jwt.verify(token, JWT_SECRET, (err, user) => {
    if (err) return res.status(403).json({ error: 'Invalid or expired token.' });
    req.user = user;
    next();
  });
}

// Role-Based Authorization Middleware
function authorizeRoles(...allowedRoles) {
  return (req, res, next) => {
    if (!req.user || !allowedRoles.includes(req.user.role)) {
      return res.status(403).json({ error: 'Access forbidden: Insufficient permissions.' });
    }
    next();
  };
}

// --- AUTH ROUTES ---
app.post('/api/auth/register', async (req, res) => {
  const { username, password, role = 'ACCOUNT_HOLDER' } = req.body;
  if (!username || !password) {
    return res.status(400).json({ error: 'Username and password required.' });
  }

  try {
    const hashedPassword = await bcrypt.hash(password, 10);
    const { runAsync } = require('./ledgerService');
    const result = await runAsync(
      `INSERT INTO users (username, password, role) VALUES (?, ?, ?)`,
      [username, hashedPassword, role]
    );

    // Auto-create initial account for new account holders
    if (role === 'ACCOUNT_HOLDER') {
      const accNum = `ACC_${username.toUpperCase()}_${Date.now().toString().slice(-4)}`;
      await runAsync(
        `INSERT INTO accounts (account_number, user_id, balance) VALUES (?, ?, 10000)`,
        [accNum, result.lastID]
      );
    }

    res.status(201).json({ message: 'User registered successfully.' });
  } catch (err) {
    res.status(400).json({ error: 'Username already taken or invalid.' });
  }
});

app.post('/api/auth/login', async (req, res) => {
  const { username, password } = req.body;
  try {
    const user = await getAsync(`SELECT * FROM users WHERE username = ?`, [username]);
    if (!user) return res.status(401).json({ error: 'Invalid credentials.' });

    const validPassword = await bcrypt.compare(password, user.password);
    if (!validPassword) return res.status(401).json({ error: 'Invalid credentials.' });

    const token = jwt.sign(
      { id: user.id, username: user.username, role: user.role },
      JWT_SECRET,
      { expiresIn: '8h' }
    );

    res.json({ token, role: user.role, username: user.username });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// --- ACCOUNT ROUTES ---
app.get('/api/accounts', authenticateToken, async (req, res) => {
  try {
    let accounts;
    if (req.user.role === 'ADMIN' || req.user.role === 'AUDITOR') {
      accounts = await allAsync(`SELECT * FROM accounts ORDER BY id ASC`);
    } else {
      accounts = await allAsync(`SELECT * FROM accounts WHERE user_id = ? ORDER BY id ASC`, [req.user.id]);
    }
    res.json(accounts);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// --- TRANSFER ROUTE WITH IDOR & CONCURRENCY CHECKS ---
app.post('/api/transfers', authenticateToken, async (req, res) => {
  const { fromAccountId, toAccountId, amount } = req.body;
  const idempotencyKey = req.headers['idempotency-key'];

  try {
    // IDOR Prevention: verify user owns the source account unless Admin
    if (req.user.role !== 'ADMIN') {
      const sourceAcc = await getAsync(`SELECT user_id FROM accounts WHERE id = ?`, [fromAccountId]);
      if (!sourceAcc || sourceAcc.user_id !== req.user.id) {
        return res.status(403).json({ error: 'Unauthorized: Cannot initiate transfers from accounts you do not own.' });
      }
    }

    const result = await transferMoney({
      fromAccountId,
      toAccountId,
      amount,
      idempotencyKey,
      actorId: req.user.id
    });

    res.json(result);
  } catch (err) {
    const status = err.message.includes('Conflict') ? 409 : 400;
    res.status(status).json({ error: err.message });
  }
});

// --- AUDIT TRAIL ROUTES ---
app.get('/api/audit', authenticateToken, authorizeRoles('ADMIN', 'AUDITOR'), async (req, res) => {
  try {
    const logs = await allAsync(`SELECT * FROM audit_logs ORDER BY id DESC LIMIT 50`);
    res.json(logs);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/audit/verify', authenticateToken,  authorizeRoles('ADMIN', 'AUDITOR'), async (req, res) => {
  try {
    const result = await verifyAuditChain();
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// --- STATIC ASSET SERVING & FALLBACK FOR PRODUCTION ---
app.use(express.static(path.join(__dirname, '../frontend/dist')));
app.use((req, res) => {
  res.sendFile(path.join(__dirname, '../frontend/dist/index.html'));
});

const PORT = process.env.PORT || 8080;
app.listen(PORT, () => {
  console.log(`LedgerLine backend running on port ${PORT}`);
});