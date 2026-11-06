# Threat Modeling & Integrity Defense (THREATS.md)

This document maps potential financial threat vectors against LedgerLine's architectural and database defenses, verified by automated test suites.

---

### Threat 1: Race Condition & Double-Spending (Simultaneous Withdrawals)
* **Attack Vector:** An attacker issues multiple concurrent HTTP requests to withdraw ₹500 simultaneously from an account holding only ₹500. If the server reads the balance concurrently before writing, balance could drop to negative or pay twice.
* **Defense Mechanism:** Enforced `BEGIN EXCLUSIVE TRANSACTION` in SQLite / row-level `FOR UPDATE` locking. The database acquires an exclusive write lock immediately before reading balances, serializing execution.
* **Secondary Defense:** Database engine constraint `CHECK(balance >= 0)`.
* **Verification:** Tested in `test_integrity.js` (Test 3: Overdraft attempt rejection and state rollback).

---

### Threat 2: Network Retry & Replay Exploits (Duplicate Payouts)
* **Attack Vector:** A network drop or timeout causes a client/gateway to resend a transfer request, resulting in duplicate fund deductions.
* **Defense Mechanism:** Strict requirement of an `Idempotency-Key` header on `/api/transfers`. All incoming requests check the `transactions` table for the key prior to transaction initiation. Replayed keys return the original transaction receipt without altering ledger state.
* **Verification:** Tested in `test_integrity.js` (Test 2: Replaying identical idempotency key).

---

### Threat 3: Broken Object-Level Authorization / IDOR (Account Draining)
* **Attack Vector:** An authenticated user (`ACCOUNT_HOLDER`) alters the `fromAccountId` field in the JSON payload to transfer money out of another user's account.
* **Defense Mechanism:** Server-side ownership verification query in `/api/transfers`. The API explicitly validates `source.user_id === req.user.id` before processing transactions. Only `ADMIN` role can execute cross-account transfers.
* **Verification:** Enforced via RBAC middleware and ownership asserts in `server.js`.

---

### Threat 4: Audit Log Tampering (Silent Ledger Manipulation)
* **Attack Vector:** A rogue database admin or attacker modifies ledger balances directly or deletes transaction history.
* **Defense Mechanism:** Cryptographic SHA-256 hash chaining on `audit_logs` table (`prev_hash` + payload -> `hash`). Any altered or deleted record breaks the cryptographic chain, making tampering mathematically detectable.
* **Verification:** Chain computed in `ledgerService.js` (`logAudit`).

---

### Threat 5: Floating-Point Precision Leakage
* **Attack Vector:** Storing financial numbers as IEEE-754 floats (`0.1 + 0.2 = 0.30000000000000004`), leading to fractional penny drift over time.
* **Defense Mechanism:** Storing all balances and transfer amounts as integers representing the smallest unit of currency (paise/cents). Integer validation (`Number.isInteger`) enforced on all inputs.