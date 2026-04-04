import { sha512 } from "@noble/hashes/sha2.js";
import { hashes } from "@noble/ed25519";

// @noble/ed25519 v3 requires manual sha512 configuration
hashes.sha512 = (message: Uint8Array) =>
  sha512.create().update(message).digest();
