import "./ed25519-setup.js";
import { keygenAsync, signAsync, etc } from "@noble/ed25519";

export type Keypair = {
  privateKey: string; // hex-encoded 32-byte seed
  publicKey: string; // hex-encoded 32-byte public key
};

export async function generateKeypair(): Promise<Keypair> {
  const { secretKey, publicKey } = await keygenAsync();
  return {
    privateKey: etc.bytesToHex(secretKey),
    publicKey: etc.bytesToHex(publicKey),
  };
}

export async function signChallenge(
  privateKeyHex: string,
  challengeJson: string,
): Promise<string> {
  const message = new TextEncoder().encode(challengeJson);
  const privateKey = etc.hexToBytes(privateKeyHex);
  const signature = await signAsync(message, privateKey);
  return etc.bytesToHex(signature);
}
