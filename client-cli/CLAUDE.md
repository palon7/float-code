- CLI-based client for the server.
- Primary purpose is to solidify the client implementation before the g2 client is built, and in the future to work alongside Even G2 and PC together.

## Authentication

- On first launch, generates an Ed25519 keypair and stores it at `~/.config/float-code/client-cli/keypair.json` (0600 permissions)
- Authenticates via challenge-response: sends `publicKey` + `authToken`, signs the server's challenge, receives `auth.ok`
- If the key is not yet approved, receives `KEY_NOT_APPROVED`, derives the pairing code locally, and enters `pairing` state (displays the pairing code)
- Server token is read from `~/.config/float-code/server/config.json` (or `--token` flag)

## Commands

- `pnpm run dev`: Start development server (tsx)
- `pnpm run check`: Run typecheck + lint + format:check at once
- `pnpm run format`: Fix formatting with Prettier
- `pnpm run lint:fix`: Auto-fix with ESLint

## Documentation

- [Ink Documentation](https://raw.githubusercontent.com/vadimdemedes/ink/refs/heads/master/readme.md)
