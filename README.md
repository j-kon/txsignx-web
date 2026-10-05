# TxSignX Web

**Inspect. Verify. Sign with Confidence.**

Web presentation layer for TxSignX Bitcoin transaction and PSBT security analysis.

> **Positioning:** Not another wallet. A security layer for wallets.

TxSignX Web connects to the local `txsignx-api` HTTP service to inspect PSBTs, raw transactions, and transaction IDs (via server-configured Bitcoin Core node), evaluate deterministic security policies, and display findings, risk levels, and rule coverage before signing.

## 🎥 Demo

[▶ Watch the full TxSignX Demo on Loom](https://www.loom.com/share/a6853cc366ef4c419085bb0ee5c599b4)

A walkthrough of TxSignX inspecting Bitcoin transactions and pre-signing packages:
- **Raw Bitcoin transaction inspection**: Decodes consensus-serialized hex and disassembles scripts.
- **TXID lookup through Bitcoin Core**: Contextualizes transactions with node-verified chain state.
- **Inputs, outputs, scripts, and witness inspection**: Detailed breakdown of prevouts, sequence numbers, scriptPubKeys, and witness items.
- **SegWit and RBF detection**: Identifies witness presence and explicit `nSequence` opt-in RBF signaling.
- **Confirmed and mempool transaction states**: Distinguishes unconfirmed mempool transactions from confirmed block-anchored transactions without fabricating data.
- **Fee and fee-rate calculation**: Computes total input/output value, absolute fee, and sat/vB fee rate when prevouts are resolved.
- **PSBT v0 pre-signing analysis**: Preflight verification for unsigned or partially signed BIP174 packages.
- **PASS, REVIEW, and BLOCK policy results**: Deterministic rule evaluation highlighting non-critical warnings and critical policy violations.

> **Note:** TxSignX Web is strictly the presentation layer. All transaction decoding, address derivation, witness parsing, and security policy evaluations are performed by the [TxSignX Rust backend](https://github.com/j-kon/txsignx).

## Architecture and Authority

The web interface is strictly a presentation layer. It does **not** evaluate security rules, calculate fee ratios, or decide `PASS`, `REVIEW`, or `BLOCK`.

```
Browser (React + TypeScript + Vite)
  ↓ HTTP/JSON (loopback only)
txsignx-api (Local Axum service)
  ↓
txsignx-core + txsignx-wallet + txsignx-node + txsignx-policy
  ↓
TransactionReport / PsbtReport / PreflightReport
  ↓
Transaction Explorer / Preflight Policy
```

All Bitcoin interpretation, script disassembly, address derivation, and security policies are evaluated directly by the Rust engine (`txsignx-core`, `txsignx-policy`).

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

## Live sessions

Live Chain opens the configured API's WebSocket stream and fetches an initial snapshot.
Incoming transactions update the session list immediately. The app also refreshes the
snapshot every 15 seconds, resyncs after reconnection, and refreshes when you return
to the tab or regain connectivity. Requests do not overlap; stream events received
during a fetch are merged into its snapshot so older responses cannot undo updates.

Live Flow defaults to an activity board with fee-rate lanes, transaction-ID filtering,
and a median calculated only from known fees in the displayed observation sample.
Pause display holds the board steady while the feed keeps fetching; Resume live
shows the latest state. The time stream and dependency graph remain optional views.
The detailed transaction list is expandable below the board.

The session shows the last received time, a manual refresh action, and delayed or
unavailable states. Existing observations remain visible if a refresh fails. The
animated stream distinguishes new arrivals from previously fetched observations.
All feed and inspection state stays in memory.

For public Bitcoin mainnet data without a local Bitcoin Core node, start the backend
from the sibling `txsignx` repository:

```sh
cargo run -p txsignx-api -- --live-source public_mainnet
```

The public source supplies network observations; node-backed pre-sign verification
still requires a configured Bitcoin Core node. The frontend always requests data
through `VITE_TXSIGNX_API_URL` rather than contacting public providers directly.

## Verification

```sh
npm run lint    # Run Oxlint
npm run build   # TypeScript type check (tsc -b) and Vite bundle
npm test        # Run Vitest test suite
```

## User Flow

1. **Home**: High-level problem statement, trust boundaries, and real preflight preview.
2. **Inspector**: Inspect PSBT v0 base64, raw transaction hex (with optional network address derivation), or transaction ID (via server-configured Bitcoin Core node), load public synthetic fixtures, or upload a `.b64`/`.hex` text file.
3. **Preflight**: Configure optional fee thresholds, public wallet descriptors (with derivation window and expected change output indexes), and local node verification.
4. **Inspection & Preflight Results**: View Transaction Explorer factual observations (inputs, prevouts, addresses, script disassembly opcodes, fees, vsize, weight, locktime, and confirmed/mempool chain context) or preflight policy evaluation (PASS / REVIEW / BLOCK with findings and rule coverage).
5. **Policies**: Browse the live active and deferred policy registry fetched directly from Rust.
6. **Report Export**: Explicitly copy or download structured JSON reports.

## Security and Privacy Boundaries

- **No Private Keys**: Never enter private keys, seed phrases, WIF, `xprv`, or `tprv`. Only public descriptors (`xpub`/`tpub`) are supported.
- **Zero Node Credentials in Browser**: Bitcoin Core RPC credentials reside exclusively on the server running `txsignx-api`. The web interface never accepts, manages, or stores node credentials.
- **No Local Storage**: Transactions, PSBTs, and descriptors are held only in memory and are never persisted to `localStorage`, `sessionStorage`, cookies, or browser history URLs.
- **No Console Dumps**: PSBTs and descriptor contents are never logged to the browser console.
- **No Web Broadcast**: The web app has no broadcast button and does not send transactions to any public network.
- **Scoped Meaning of PASS**: `PASS` means *"No evaluated active rule requires review or blocking."* It is not an authorization to sign or a guarantee that unevaluated checks took place.

## Related Repositories

- [TxSignX Rust Engine & API (`txsignx`)](https://github.com/j-kon/txsignx) — Core Bitcoin decoding, node integration, and deterministic policy engine
- [Documentation (`txsignx-docs`)](https://github.com/j-kon/txsignx-docs)
