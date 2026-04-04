import { sha256 } from "@noble/hashes/sha2.js";
import { etc } from "@noble/ed25519";

const BASE32_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

function base32Encode(bytes: Uint8Array): string {
  let bits = 0;
  let value = 0;
  let result = "";

  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      result += BASE32_ALPHABET[(value >>> (bits - 5)) & 0x1f];
      bits -= 5;
    }
  }

  if (bits > 0) {
    result += BASE32_ALPHABET[(value << (5 - bits)) & 0x1f];
  }

  return result;
}

export function derivePairingCode(publicKeyHex: string): string {
  const pubBytes = etc.hexToBytes(publicKeyHex);
  const hash = sha256(pubBytes);
  const encoded = base32Encode(hash);
  const raw = encoded.slice(0, 12);
  return `${raw.slice(0, 4)}-${raw.slice(4, 8)}-${raw.slice(8, 12)}`;
}
