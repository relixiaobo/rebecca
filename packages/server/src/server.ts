import "dotenv/config";
import { createServer } from "node:http";
import { serve } from "@hono/node-server";
import { createDb } from "./db/index.js";
import { createRoutes } from "./api/routes.js";
import { setupWebSocket } from "./api/ws.js";
import { loadOrCreateToken, tokenPath } from "./api/auth.js";
import { homedir } from "node:os";
import { join, dirname } from "node:path";
import {
  writeFileSync,
  unlinkSync,
  existsSync,
  mkdirSync,
} from "node:fs";

const PID_PATH = join(homedir(), ".rebecca", "server.pid");

const DEFAULT_PORT = 4135;
const DEFAULT_HOST = "127.0.0.1";
const DEFAULT_DB_PATH = join(homedir(), ".rebecca", "rebecca.db");

async function main() {
  const port = parsePort(process.env.REBECCA_PORT);
  const host = process.env.REBECCA_HOST ?? DEFAULT_HOST;
  const dbPath = process.env.REBECCA_DB ?? DEFAULT_DB_PATH;

  console.log(`[rebecca-server] Database: ${dbPath}`);

  const token = loadOrCreateToken();
  console.log(`[rebecca-server] Token: ${tokenPath()}`);

  // Write PID file for clean shutdown by CLI
  if (!existsSync(dirname(PID_PATH))) {
    mkdirSync(dirname(PID_PATH), { recursive: true });
  }
  writeFileSync(PID_PATH, String(process.pid));

  const { db, sqlite } = createDb(dbPath);

  let broadcastFn: (roomId: string, event: Record<string, unknown>) => void =
    () => {};

  const serverUrl = `http://${host}:${port}`;
  const { app, agentManager } = createRoutes(
    db,
    sqlite,
    (roomId, event) => broadcastFn(roomId, event),
    serverUrl,
    token,
  );

  const server = serve(
    { fetch: app.fetch, port, hostname: host },
    (info) => {
      console.log(
        `[rebecca-server] HTTP listening on http://${host}:${info.port}`,
      );
    },
  );

  const httpServer = server as unknown as ReturnType<typeof createServer>;
  const { wss, broadcast } = setupWebSocket(httpServer, token);
  broadcastFn = broadcast;

  console.log(`[rebecca-server] WebSocket ready on ws://${host}:${port}/ws`);

  // Auto-start agents
  await agentManager.startAll().catch((err) => {
    console.error("[rebecca-server] Failed to start agents:", err);
  });

  console.log(`[rebecca-server] Ready.`);

  // Graceful shutdown
  const shutdown = async () => {
    console.log("\n[rebecca-server] Shutting down...");
    await agentManager.stopAll().catch(() => {});
    wss.close();
    httpServer.close();
    sqlite.close();
    try {
      unlinkSync(PID_PATH);
    } catch {}
    process.exit(0);
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

function parsePort(value: string | undefined): number {
  if (!value) return DEFAULT_PORT;
  const n = Number(value);
  if (!Number.isInteger(n) || n < 1 || n > 65535) {
    console.error(
      `[rebecca-server] Invalid port: ${value}, using default ${DEFAULT_PORT}`,
    );
    return DEFAULT_PORT;
  }
  return n;
}

main().catch((err) => {
  console.error("[rebecca-server] Fatal:", err);
  process.exit(1);
});
