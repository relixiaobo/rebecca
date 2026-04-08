# Implementation Plan

## Phase 0: Validate @mention Model on Prototype

Modify the existing prototype to test the @mention routing model before building the full server.

- [ ] Add message history array to Room
- [ ] Change Room.post() to only deliver to @mentioned agents (humans always receive)
- [ ] Change Connector.send() to include recent N messages as context (not just the single message)
- [ ] Update Agent system prompts: "respond when @mentioned, use @name to involve others"
- [ ] Test: Human + pi + Claude Code, @mention-based conversation
- [ ] Verify: no reply loops, natural conversation termination, agents collaborate via @mention chains

**Goal**: Confirm the @mention model works before investing in the full server architecture.

## Phase 1: Server Core

Build the persistent server with basic message read/write.

- [ ] Set up monorepo structure (packages/server, packages/cli)
- [ ] Set up SQLite + Drizzle ORM (rooms, participants, messages tables)
- [ ] HTTP API: POST/GET /rooms, POST/GET /rooms/:id/messages
- [ ] WebSocket: connect, receive new message events
- [ ] Server start/stop lifecycle

**Goal**: A running server that can store and serve messages.

## Phase 2: Human CLI

Build the CLI that lets a human chat in a Room.

- [ ] `rebecca server start/stop/status`
- [ ] `rebecca room create <name>`
- [ ] `rebecca connect <room>` — interactive chat mode (readline + WebSocket)
- [ ] `rebecca read <room>` — read recent messages
- [ ] `rebecca post <room> "message"` — post a message
- [ ] Parse @mentions from message text

**Goal**: A human can create a Room and chat in it (no agents yet, just message persistence).

## Phase 3: First Agent (Claude Code)

Connect Claude Code as a Room participant.

- [ ] `rebecca agent add <room> <name> --type claude-code`
- [ ] Built-in Claude Code connector: spawn subprocess, stream-json protocol
- [ ] @mention routing: only notify agent when @mentioned
- [ ] Context delivery: last N messages + triggering message → agent stdin
- [ ] Response parsing: result event → Room message
- [ ] Agent status tracking: online, working, error
- [ ] `rebecca start <room>` — start server + configured agents

**Goal**: Human + one Claude Code agent in a Room, communicating via @mention.

## Phase 4: Notification and Status

Complete the @mention notification and agent status system.

- [ ] @mention a working agent → queued, delivered after current work
- [ ] @mention an unavailable agent → system message "agent unavailable, message saved"
- [ ] Agent comes back online → receives pending @mentions
- [ ] Status visible in `rebecca connect` and `rebecca status`
- [ ] Agent crash → auto-restart with backoff → status update

**Goal**: Robust agent availability. No messages lost. Status always visible.

## Phase 5: Second Agent (Codex)

Add Codex as another built-in agent type.

- [ ] Built-in Codex connector: spawn subprocess, JSONL protocol, session resume
- [ ] `rebecca agent add <room> <name> --type codex`
- [ ] Test: Human + Claude Code + Codex in one Room, @mention chains between agents

**Goal**: Two different agent types coexisting in one Room.

## Phase 6: Task Model

Add task tracking so the team can see work in progress.

- [ ] Tasks table in SQLite
- [ ] API: create task, update state, list tasks
- [ ] CLI: `rebecca task create/update`, show tasks in `rebecca connect`
- [ ] Agents can create and update tasks via CLI or API
- [ ] Task state changes visible as system messages in Room

**Goal**: Long-running agent work is visible to the team.

## Phase 7: Configuration File

Add rebecca.yaml for project-level configuration.

- [ ] `rebecca init` — generate rebecca.yaml with sensible defaults
- [ ] `rebecca start` — read rebecca.yaml, create room, start agents
- [ ] Support: room name, agent list (name + type + options), cwd

**Goal**: One config file, one command to start everything.

## Phase 8: Programmatic Access for Developers

Clean up the API for developers who want to build custom agents.

- [ ] `rebecca mentions <room> --for <name> --wait` (long poll for @mentions)
- [ ] `rebecca join <room> --as <name> --kind agent` (register as participant)
- [ ] Document the HTTP API
- [ ] Document how to build a custom agent (shell script example)

**Goal**: A developer can write a custom Room agent in any language.

## Phase 9: Quick Invocation Mode (`/btw`)

Inspired by Claude Code's `/btw`. Differentiate quick questions from full tasks.

- [x] Detect `/btw` (and `/q` alias) prefix in message text — CLI strips it and sets mode
- [x] Add `mode` column to messages table; thread it through the pipeline
- [x] handleMention takes a mode parameter; queue items carry mode
- [x] AgentContext exposes mode to runners
- [x] System prompt branches on mode: quick mode tells the agent "no tools, no @mentions, one short response"
- [x] **Claude Code**: quick mode spawns a separate one-shot subprocess with `--tools ""`. No tools available at the framework level.
- [x] **Codex**: quick mode uses `--ephemeral --sandbox read-only` and does not resume thread.
- [x] Mention regex requires word boundary so `foo@bar.com` no longer matches
- [x] Tested: `/btw @agent count files` correctly returns "I can't access the filesystem" instead of running bash

**Goal**: Quick clarifications and lookups without spinning up full agent capabilities. **Done.**

### Originally explored alternative: `@agent?` suffix

The first attempt used `@agent?` with the `?` as a per-mention quick marker. Rejected because:
- The `?` is visually similar to natural punctuation and easy to miss.
- It conflicts with question marks in normal sentences.
- Per-mention granularity (some mentions quick, others full in the same message) is rarely useful and adds complexity.

Replaced with `/btw` prefix that marks the entire message as quick. All mentions in a quick message dispatch in quick mode. If you need both quick and full mentions, send two messages.

## Future (Not Planned Yet)

- Pi agent type (SDK embedding)
- MCP server mode
- Web GUI
- Message search (FTS5)
- Artifacts
- A2A integration
- Multiple Rooms per project
- Remote agents
- Slack/Discord bridge
