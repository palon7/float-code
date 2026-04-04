import { readJsonSafe, dataPath } from "../utils/fs.js";

type Config = { localAuthToken?: string; localPort?: number };

async function getLocalConfig(): Promise<{ token: string; port: number }> {
  const config = await readJsonSafe<Config>(dataPath("config.json"), {});
  const token = config.localAuthToken;
  if (!token) {
    throw new Error(
      "localAuthToken not found in config. Start the server first.",
    );
  }
  return { token, port: config.localPort ?? 9090 };
}

async function request(
  method: string,
  path: string,
  body?: unknown,
): Promise<unknown> {
  const { token, port } = await getLocalConfig();
  const url = `http://127.0.0.1:${port}${path}`;
  const res = await fetch(url, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    ...(body !== undefined && { body: JSON.stringify(body) }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`${res.status} ${res.statusText}: ${text}`);
  }

  return res.json();
}

type PendingResponse = {
  pairings: { code: string; createdAt: string; expiresAt: string }[];
};

type ApprovedResponse = {
  keys: { pairingCode: string; label: string; approvedAt: string }[];
};

async function listCommand(): Promise<void> {
  const [pending, approved] = await Promise.all([
    request("GET", "/pairing/pending") as Promise<PendingResponse>,
    request("GET", "/pairing/approved") as Promise<ApprovedResponse>,
  ]);

  console.log("\n=== Pending Pairings ===");
  if (pending.pairings.length === 0) {
    console.log("  (none)");
  } else {
    for (const p of pending.pairings) {
      const expires = new Date(p.expiresAt).toLocaleString();
      console.log(`  ${p.code}  expires: ${expires}`);
    }
  }

  console.log("\n=== Approved Keys ===");
  if (approved.keys.length === 0) {
    console.log("  (none)");
  } else {
    for (const k of approved.keys) {
      const label = k.label || "(no label)";
      const date = new Date(k.approvedAt).toLocaleString();
      console.log(`  ${k.pairingCode}  ${label}  approved: ${date}`);
    }
  }
  console.log();
}

async function approveCommand(code: string): Promise<void> {
  const result = (await request("POST", "/pairing/approve", { code })) as {
    approved: { publicKey: string; pairingCode: string };
  };
  console.log(`Approved: ${result.approved.pairingCode}`);
}

async function revokeCommand(code: string): Promise<void> {
  await request("DELETE", "/pairing/revoke", { code });
  console.log(`Revoked: ${code}`);
}

export async function runPairingCommand(args: string[]): Promise<void> {
  const subcommand = args[0];

  switch (subcommand) {
    case "list":
      await listCommand();
      break;
    case "approve":
      if (!args[1]) {
        console.error("Usage: float-server pairing approve <code>");
        process.exit(1);
      }
      await approveCommand(args[1]);
      break;
    case "revoke":
      if (!args[1]) {
        console.error("Usage: float-server pairing revoke <code>");
        process.exit(1);
      }
      await revokeCommand(args[1]);
      break;
    default:
      console.error("Usage: float-server pairing <list|approve|revoke> [code]");
      process.exit(1);
  }
}
