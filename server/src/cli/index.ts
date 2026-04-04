import { runPairingCommand } from "./pairing.js";

const COMMANDS: Record<string, (args: string[]) => Promise<void>> = {
  pairing: runPairingCommand,
};

export async function runCli(args: string[]): Promise<boolean> {
  const command = args[0];
  if (!command) return false;

  const handler = COMMANDS[command];
  if (!handler) {
    console.error(`Unknown command: ${command}`);
    console.error(`Available commands: ${Object.keys(COMMANDS).join(", ")}`);
    process.exit(1);
  }

  await handler(args.slice(1));
  return true;
}
