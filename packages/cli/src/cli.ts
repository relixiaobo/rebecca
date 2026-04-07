import { Command } from "commander";
import { api } from "./api.js";
import { connectCommand } from "./commands/connect.js";
import { spawn } from "node:child_process";
import { resolve as pathResolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  loadConfig,
  saveConfig,
  defaultConfig,
  configExists,
  configPath,
} from "./config.js";
import { parseMentionsWithMode } from "./mentions.js";

const program = new Command();

program
  .name("rebecca")
  .description("Communication infrastructure for agents and humans.")
  .version("0.2.0");

// ─── Server ─────────────────────────────────────────────

const server = program.command("server");

server
  .command("start")
  .description("Start the Rebecca server")
  .action(async () => {
    // Check if already running
    try {
      const res = await api.status();
      if (res.ok) {
        console.log("Server is already running.");
        return;
      }
    } catch {
      // Not running, start it
    }

    const serverPkg = pathResolve(
      dirname(fileURLToPath(import.meta.url)),
      "../../server/dist/server.js",
    );

    const child = spawn("node", [serverPkg], {
      detached: true,
      stdio: "ignore",
    });
    child.unref();

    console.log(`Server starting (pid: ${child.pid})...`);

    // Wait for server to be ready
    for (let i = 0; i < 30; i++) {
      await sleep(500);
      try {
        const res = await api.status();
        if (res.ok) {
          console.log("Server ready.");
          return;
        }
      } catch {
        // not yet
      }
    }
    console.error("Server failed to start within 15s.");
    process.exit(1);
  });

server
  .command("stop")
  .description("Stop the Rebecca server")
  .action(async () => {
    const { existsSync, readFileSync } = await import("node:fs");
    const { join } = await import("node:path");
    const { homedir } = await import("node:os");
    const pidPath = join(homedir(), ".rebecca", "server.pid");

    if (!existsSync(pidPath)) {
      console.log("Server is not running (no PID file).");
      return;
    }

    const pidStr = readFileSync(pidPath, "utf-8").trim();
    const pid = parseInt(pidStr, 10);
    if (!Number.isFinite(pid) || pid <= 0) {
      console.error(`Invalid PID file: ${pidStr}`);
      process.exit(1);
    }

    try {
      process.kill(pid, "SIGTERM");
      console.log(`Stopping server (pid: ${pid})...`);
    } catch (err: any) {
      if (err.code === "ESRCH") {
        const { unlinkSync } = await import("node:fs");
        try {
          unlinkSync(pidPath);
        } catch {}
        console.log("Server was not running (stale PID file removed).");
        return;
      }
      console.error(`Failed to stop server: ${err.message}`);
      process.exit(1);
    }
  });

server
  .command("status")
  .description("Show server status")
  .action(async () => {
    try {
      const res = await api.status();
      if (res.ok) {
        console.log("Server: running");
        console.log(`Rooms: ${res.data.rooms}`);
        for (const p of res.data.participants) {
          console.log(`  ${p.name} (${p.kind}): ${p.status}`);
        }
      }
    } catch {
      console.log("Server: not running");
    }
  });

// ─── Room ───────────────────────────────────────────────

program
  .command("rooms")
  .description("List rooms")
  .action(async () => {
    const res = await api.listRooms();
    if (!res.ok) {
      console.error("Failed to list rooms. Is the server running?");
      process.exit(1);
    }
    if (res.data.length === 0) {
      console.log("No rooms.");
      return;
    }
    for (const room of res.data) {
      console.log(`  ${room.name} (${room.id})`);
    }
  });

const room = program.command("room");

room
  .command("create <name>")
  .description("Create a room")
  .action(async (name: string) => {
    const res = await api.createRoom(name, name);
    if (!res.ok) {
      console.error(`Failed: ${res.data?.error ?? res.status}`);
      process.exit(1);
    }
    console.log(`Room created: ${res.data.name}`);
  });

// ─── Agents ─────────────────────────────────────────────

const agent = program.command("agent");

agent
  .command("add <room> <name>")
  .description("Add an agent to a room")
  .requiredOption("--type <type>", "Agent type (claude-code, codex, pi)")
  .option("--run <command>", "Run command (default per type)")
  .option("--cwd <path>", "Working directory")
  .action(
    async (
      roomId: string,
      name: string,
      opts: { type: string; run?: string; cwd?: string },
    ) => {
      const runCommand =
        opts.run ?? defaultRunCommand(opts.type);
      if (!runCommand) {
        console.error(`Unknown agent type: ${opts.type}`);
        process.exit(1);
      }

      const res = await api.addAgent(roomId, name, opts.type, runCommand, opts.cwd);
      if (!res.ok) {
        console.error(`Failed: ${res.data?.error ?? res.status}`);
        process.exit(1);
      }
      console.log(`Agent added: ${res.data.name} (${res.data.type})`);
    },
  );

agent
  .command("remove <room> <name>")
  .description("Remove an agent from a room")
  .action(async (roomId: string, name: string) => {
    const res = await api.removeAgent(roomId, name);
    if (!res.ok) {
      console.error(`Failed: ${res.data?.error ?? res.status}`);
      process.exit(1);
    }
    console.log(`Agent removed: ${name}`);
  });

agent
  .command("list <room>")
  .description("List agents in a room")
  .action(async (roomId: string) => {
    const res = await api.listAgents(roomId);
    if (!res.ok) {
      console.error(`Failed: ${res.data?.error ?? res.status}`);
      process.exit(1);
    }
    if (res.data.length === 0) {
      console.log("No agents.");
      return;
    }
    for (const a of res.data) {
      console.log(
        `  ${a.participantId} [${a.type}] auto_start=${a.autoStart} cwd=${a.cwd ?? "."}`,
      );
    }
  });

// ─── Init / Start / Stop ────────────────────────────────

program
  .command("init")
  .description("Create a rebecca.yaml in the current directory")
  .option("--force", "Overwrite existing config")
  .action((opts: { force?: boolean }) => {
    if (configExists() && !opts.force) {
      console.error(`${configPath()} already exists. Use --force to overwrite.`);
      process.exit(1);
    }
    const config = defaultConfig();
    const path = saveConfig(config);
    console.log(`Created ${path}`);
    console.log(`Room: ${config.room}`);
    console.log(`Agents: ${config.agents.map((a) => a.name).join(", ")}`);
    console.log("");
    console.log("Edit the file to add or change agents, then run:");
    console.log("  rebecca start    # bring up the room and its agents");
    console.log("  rebecca connect  # join the chat");
  });

program
  .command("start [room]")
  .description("Start a room and its agents (reads rebecca.yaml if no room given)")
  .action(async (roomArg: string | undefined) => {
    // Ensure server is running
    try {
      await api.status();
    } catch {
      console.error("Server is not running. Start it with: rebecca server start");
      process.exit(1);
    }

    if (roomArg) {
      // Direct mode: just start agents for an existing room
      const res = await api.startRoom(roomArg);
      if (!res.ok) {
        console.error(`Failed: ${res.data?.error ?? res.status}`);
        process.exit(1);
      }
      console.log(`Room ${roomArg} agents started.`);
      return;
    }

    // Config mode: read rebecca.yaml and provision the room
    let config;
    try {
      config = loadConfig();
    } catch (err: any) {
      console.error(err.message);
      process.exit(1);
    }
    if (!config) {
      console.error(`No rebecca.yaml in ${process.cwd()}.`);
      console.error("Run 'rebecca init' to create one, or pass a room name.");
      process.exit(1);
    }

    console.log(`Room: ${config.room}`);

    // Ensure room exists (idempotent)
    await api.createRoom(config.room, config.room);

    // Provision agents (idempotent: addAgent replaces existing config)
    for (const agent of config.agents) {
      const runCommand = agent.run ?? defaultRunCommand(agent.type);
      if (!runCommand) {
        console.error(`  ${agent.name}: unknown type '${agent.type}'`);
        continue;
      }
      const res = await api.addAgent(
        config.room,
        agent.name,
        agent.type,
        runCommand,
        agent.cwd ?? process.cwd(),
        agent.env,
      );
      if (!res.ok) {
        console.error(`  ${agent.name}: ${res.data?.error ?? res.status}`);
        continue;
      }
      console.log(`  ${agent.name} (${agent.type}) added`);
    }

    // Start agents
    const startRes = await api.startRoom(config.room);
    if (!startRes.ok) {
      console.error(`Failed to start agents: ${startRes.data?.error ?? startRes.status}`);
      process.exit(1);
    }
    console.log(`Started.`);
    console.log(`Run 'rebecca connect' to join.`);
  });

program
  .command("stop [room]")
  .description("Stop agents in a room (defaults to room from rebecca.yaml)")
  .action(async (roomArg: string | undefined) => {
    let roomId = roomArg;
    if (!roomId) {
      const config = loadConfig();
      if (!config) {
        console.error("No room specified and no rebecca.yaml in current directory.");
        process.exit(1);
      }
      roomId = config.room;
    }
    const res = await api.stopRoom(roomId);
    if (!res.ok) {
      console.error(`Failed: ${res.data?.error ?? res.status}`);
      process.exit(1);
    }
    console.log(`Room ${roomId} agents stopped.`);
  });

function defaultRunCommand(type: string): string | null {
  switch (type) {
    case "claude-code":
      return "claude -p --input-format stream-json --output-format stream-json --verbose";
    case "codex":
      return "codex exec --json --full-auto --skip-git-repo-check";
    default:
      return null;
  }
}

// ─── Connect ────────────────────────────────────────────

program
  .command("connect [room]")
  .description("Connect to a room (defaults to room from rebecca.yaml)")
  .action(async (roomArg: string | undefined) => {
    let roomId = roomArg;
    if (!roomId) {
      try {
        const config = loadConfig();
        if (config) roomId = config.room;
      } catch {
        // ignore parse errors
      }
    }
    if (!roomId) {
      console.error("No room specified. Pass a room name or run 'rebecca init' to create rebecca.yaml.");
      process.exit(1);
    }
    await connectCommand(roomId);
  });

// ─── Helpers ────────────────────────────────────────────

function defaultRoom(): string | undefined {
  if (process.env.REBECCA_ROOM) return process.env.REBECCA_ROOM;
  try {
    const config = loadConfig();
    if (config) return config.room;
  } catch {
    // ignore
  }
  return undefined;
}

function defaultParticipant(): string {
  return (
    process.env.REBECCA_PARTICIPANT ?? `human/${process.env.USER ?? "user"}`
  );
}

function resolveRoom(arg: string | undefined): string {
  const room = arg ?? defaultRoom();
  if (!room) {
    console.error(
      "No room specified. Pass a room name, set REBECCA_ROOM, or run 'rebecca init'.",
    );
    process.exit(1);
  }
  return room;
}

// ─── Read / Post (programmatic) ─────────────────────────

program
  .command("read [room]")
  .description("Read recent messages (defaults to $REBECCA_ROOM)")
  .option("--last <n>", "Number of messages", "20")
  .option(
    "--before <isoTimestamp>",
    "Read messages with createdAt before this ISO timestamp",
  )
  .option("--json", "Output as JSON (one object per line)")
  .action(
    async (
      roomArg: string | undefined,
      opts: { last: string; before?: string; json?: boolean },
    ) => {
      const roomId = resolveRoom(roomArg);
      const res = await api.readMessages(roomId, parseInt(opts.last), opts.before);
      if (!res.ok) {
        console.error(`Failed: ${res.data?.error ?? res.status}`);
        process.exit(1);
      }
      if (opts.json) {
        for (const msg of res.data) {
          console.log(JSON.stringify(msg));
        }
      } else {
        for (const msg of res.data) {
          const name = msg.senderId.split("/").pop();
          const text = msg.content
            ?.map((p: any) => p.text)
            .filter(Boolean)
            .join("\n");
          console.log(`[${name}]: ${text}`);
        }
      }
    },
  );

program
  .command("post [room...]")
  .description("Post a message to a room. Last arg is the message; room defaults to $REBECCA_ROOM.")
  .option("--as <id>", "Participant ID (defaults to $REBECCA_PARTICIPANT)")
  .action(async (args: string[], opts: { as?: string }) => {
    let roomId: string;
    let message: string;
    if (args.length >= 2) {
      roomId = args[0];
      message = args.slice(1).join(" ");
    } else if (args.length === 1) {
      roomId = resolveRoom(undefined);
      message = args[0];
    } else {
      console.error("Usage: rebecca post [room] <message>");
      process.exit(1);
    }
    const sender = opts.as ?? defaultParticipant();
    // Resolve @mentions and quick mentions (@name?) from message text
    let mentions: string[] | undefined;
    let quickMentions: string[] | undefined;
    const pRes = await api.getParticipants(roomId);
    if (pRes.ok) {
      const parsed = parseMentionsWithMode(message, pRes.data, sender);
      mentions = parsed.mentions.length > 0 ? parsed.mentions : undefined;
      quickMentions =
        parsed.quickMentions.length > 0 ? parsed.quickMentions : undefined;
    }

    const res = await api.postMessage(
      roomId,
      sender,
      message,
      mentions,
      quickMentions,
    );
    if (!res.ok) {
      console.error(`Failed: ${res.data?.error ?? res.status}`);
      process.exit(1);
    }
    const summary: string[] = [];
    if (mentions?.length) summary.push(`mentioned ${mentions.length}`);
    if (quickMentions?.length) summary.push(`quick ${quickMentions.length}`);
    console.log(
      `Message posted${summary.length ? ` (${summary.join(", ")})` : ""}`,
    );
  });

// ─── Join / Leave ───────────────────────────────────────

program
  .command("join [room]")
  .description("Join a room as a participant")
  .option("--as <id>", "Participant ID (defaults to $REBECCA_PARTICIPANT)")
  .option("--name <name>", "Display name (defaults to id's last segment)")
  .option("--kind <kind>", "human or agent", "agent")
  .action(
    async (
      roomArg: string | undefined,
      opts: { as?: string; name?: string; kind: string },
    ) => {
      const roomId = resolveRoom(roomArg);
      const id = opts.as ?? defaultParticipant();
      const name = opts.name ?? id.split("/").pop() ?? id;
      const kind = opts.kind === "human" ? "human" : "agent";

      const res = await api.join(roomId, id, name, kind);
      if (!res.ok) {
        console.error(`Failed: ${res.data?.error ?? res.status}`);
        process.exit(1);
      }
      console.log(`Joined ${roomId} as ${name} (${kind})`);
    },
  );

program
  .command("leave [room]")
  .description("Leave a room")
  .option("--as <id>", "Participant ID (defaults to $REBECCA_PARTICIPANT)")
  .action(async (roomArg: string | undefined, opts: { as?: string }) => {
    const roomId = resolveRoom(roomArg);
    const id = opts.as ?? defaultParticipant();
    const res = await api.leave(roomId, id);
    if (!res.ok) {
      console.error(`Failed: ${res.data?.error ?? res.status}`);
      process.exit(1);
    }
    console.log(`Left ${roomId}`);
  });

// ─── Mentions ───────────────────────────────────────────

program
  .command("mentions [room]")
  .description("Check pending @mentions (defaults to $REBECCA_ROOM)")
  .option("--for <id>", "Participant ID (defaults to $REBECCA_PARTICIPANT)")
  .option("--wait", "Block until at least one new mention arrives")
  .option("--since <timestamp>", "Only return mentions after this ISO timestamp")
  .option("--json", "Output as JSON (one object per line)")
  .action(
    async (
      roomArg: string | undefined,
      opts: { for?: string; wait?: boolean; since?: string; json?: boolean },
    ) => {
      const roomId = resolveRoom(roomArg);
      const forId = opts.for ?? defaultParticipant();
      const since = opts.since;

      // Pull existing mentions newer than --since (or all if no since given)
      const existing = await fetchMentions(roomId, forId, since);
      if (existing.length > 0) {
        printMentions(existing, opts.json);
        return;
      }

      if (!opts.wait) {
        if (!opts.json) console.log("No mentions.");
        return;
      }

      // Block on WebSocket until a mention arrives
      const mention = await waitForMention(roomId, forId);
      if (mention) {
        // Fetch the actual message and print it
        const msg = await fetchMessage(roomId, mention.messageId);
        if (msg) {
          printMentions([msg], opts.json);
        } else {
          if (opts.json) console.log(JSON.stringify(mention));
          else console.log(JSON.stringify(mention));
        }
      }
    },
  );

async function fetchMentions(
  roomId: string,
  forId: string,
  since?: string,
): Promise<any[]> {
  const res = await api.readMessages(roomId, 100);
  if (!res.ok) return [];
  return res.data.filter((m: any) => {
    if (!m.mentions?.includes(forId)) return false;
    if (since && m.createdAt <= since) return false;
    return true;
  });
}

async function fetchMessage(roomId: string, messageId: string): Promise<any | null> {
  const res = await api.readMessages(roomId, 100);
  if (!res.ok) return null;
  return res.data.find((m: any) => m.id === messageId) ?? null;
}

function printMentions(messages: any[], json?: boolean) {
  if (json) {
    for (const msg of messages) {
      console.log(JSON.stringify(msg));
    }
  } else {
    for (const msg of messages) {
      const name = msg.senderId.split("/").pop();
      const text = msg.content
        ?.map((p: any) => p.text)
        .filter(Boolean)
        .join("\n");
      console.log(`[${name}]: ${text}`);
    }
  }
}

async function waitForMention(
  roomId: string,
  forId: string,
): Promise<{ messageId: string; senderId: string } | null> {
  const { default: WS } = await import("ws");
  const { getWsUrl } = await import("./api.js");
  const baseWs = getWsUrl();
  const sep = baseWs.includes("?") ? "&" : "?";
  const wsUrl = `${baseWs}${sep}participant=${encodeURIComponent(forId)}`;

  return new Promise((resolve) => {
    const ws = new WS(wsUrl);
    let timeoutId: NodeJS.Timeout | null = null;

    ws.on("open", () => {
      ws.send(JSON.stringify({ type: "subscribe", roomId }));
    });

    ws.on("message", (data) => {
      try {
        const event = JSON.parse(data.toString());
        if (event.type === "mention" && event.mentionedId === forId) {
          if (timeoutId) clearTimeout(timeoutId);
          ws.close();
          resolve({ messageId: event.messageId, senderId: event.senderId });
        }
      } catch {}
    });

    ws.on("error", () => {
      if (timeoutId) clearTimeout(timeoutId);
      resolve(null);
    });

    // Safety: max 1 hour wait
    timeoutId = setTimeout(() => {
      ws.close();
      resolve(null);
    }, 60 * 60 * 1000);
  });
}

// ─── Tasks ──────────────────────────────────────────────

const task = program.command("task");

task
  .command("create [args...]")
  .description("Create a task. Usage: rebecca task create [room] <description>")
  .option("--assignee <id>", "Assignee participant ID (defaults to $REBECCA_PARTICIPANT)")
  .action(async (args: string[], opts: { assignee?: string }) => {
    let roomId: string;
    let description: string;
    if (args.length >= 2) {
      roomId = args[0];
      description = args.slice(1).join(" ");
    } else if (args.length === 1) {
      roomId = resolveRoom(undefined);
      description = args[0];
    } else {
      console.error("Usage: rebecca task create [room] <description>");
      process.exit(1);
    }
    const assignee = opts.assignee ?? defaultParticipant();
    const res = await api.createTask(roomId, description, assignee);
    if (!res.ok) {
      console.error(`Failed: ${res.data?.error ?? res.status}`);
      process.exit(1);
    }
    console.log(`${res.data.id}`);
  });

task
  .command("update <id> <state>")
  .description("Update task state")
  .action(async (id: string, state: string) => {
    const res = await api.updateTask(id, state);
    if (!res.ok) {
      console.error(`Failed: ${res.data?.error ?? res.status}`);
      process.exit(1);
    }
    console.log(`Task ${id}: ${res.data.state}`);
  });

task
  .command("list [room]")
  .description("List tasks in a room (defaults to $REBECCA_ROOM)")
  .action(async (roomArg: string | undefined) => {
    const roomId = resolveRoom(roomArg);
    const res = await api.getTasks(roomId);
    if (!res.ok) {
      console.error(`Failed: ${res.data?.error ?? res.status}`);
      process.exit(1);
    }
    if (res.data.length === 0) {
      console.log("No tasks.");
      return;
    }
    for (const t of res.data) {
      const assignee = t.assigneeId?.split("/").pop() ?? "unassigned";
      console.log(`  ${t.id} [${t.state}] ${t.description} (${assignee})`);
    }
  });

// ─── Status ─────────────────────────────────────────────

program
  .command("status")
  .description("Show server and agent status")
  .action(async () => {
    try {
      const res = await api.status();
      if (res.ok) {
        console.log("Server: running");
        console.log(`Rooms: ${res.data.rooms}`);
        for (const p of res.data.participants) {
          console.log(`  ${p.name} (${p.kind}): ${p.status}`);
        }
      }
    } catch {
      console.log("Server: not running");
    }
  });

program.parse();

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}
