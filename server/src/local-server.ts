import { Hono } from "hono";
import * as crypto from "node:crypto";
import { getConfig } from "./config.js";
import { listPending, approvePairing } from "./auth/pairing.js";
import { listKeys, removeByCode } from "./auth/approved-keys.js";

function verifyLocalToken(token: string): boolean {
  const expected = Buffer.from(getConfig().localAuthToken);
  const actual = Buffer.from(token);
  if (expected.length !== actual.length) return false;
  return crypto.timingSafeEqual(expected, actual);
}

export function createLocalServer(): Hono {
  const app = new Hono();

  app.use("*", async (c, next) => {
    const header = c.req.header("Authorization");
    if (!header?.startsWith("Bearer ")) {
      return c.json({ error: "Unauthorized" }, 401);
    }
    const token = header.slice(7);
    if (!verifyLocalToken(token)) {
      return c.json({ error: "Unauthorized" }, 401);
    }
    await next();
  });

  app.get("/pairing/pending", async (c) => {
    const pairings = await listPending();
    return c.json({
      pairings: pairings.map((p) => ({
        code: p.pairingCode,
        createdAt: p.createdAt,
        expiresAt: p.expiresAt,
      })),
    });
  });

  app.post("/pairing/approve", async (c) => {
    const body = await c.req.json<{ code?: string }>();
    if (!body.code) {
      return c.json({ error: "Missing 'code' field" }, 400);
    }

    const approved = await approvePairing(body.code);
    if (!approved) {
      return c.json({ error: "Pairing code not found or expired" }, 404);
    }

    return c.json({
      approved: {
        publicKey: approved.publicKey,
        pairingCode: approved.pairingCode,
      },
    });
  });

  app.delete("/pairing/revoke", async (c) => {
    const body = await c.req.json<{ code?: string }>();
    if (!body.code) {
      return c.json({ error: "Missing 'code' field" }, 400);
    }

    const revoked = await removeByCode(body.code);
    if (!revoked) {
      return c.json({ error: "Pairing code not found" }, 404);
    }

    return c.json({ revoked: true });
  });

  app.get("/pairing/approved", async (c) => {
    const keys = await listKeys();
    return c.json({
      keys: keys.map((k) => ({
        pairingCode: k.pairingCode,
        label: k.label,
        approvedAt: k.approvedAt,
      })),
    });
  });

  return app;
}
