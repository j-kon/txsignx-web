# TxSignX Web

Web interface for TxSignX Bitcoin transaction and PSBT security analysis.

## Status

React and TypeScript scaffold generated with Vite. Only a static setup placeholder
is present. Milestone 1 implementation has not started; no transaction input,
wallet connection, signing, analysis, or backend integration is implemented.

## Development

Use Node.js 24 LTS and npm. From this repository:

```sh
npm ci
npm run dev
```

## Verification

```sh
npm run build
npm run lint
```

The build performs TypeScript checking before Vite bundles the application.
Linting uses Oxlint from the Vite template. `npm run preview` serves the build locally.

## Related repositories

- [Rust engine](https://github.com/j-kon/txsignx)
- [Documentation](https://github.com/j-kon/txsignx-docs)

Brand assets remain in the local sibling `txsignx-brand/` directory. Do not copy
assets here for GitHub storage. Do not commit environment files, credentials,
seed phrases, mnemonics, private keys, extended private keys, wallet databases,
or API tokens. No environment configuration is required for this scaffold.
