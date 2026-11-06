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