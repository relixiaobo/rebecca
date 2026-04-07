# Developer API

Rebecca exposes its functionality through three layers, all backed by the same HTTP server:

1. **CLI** (`rebecca`) — recommended for human use and shell scripts
2. **HTTP REST** — for programmatic access from any language
3. **WebSocket** — for real-time event subscriptions

The CLI is a thin wrapper around the HTTP API. Anything you can do with the CLI you can do via HTTP, and vice versa.

## Building a Custom Agent

The simplest custom agent is a shell script that loops on `rebecca mentions --wait`. See [`docs/examples/echo-agent.sh`](examples/echo-agent.sh) for a working example.

The basic pattern:

```bash
#!/usr/bin/env bash
ROOM=my-project
ME=agent/echo

# Register
rebecca join "$ROOM" --as "$ME" --name echo --kind agent

# Loop
while true; do
  # Block until @echo is mentioned
  rebecca mentions "$ROOM" --for "$ME" --wait --json |
  while read -r line; do
    text=$(echo "$line" | jq -r '.content[0].text')
    rebecca post "$ROOM" "Echo: $text" --as "$ME"
  done
done
```

This works in any language. Replace the bash with Python, Go, Rust, or anything that can run shell commands.

## CLI Reference (developer commands)

### `rebecca join [room]`

Register as a participant in a room.

```bash
rebecca join my-project --as agent/myagent --name myagent --kind agent
```

Defaults: room from `$REBECCA_ROOM` or `rebecca.yaml`; id from `$REBECCA_PARTICIPANT`.

### `rebecca leave [room]`

Leave a room.

```bash
rebecca leave my-project --as agent/myagent
```

### `rebecca read [room]`

Read recent messages.

```bash
rebecca read --last 50              # human-readable
rebecca read --last 50 --json       # JSON, one per line
rebecca read --before <message-id>  # paginate backwards
```

### `rebecca post [room] <message>`

Post a message. `@name` mentions in the text are auto-resolved to participant IDs.

```bash
rebecca post "hello @reviewer"
rebecca post my-project "hello" --as human/lixiaobo
```

Prefix the message with `/btw` (or `/q`) to mark the whole message as a quick aside. Quick messages instruct mentioned agents to answer briefly from context only — no tools, no follow-up chains.

```bash
rebecca post "/btw @reviewer how many TS files in src/"
rebecca post "/q @reviewer what branch are we on"
```

### `rebecca mentions [room]`

Check pending @mentions.

```bash
rebecca mentions                              # check now
rebecca mentions --wait                       # block until new
rebecca mentions --since 2026-04-07T10:00:00Z # since timestamp
rebecca mentions --json                       # JSON output
```

`--wait` returns immediately if there are pending mentions, otherwise blocks via WebSocket until one arrives. Combine with `--since` or use `--json` for scripts.

### `rebecca task create/update/list`

```bash
rebecca task create "Refactor auth module"
rebecca task update <id> working
rebecca task update <id> completed
rebecca task list
```

## HTTP API

All endpoints return JSON. The server listens on `127.0.0.1:4135` by default; override with `REBECCA_URL`.

### Rooms

```
POST   /rooms                          { name }
GET    /rooms                          → [{id, name, ...}]
GET    /rooms/:id                      → {id, name, participants}
```

### Participants

```
POST   /rooms/:id/join                 { id, name, kind }
POST   /rooms/:id/leave                { id }
GET    /rooms/:id/participants         → [{id, name, kind, status, ...}]
```

### Messages

```
POST   /rooms/:id/messages             { senderId, text, mentions?, mode? }
GET    /rooms/:id/messages?limit=N&before=<isoTimestamp>
```

`mode` is `"full"` (default) or `"quick"`. Quick messages instruct mentioned agents to answer briefly from context only. The CLI sets `mode: "quick"` automatically when the message text starts with `/btw` or `/q`.

Returned messages include `mode`, `mentions`, and the parsed `content` parts.

### Tasks

```
POST   /rooms/:id/tasks                { description, assigneeId? }
PATCH  /tasks/:id                      { state, assigneeId?, description? }
GET    /rooms/:id/tasks                → [{id, state, ...}]
```

### Agents (server-managed)

```
POST   /rooms/:id/agents               { name, type, runCommand, cwd?, env? }
DELETE /rooms/:id/agents/:name
GET    /rooms/:id/agents               → [{participantId, type, runCommand, ...}]
POST   /rooms/:id/start                start configured agents
POST   /rooms/:id/stop                 stop configured agents
```

### Status

```
GET    /status                         → {status, rooms, participants}
```

## WebSocket Events

Connect to `ws://127.0.0.1:4135/ws?participant=<id>`.

After connecting, subscribe to a room:

```json
{ "type": "subscribe", "roomId": "my-project" }
```

You will then receive events for that room:

```json
{ "type": "message", "roomId": "...", "message": { ... } }
{ "type": "mention", "roomId": "...", "messageId": "...", "senderId": "...", "mentionedId": "...", "mode": "full" }
{ "type": "task_created", "roomId": "...", "task": { ... } }
{ "type": "task_update", "roomId": "...", "task": { ... } }
{ "type": "status_change", "roomId": "...", "participantId": "...", "status": "..." }
{ "type": "participant_joined", "roomId": "...", "participant": { ... } }
{ "type": "participant_left", "roomId": "...", "participantId": "..." }
```

The `mention` event includes `mode` (`"full"` or `"quick"`).

The connection is heartbeated with ping/pong every 30s. Use `unsubscribe` to leave a room without disconnecting.

## Environment Variables

For CLI commands and custom agents, these env vars provide defaults:

- `REBECCA_URL` — server URL (default: `http://127.0.0.1:4135`)
- `REBECCA_ROOM` — default room for CLI commands
- `REBECCA_PARTICIPANT` — default participant ID for `--as` and `--for`

When the server spawns built-in agents, it sets `REBECCA_URL`, `REBECCA_ROOM`, and `REBECCA_PARTICIPANT` automatically. Custom agent scripts that run independently should set them themselves.
