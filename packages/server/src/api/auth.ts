import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  chmodSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { homedir } from "node:os";
import { randomBytes } from "node:crypto";
import type { Context, Next } from "hono";

const TOKEN_PATH = join(homedir(), ".rebecca", "auth.token");

/**
 * Read the auth token from disk, generating one if missing.
 * Returns the token string. The file is created with mode 0600.
 */
export function loadOrCreateToken(): string {
  if (existsSync(TOKEN_PATH)) {
    const token = readFileSync(TOKEN_PATH, "utf-8").trim();
    if (token) return token;
  }

  // Generate a new token
  mkdirSync(dirname(TOKEN_PATH), { recursive: true });
  const token = randomBytes(32).toString("hex");
  writeFileSync(TOKEN_PATH, token, { mode: 0o600 });
  chmodSync(TOKEN_PATH, 0o600);
  return token;
}

export function tokenPath(): string {
  return TOKEN_PATH;
}

/**
 * Hono middleware: require a valid token via Authorization header or ?token= query.
 * If REBECCA_AUTH=off, all requests are allowed.
 */
export function createAuthMiddleware(token: string) {
  const disabled = process.env.REBECCA_AUTH === "off";

  return async (c: Context, next: Next) => {
    if (disabled) return next();

    const header = c.req.header("Authorization");
    const headerToken = header?.startsWith("Bearer ")
      ? header.slice(7).trim()
      : null;
    const queryToken = c.req.query("token");
    const provided = headerToken ?? queryToken;

    if (!provided || provided !== token) {
      return c.json({ error: "Unauthorized" }, 401);
    }

    return next();
  };
}

/**
 * Validate a token from a WebSocket query string.
 */
export function validateWsToken(query: URLSearchParams, token: string): boolean {
  if (process.env.REBECCA_AUTH === "off") return true;
  return query.get("token") === token;
}
