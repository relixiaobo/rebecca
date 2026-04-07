import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { resolve, basename } from "node:path";
import { parse, stringify } from "yaml";

export interface AgentConfig {
  name: string;
  type: "claude-code" | "codex" | string;
  run?: string;
  cwd?: string;
  env?: Record<string, string>;
}

export interface RebeccaConfig {
  room: string;
  agents: AgentConfig[];
}

const CONFIG_FILE = "rebecca.yaml";

export function configPath(dir: string = process.cwd()): string {
  return resolve(dir, CONFIG_FILE);
}

export function configExists(dir: string = process.cwd()): boolean {
  return existsSync(configPath(dir));
}

export function loadConfig(dir: string = process.cwd()): RebeccaConfig | null {
  const path = configPath(dir);
  if (!existsSync(path)) return null;
  try {
    const text = readFileSync(path, "utf-8");
    const parsed = parse(text);
    if (!parsed?.room) {
      throw new Error("Missing required field: room");
    }
    return {
      room: parsed.room,
      agents: Array.isArray(parsed.agents) ? parsed.agents : [],
    };
  } catch (err: any) {
    throw new Error(`Failed to parse ${path}: ${err.message}`);
  }
}

export function saveConfig(
  config: RebeccaConfig,
  dir: string = process.cwd(),
): string {
  const path = configPath(dir);
  const yamlText = stringify(config, { indent: 2 });
  const header = `# Rebecca configuration\n# Run \`rebecca start\` to launch this room and its agents.\n# Then \`rebecca connect\` to chat.\n\n`;
  writeFileSync(path, header + yamlText);
  return path;
}

export function defaultConfig(dir: string = process.cwd()): RebeccaConfig {
  const projectName = basename(dir).toLowerCase().replace(/[^a-z0-9-]+/g, "-");
  return {
    room: projectName || "rebecca",
    agents: [
      {
        name: "assistant",
        type: "claude-code",
        cwd: ".",
      },
    ],
  };
}
