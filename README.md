# TxSignX Web

**Inspect. Verify. Sign with Confidence.**

Web presentation layer for TxSignX Bitcoin transaction and PSBT security analysis.

> **Positioning:** Not another wallet. A security layer for wallets.

TxSignX Web connects to the local `txsignx-api` HTTP service to inspect raw Bitcoin transactions and PSBTs, evaluate deterministic security policies, and display findings, risk levels, and rule coverage before signing.

## Architecture and Authority

The web interface is strictly a presentation layer. It does **not** evaluate security rules, calculate fee ratios, or decide `PASS`, `REVIEW`, or `BLOCK`.

```
Browser (React + TypeScript + Vite)
  ↓ HTTP/JSON (loopback only)
txsignx-api (Local Axum service)
  ↓
txsignx-core + txsignx-wallet + txsignx-node + txsignx-policy
  ↓
PolicyReport
  ↓
PASS / REVIEW / BLOCK
```

All decisions, findings, and evaluation coverage are returned directly by the Rust policy engine (`txsignx-policy`).

## Development Setup

### Prerequisites

- Node.js 24 LTS and npm
- A running local instance of `txsignx-api` (see the [Rust repository](https://github.com/j-kon/txsignx))

### Install and Run

```sh
npm ci
VITE_TXSIGNX_API_URL=http://127.0.0.1:8080 npm run dev -- --host 127.0.0.1
```

By default, the Vite development server starts at `http://localhost:5173` or `http://127.0.0.1:5173`.

### Environment Configuration

| Variable | Default | Description |
| --- | --- | --- |
| `VITE_TXSIGNX_API_URL` | `http://127.0.0.1:8080` | URL of the local `txsignx-api` service |

The browser communicates exclusively with this configured endpoint. No analytics, remote telemetry, or third-party network requests are made.

## Verification

```sh
npm run lint    # Run Oxlint
npm run build   # TypeScript type check (tsc -b) and Vite bundle
npm test        # Run Vitest test suite
```

## User Flow

1. **Home**: High-level problem statement, trust boundaries, and real preflight preview.
2. **Inspector**: Paste raw transaction hex or PSBT base64, load public synthetic fixtures, or upload a `.psbt`/`.hex` file.
3. **Preflight**: Configure optional fee thresholds, public wallet descriptors (with derivation window and expected change output indexes), and local node verification.
4. **Inspection & Preflight Results**: View consensus facts, fee status, signing state, explicit RBF signaling, policy findings, and distinct rule coverage sections (**Evaluated**, **Partially Evaluated**, and **Not Evaluated**).
5. **Policies**: Browse the live active and deferred policy registry fetched directly from Rust.
6. **Report Export**: Explicitly copy or download structured JSON reports.

## Security and Privacy Boundaries

- **No Private Keys**: Never enter private keys, seed phrases, WIF, `xprv`, or `tprv`. Only public descriptors (`xpub`/`tpub`) are supported.
- **No Local Storage**: Transactions, PSBTs, and descriptors are held only in memory and are never persisted to `localStorage`, `sessionStorage`, cookies, or browser history URLs.
- **No Console Dumps**: PSBTs and descriptor contents are never logged to the browser console.
- **No Web Broadcast**: The web app has no broadcast button and does not send transactions to any public network.
- **Scoped Meaning of PASS**: `PASS` means *"No evaluated active rule requires review or blocking."* It is not an authorization to sign or a guarantee that unevaluated checks took place.

## Related Repositories

- [Rust Engine & API (`txsignx`)](https://github.com/j-kon/txsignx)
- [Documentation (`txsignx-docs`)](https://github.com/j-kon/txsignx-docs)
