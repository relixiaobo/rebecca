import { mkdirSync, writeFileSync, chmodSync, existsSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { homedir } from "node:os";

/**
 * Ensure the rebecca CLI is available at a known path so spawned agents can
 * find it on PATH. Returns the directory containing the rebecca executable.
 */
export function ensureRebeccaCliAvailable(): string {
  const binDir = join(homedir(), ".rebecca", "bin");
  const wrapperPath = join(binDir, "rebecca");

  // Locate the CLI's compiled entry point
  // server.js is at packages/server/dist/server.js
  // cli.js is at packages/cli/dist/cli.js
  const here = dirname(fileURLToPath(import.meta.url));
  const cliJs = resolve(here, "..", "..", "cli", "dist", "cli.js");

  if (!existsSync(cliJs)) {
    console.warn(
      `[server] rebecca CLI not found at ${cliJs}. Agents will not be able to call rebecca commands.`,
    );
    return binDir;
  }

  mkdirSync(binDir, { recursive: true });

  // Wrapper script: invokes the CLI's compiled JS via node
  const wrapper = `#!/bin/sh\nexec node "${cliJs}" "$@"\n`;
  writeFileSync(wrapperPath, wrapper, { mode: 0o755 });
  chmodSync(wrapperPath, 0o755);

  return binDir;
}
