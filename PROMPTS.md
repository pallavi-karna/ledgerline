# AI Interaction & Human Oversight Log (PROMPTS.md)

### Entry 1: 2026-11-06 — Project Initialization & Dependency Selection
* **Task / Prompt Given:** Requesting scaffolding for Node.js Express backend and cryptographic dependencies for double-entry ledger hashing.
* **What the AI Suggested:** Suggested installing `crypto` via npm (`npm install crypto`).
* **What Was Wrong / The Flaw:** In Node.js modern runtimes, `crypto` has long been an internal core module. Installing the deprecated npm package introduces redundant legacy wrappers and potential security flags.
* **What I Did Instead:** Removed the npm package (`npm uninstall crypto`) and opted directly for Node.js native `node:crypto` standard library for audit hash chains.