# AI Interaction & Human Oversight Log (PROMPTS.md)

### Entry 1: 2026-11-06 — Project Initialization & Dependency Selection
* **Task / Prompt Given:** Requesting scaffolding for Node.js Express backend and cryptographic dependencies for double-entry ledger hashing.
* **What the AI Suggested:** Suggested installing `crypto` via npm (`npm install crypto`).
* **What Was Wrong / The Flaw:** In Node.js modern runtimes, `crypto` has long been an internal core module. Installing the deprecated npm package introduces redundant legacy wrappers and potential security flags.
* **What I Did Instead:** Removed the npm package (`npm uninstall crypto`) and opted directly for Node.js native `node:crypto` standard library for audit hash chains.
### Entry 2: 2026-11-06 — Concurrency Locking & Negative Balance Prevention
* **Task / Prompt Given:** Implementing the money transfer service with transaction atomicity, double-entry recording, and race-condition prevention.
* **What the AI Suggested:** Suggested using standard `BEGIN TRANSACTION` followed by application-level balance checks (`if balance >= amount`) before issuing `UPDATE` statements.
* **What Was Wrong / The Flaw:** A standard non-locking read in SQLite or relational DBs under high concurrent request volume allows double-spending (race condition) because two parallel threads can read the same positive balance before either commits an update. Furthermore, standard transactions default to deferred lock acquisition.
* **What I Did Instead:** Enforced `BEGIN EXCLUSIVE TRANSACTION` to acquire an immediate write lock at the start of the critical section, combined with a database engine-level `CHECK(balance >= 0)` constraint as a defense-in-depth barrier.
### Entry 3: 2026-11-06 — RBAC Authorization & Account-Level Ownership
- **Task / Prompt Given:** Designing API route handlers for funds transfers with role-based access control.
- **What the AI Suggested:** Suggested checking `if (req.user.role === 'ACCOUNT_HOLDER')` globally across the transfer endpoint and proceeding if the JWT was valid.
- **What Was Wrong / The Flaw:** This introduced a critical Insecure Direct Object Reference (IDOR) / Broken Object Level Authorization (BOLA) vulnerability. Any logged-in `ACCOUNT_HOLDER` could pass any `fromAccountId` in the JSON request body and drain another user's funds, because the endpoint only verified that the user had an account-holder role, not that they actually owned the specific source account.
- **What I Did Instead:** Added explicit ownership verification logic inside `/api/transfers`: querying `accounts` to assert `source.user_id === req.user.id` before executing the debit, and restricted full multi-account transfers exclusively to the `ADMIN` role.
### Entry 4: 2026-11-06 — Audit Trail Tamper-Evidence & Hash Chaining
- **Task / Prompt Given:** Designing the audit trail persistence mechanism to track all money movements and administrative actions.
- **What the AI Suggested:** Suggested a simple append-only SQL table recording timestamp, user_id, action, and JSON payload with standard autoincrement IDs.
- **What Was Wrong / The Flaw:** A simple table with standard autoincrement IDs provides zero cryptographic proof against internal tampering or database-level edits (`UPDATE`/`DELETE`). Anyone with database access could silently alter an audit record or delete a row without leaving a verifiable signature.
- **What I Did Instead:** Implemented a blockchain-inspired SHA-256 cryptographic hash chain where each audit log row computes its hash over `(prev_hash + action + actor_id + details + timestamp)`. Any mutation or deletion immediately breaks the mathematical chain verification.
### Entry 5: 2026-11-06 — Financial Precision & Floating-Point Drift
- **Task / Prompt Given:** Handling transfer amounts and account balances across API endpoints and database records.
- **What the AI Suggested:** Suggested using standard JavaScript `Number` types with decimals (e.g., `19.99`) and `FLOAT` / `REAL` in the database schema.
- **What Was Wrong / The Flaw:** Standard floating-point arithmetic in software environments conforms to IEEE-754 binary floating-point representation (`0.1 + 0.2 === 0.30000000000000004`). In a double-entry ledger where debits must identically balance credits, fractional rounding errors accumulate over high transaction volumes, leading to phantom currency leaks and reconciliation failures.
- **What I Did Instead:** Enforced integer arithmetic representing atomic minor currency units (paise/cents). Enforced strict `Number.isInteger(amount)` validation at runtime, paired with an integer database schema and strict non-negative check constraints.