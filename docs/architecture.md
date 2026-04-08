# Technical Architecture

## Overview

```
rebecca-server (daemon)
  │
  │  SQLite (messages, tasks, participants, status)
  │  HTTP REST + WebSocket
  │  Agent process management
  │
  ├── Agent processes (managed by server, always online)
  │   ├── researcher (claude -p ...)
  │   ├── reviewer   (claude -p ...)
  │   └── builder    (codex exec ...)
  │
  ├── rebecca connect   (human interactive CLI)
  ├── rebecca CLI       (programmatic access)
  └── MCP server        (optional, for MCP-native agents)
```

Rebecca server does two things:

1. **Communication**: store messages, route @mentions, track tasks
2. **Agent management**: start agent processes, keep them online, report their status

## What the Server Manages

### Communication (the Room)

- Persistent message storage (SQLite)
- @mention detection and notification delivery
- Task lifecycle tracking
- Message history with pagination
- Participant presence and status

### Agent Processes

- Start agent processes based on Room configuration
- Keep them running (restart on crash)
- Monitor health and update status (online, working, error, rate_limited)
- Relay between Room and agent: @mention → inject context into agent stdin, agent response → post to Room

The server does NOT manage what the agent does internally. It manages the connection: the process, the stdin/stdout pipe, the status reporting.

This is like Docker: it starts containers, restarts them on crash, reports their health. It does not manage the application inside the container.

## Storage: SQLite

SQLite in WAL mode. Server is the single writer. Clients read via API.

### Schema

```sql
CREATE TABLE rooms (
  id         TEXT PRIMARY KEY,
  name       TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE participants (
  id     TEXT PRIMARY KEY,
  name   TEXT NOT NULL,
  kind   TEXT NOT NULL CHECK (kind IN ('human', 'agent')),
  status TEXT NOT NULL DEFAULT 'offline'
         CHECK (status IN ('online','offline','working','error','rate_limited'))
);

CREATE TABLE room_members (
  room_id        TEXT NOT NULL REFERENCES rooms(id),
  participant_id TEXT NOT NULL REFERENCES participants(id),
  joined_at      TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (room_id, participant_id)
);

CREATE TABLE messages (
  id         TEXT PRIMARY KEY,
  room_id    TEXT NOT NULL REFERENCES rooms(id),
  sender_id  TEXT NOT NULL,  -- participant ID or 'system'
  content    TEXT NOT NULL,  -- JSON: Part[]
  mentions   TEXT,           -- JSON: string[] (participant IDs)
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_messages_room_time ON messages(room_id, created_at);

CREATE TABLE tasks (
  id          TEXT PRIMARY KEY,
  room_id     TEXT NOT NULL REFERENCES rooms(id),
  assignee_id TEXT REFERENCES participants(id),
  description TEXT,
  state       TEXT NOT NULL DEFAULT 'submitted'
              CHECK (state IN ('submitted','working','input_required',
                               'completed','failed','canceled')),
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE agent_configs (
  participant_id TEXT PRIMARY KEY REFERENCES participants(id),
  room_id        TEXT NOT NULL REFERENCES rooms(id),
  run_command    TEXT NOT NULL,   -- e.g. "claude -p --input-format stream-json ..."
  cwd            TEXT,            -- working directory
  env            TEXT,            -- JSON: additional environment variables
  auto_start     INTEGER NOT NULL DEFAULT 1
);
```

### Technology

- better-sqlite3 (synchronous, fastest Node.js SQLite driver)
- Drizzle ORM (type-safe schema, migrations)

## API

### HTTP REST

```
Rooms
  POST   /rooms                     Create a room
  GET    /rooms                     List rooms
  GET    /rooms/:id                 Get room details + participant statuses

Messages
  POST   /rooms/:id/messages        Post a message
  GET    /rooms/:id/messages        Read messages (?limit=N&before=<id>)

Tasks
  POST   /rooms/:id/tasks           Create a task
  PATCH  /tasks/:id                 Update task state
  GET    /rooms/:id/tasks           List tasks

Agents
  POST   /rooms/:id/agents          Add an agent to a room
  DELETE /rooms/:id/agents/:name    Remove an agent
  GET    /rooms/:id/agents          List agents with status

System
  POST   /start                     Start all agents for all rooms
  POST   /stop                      Stop all agents
  GET    /status                    Server + agent status
```

### WebSocket

Connect to `/ws?participant=<id>`. Receive events:

```json
{ "type": "mention", "roomId": "...", "messageId": "..." }
{ "type": "message", "roomId": "...", "message": { ... } }
{ "type": "task_update", "taskId": "...", "state": "..." }
{ "type": "status_change", "participantId": "...", "status": "..." }
```

Humans subscribe to all room events. The server uses WebSocket to push @mention notifications to connected clients.

## Agent Process Management

### How the Server Manages Agent Processes

Each agent configured in `agent_configs` has a `run_command`. When the server starts (or when `rebecca start <room>` is called):

1. For each agent with `auto_start = 1`:
   - Spawn the process using `run_command`
   - Set `cwd` and inject `env`
   - Set status to `online`
2. Monitor the process:
   - stdout → parse for agent responses → post to Room
   - stderr → log, detect errors → update status
   - Process exit → set status to `error`, auto-restart after backoff
3. When @mentioned:
   - Read last N messages from Room (the "one screen" of context)
   - Format as context block + triggering message
   - Write to agent's stdin
4. When agent produces a response:
   - Parse the response (format depends on agent type: stream-json for Claude, JSONL for Codex)
   - Post as a Room message from the agent
   - If agent @mentions someone, that triggers the next notification

### Agent Status

| Status | Meaning |
|---|---|
| `online` | Running, ready to respond to @mentions |
| `working` | Processing a @mention or task |
| `error` | Process crashed, API error, or similar. Details in status message. |
| `rate_limited` | Hit API rate limits. Will retry. |
| `offline` | Not started or explicitly stopped. |

Status changes are:
- Broadcast to all connected WebSocket clients
- Stored in the participants table
- Visible in `rebecca status` and in the Room UI

When a human @mentions an unavailable agent, the server stores the message and posts a system notification:

```
[system]: builder is currently unavailable (error: process crashed). Message saved.
```

When the agent comes back online, it receives the pending @mention.

### Invocation Modes

Each message has a mode, controlled by a slash prefix at the start:

| Syntax | Mode | Constraints |
|---|---|---|
| `@agent ...` | full | Tools allowed, multi-turn, may create tasks |
| `/btw @agent ...` | quick | No tools, isolated session, answer from context |
| `/q @agent ...` | quick | Alias for `/btw` |

The mode is parsed in the CLI: if the message starts with `/btw` or `/q`, the prefix is stripped and `mode=quick` is set on the message. All agents mentioned in a quick message dispatch in quick mode.

**Quick mode is enforced at the runner boundary**, not just via prompt:

- **Claude Code**: a separate one-shot subprocess is spawned with `--tools ""` (no tools at all). The quick subprocess does not share state with the long-lived process. After producing one response it is killed. 90s hard timeout.
- **Codex**: a fresh `codex exec --json --ephemeral --sandbox read-only` process is spawned without thread resume. The read-only sandbox prevents file modification; the ephemeral flag prevents session state pollution. The full-mode `threadId` is never updated by quick runs.

This means even if the model ignores the system prompt instruction "do not use tools," the framework provides nothing for it to call. Quick mode can only return text from context.

This pattern is inspired by Claude Code's `/btw` (by the way) command for fire-and-forget side questions.

### Supported Agent Types

The server needs to understand different agent response formats:

| Agent Type | Protocol | Response Parsing |
|---|---|---|
| Claude Code | stdin: NDJSON, stdout: NDJSON | Parse `result` event for final text |
| Codex | args: prompt, stdout: JSONL | Parse `item.completed { type: "agent_message" }` |
| pi | SDK (in-process) | Subscribe to `agent_end` events |
| Generic | stdin: text, stdout: text | Raw text in/out |

Agent type is inferred from `run_command` or specified explicitly in configuration.

## CLI

### Human Commands

```bash
rebecca start [room]              # Start server + agents
rebecca stop [room]               # Stop agents (server keeps running)
rebecca status [room]             # Show agent statuses

rebecca room create <name>        # Create a room
rebecca rooms                     # List rooms

rebecca agent add <room> <name> --run "..."  # Add an agent
rebecca agent remove <room> <name>           # Remove an agent
rebecca agent restart <room> <name>          # Restart an agent

rebecca connect <room>            # Human interactive mode
```

### Programmatic Commands (for agents or scripts)

```bash
rebecca read <room>                    # Read recent messages
rebecca read <room> --last 50          # Read last 50
rebecca read <room> --before <id>      # Paginate backwards
rebecca post <room> "message text"     # Post a message
rebecca post <room> "@name message"    # Post with @mention
rebecca mentions <room> --for <name>   # Check pending @mentions
rebecca task create <room> "desc"      # Create a task
rebecca task update <id> <state>       # Update task state
```

## MCP Server (Optional)

For agents that support MCP natively (Claude Code, Cursor), Rebecca can also run as an MCP server. This is a thin wrapper over the HTTP API.

```bash
rebecca mcp-server                # Start MCP server mode
```

Exposes:
- Resources: `rebecca://rooms/<id>/messages`, `rebecca://rooms/<id>/tasks`
- Tools: `rebecca_post`, `rebecca_read`, `rebecca_check_mentions`, `rebecca_task_create`

This is a convenience layer. Everything it does can also be done via the CLI. Agents that can use bash do not need MCP.

## Project Structure

```
packages/
  server/
    src/
      db/              — Drizzle schema, migrations
      api/             — HTTP routes, WebSocket handlers
      agents/          — Agent process management, protocol parsers
        claude-code.ts — Claude Code stdin/stdout protocol
        codex.ts       — Codex JSONL protocol
        pi.ts          — Pi SDK embedding
        generic.ts     — Raw text in/out
      room.ts          — @mention routing, message storage
      server.ts        — Entry point
  cli/
    src/
      commands/        — Each CLI command
      cli.ts           — Entry point
  mcp/
    src/
      mcp-server.ts    — MCP wrapper over HTTP API
```

## Technology Stack

| Component | Choice | Why |
|---|---|---|
| Language | TypeScript | Already in use, type safety |
| Runtime | Node.js 20+ | Already in use |
| Database | SQLite (better-sqlite3) | Local-first, proven |
| ORM | Drizzle | Lightweight, type-safe |
| HTTP | Hono or Fastify | Lightweight, Unix socket support |
| WebSocket | ws | Standard |
| CLI | Commander or citty | Standard |
| Build | tsup | Already in use |
| Monorepo | npm workspaces | Simple |

## What This Enables Later

| Future Feature | How It's Supported |
|---|---|
| Multiple Rooms | Multi-room from day one (room_id on every table) |
| Dynamic agents | Add/remove agents at runtime via API |
| Remote agents | TCP listener + auth tokens alongside Unix socket |
| Web GUI | HTTP+WS API already there |
| Message search | Add FTS5 to messages table |
| Artifacts | Add artifacts table |
| A2A integration | A2A adapter wraps the HTTP API, like MCP |
| Slack/Discord bridge | Another client that reads/writes via HTTP API |

## What We Are NOT Building

- A distributed system. Single machine. Single server process. SQLite.
- A cloud service. Local-first. Runs on the developer's Mac.
- A workflow engine. No DAGs, no pipelines, no scheduled triggers.
- A Slack clone. Inspired by Slack's UX, not its architecture.
