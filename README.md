# Multi-Sig Vault

Build a REST API for a multi-signature vault system. Vaults have M-of-N threshold signing, PDA-derived addresses, ed25519 signature verification for proposal approval, and a key-value data store governed by multi-sig consensus. All data is stored in memory.

## Core Concepts
- **Vaults** have N signers and require M signatures (threshold) to execute proposals
- **Vault addresses** are PDAs derived from the sorted signer public keys
- **Proposals** require ed25519 signatures for approval and cancellation
- **PDA derivation**: `findProgramAddressSync([Buffer.from("vault"), sha256(sortedSigners.join(":"))], PROGRAM_ID)`
- **PROGRAM_ID**: `11111111111111111111111111111111` (System Program, used for PDA derivation only)

## Requirements

### Vault Management

- **POST /api/vault/create** — Create a multi-sig vault
  - Body: `{ signers: string[], threshold: number, label: string }`
  - Validate: all signers are valid Solana public keys, no duplicates, signers.length >= 2, threshold >= 1, threshold <= signers.length, label is non-empty
  - Vault PDA: `findProgramAddressSync([Buffer.from("vault"), sha256Hash], PROGRAM_ID)` where `sha256Hash = crypto.createHash("sha256").update(sortedSignerAddresses.join(":")).digest()`
  - Response `201`: `{ id, label, address, threshold, bump, signers: string[], createdAt }`
  - Response `400`: invalid inputs
  - Response `409`: vault with same signer set already exists (same sorted signers = same PDA)

- **GET /api/vault/:vaultId** — Get vault details
  - Response `200`: `{ id, label, address, threshold, bump, signers, proposalCount: number, createdAt }`
  - Response `404`: `{ error: "Vault not found" }`

### Proposals

- **POST /api/vault/:vaultId/propose** — Create a proposal
  - Body: `{ proposer: string, action: string, params: object }`
  - `proposer` must be one of the vault's signers
  - Actions:
    - `"transfer"`: params `{ to: string, amount: number }` — `to` must be valid pubkey, `amount` > 0
    - `"set_data"`: params `{ key: string, value: string }` — both non-empty strings
    - `"memo"`: params `{ content: string }` — non-empty string
  - Response `201`: `{ id, vaultId, proposer, action, params, status: "pending", signatures: [], createdAt }`
  - Response `400`: invalid action or params
  - Response `403`: `{ error: "Not a vault signer" }`
  - Response `404`: vault not found

- **POST /api/vault/:vaultId/proposals/:proposalId/approve** — Approve a proposal
  - Body: `{ signer: string, signature: string }`
  - Message signed: `"approve:<proposalId>"` (proposalId is the numeric ID)
  - Verify ed25519 signature
  - If threshold reached → auto-execute:
    - `"set_data"`: upsert key-value in vault data store
    - `"transfer"`, `"memo"`: mark as executed (simulated)
  - Response `200`: `{ id, vaultId, proposer, action, params, status, signatures: [{signer, createdAt}], executedAt? }`
  - Response `400`: `{ error: "Invalid signature" }`
  - Response `403`: `{ error: "Not a vault signer" }`
  - Response `404`: vault or proposal not found
  - Response `409`: `{ error: "Already signed" }` or `{ error: "Proposal already executed" }`

- **GET /api/vault/:vaultId/proposals** — List proposals
  - Query: `?status=pending|executed|cancelled` (optional filter)
  - Response `200`: array of proposals with signatures

- **GET /api/vault/:vaultId/proposals/:proposalId** — Get proposal details
  - Response `200`: full proposal with signatures
  - Response `404`: not found

### Cancellation

- **POST /api/vault/:vaultId/proposals/:proposalId/cancel** — Cancel a proposal
  - Body: `{ signer: string, signature: string }`
  - Message: `"cancel:<proposalId>"`
  - Only the original proposer can cancel; proposal must be "pending"
  - Response `200`: cancelled proposal (status: "cancelled")
  - Response `400`: `{ error: "Invalid signature" }`
  - Response `403`: `{ error: "Only the proposer can cancel" }`
  - Response `404`: not found
  - Response `409`: `{ error: "Proposal already executed" }` or `{ error: "Proposal already cancelled" }`

### Data Store

- **GET /api/vault/:vaultId/data** — Get vault data store
  - Response `200`: `{ data: { [key: string]: string } }`
  - Response `404`: vault not found

## Tech Stack
- **Runtime**: Bun.js with TypeScript (tsx)
- **Framework**: Express.js
- **Libraries**: `@solana/web3.js`, `bs58`, `tweetnacl`, Bun.js `crypto`
- **Storage**: In-memory (no database)

## Start Command
```
bun run dev
```
The server must listen on port **3000**. No database is needed — all data is stored in memory.

## Notes
- Vault PDA uses sha256 hash of sorted signer addresses joined by ":"
- ed25519 signatures verified with `nacl.sign.detached.verify`
- Proposals auto-execute when signature count reaches the vault threshold
- `set_data` proposals upsert into a key-value store; other actions are simulated
