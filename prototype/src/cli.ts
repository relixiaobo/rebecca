import "dotenv/config";
import { Room } from "./room.js";
import { HumanConnector } from "./connectors/human.js";
import { PiConnector } from "./connectors/pi.js";
import { ClaudeCodeConnector } from "./connectors/claude-code.js";
import { CodexConnector } from "./connectors/codex.js";
import type { Connector, Participant } from "./types.js";

// ─── Configuration ──────────────────────────────────────────────

interface AgentConfig {
  connector: "pi" | "claude-code" | "codex";
  participant: Participant;
  config?: Record<string, unknown>;
}

// Parse CLI args
const args = process.argv.slice(2);
const roomName = args.find((a) => a.startsWith("--room="))?.split("=")[1] ?? "default";

// Default setup: human + one pi agent
// Override by setting REBECCA_AGENTS env var as JSON array
const defaultAgents: AgentConfig[] = [
  {
    connector: "pi",
    participant: { id: "pi/assistant", name: "assistant", kind: "agent" },
    config: {
      systemPrompt:
        "You are a helpful assistant. You get things done with bash. Be concise.",
    },
  },
];

function loadAgents(): AgentConfig[] {
  const envAgents = process.env.REBECCA_AGENTS;
  if (envAgents) {
    try {
      return JSON.parse(envAgents);
    } catch {
      console.error("Invalid REBECCA_AGENTS JSON, using defaults");
    }
  }
  return defaultAgents;
}

// ─── Main ───────────────────────────────────────────────────────

async function main() {
  const room = new Room(roomName, roomName);
  const connectors: Connector[] = [];
  const agents = loadAgents();

  // Human participant
  const human: Participant = {
    id: "human/user",
    name: process.env.USER ?? "user",
    kind: "human",
  };

  const humanConnector = new HumanConnector(room, human);
  room.join(human, humanConnector);
  connectors.push(humanConnector);

  // Agent participants
  for (const agent of agents) {
    let connector: Connector;

    switch (agent.connector) {
      case "pi":
        connector = new PiConnector(room, agent.participant, agent.config);
        break;
      case "claude-code":
        connector = new ClaudeCodeConnector(room, agent.participant, agent.config);
        break;
      case "codex":
        connector = new CodexConnector(room, agent.participant, agent.config);
        break;
      default:
        console.error(`Unknown connector: ${agent.connector}`);
        continue;
    }

    room.join(agent.participant, connector);
    connectors.push(connector);
  }

  // Start all connectors
  console.log(`\x1b[1mRoom: ${room.name}\x1b[0m`);
  console.log(
    `Participants: ${room
      .getParticipants()
      .map((p) => `${p.name} (${p.kind})`)
      .join(", ")}`,
  );
  console.log("---");

  for (const c of connectors) {
    if (c instanceof HumanConnector) continue; // start human last
    try {
      await c.start();
    } catch (err) {
      console.error("Failed to start connector:", err);
    }
  }

  // Start human connector last (it blocks on readline)
  await humanConnector.start();
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
