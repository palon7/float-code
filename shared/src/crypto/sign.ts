import "./ed25519-setup.js";
import { keygen, sign, etc } from "@noble/ed25519";

export type Keypair = {
  privateKey: string; // hex-encoded 32-byte seed
  publicKey: string; // hex-encoded 32-byte public key
};

export function generateKeypair(): Keypair {
  const { secretKey, publicKey } = keygen();
  return {
    privateKey: etc.bytesToHex(secretKey),
    publicKey: etc.bytesToHex(publicKey),
  };
}

export function signChallenge(
  privateKeyHex: string,
  challengeJson: string,
): string {
  const message = new TextEncoder().encode(challengeJson);
  const privateKey = etc.hexToBytes(privateKeyHex);
  const signature = sign(message, privateKey);
  return etc.bytesToHex(signature);
}
