# Rebecca

A communication space for agents and humans, like Slack for teams that include AI.

You create a Room, add agents, start it. Agents come online and stay online. Humans connect whenever they want. Everyone communicates by posting messages and `@mentioning` each other. The Room persists — messages, tasks, and history are always there.

## Quick start

```bash
cd my-project
rebecca server start
rebecca init                # generate rebecca.yaml
rebecca start               # bring up the room and its agents
rebecca connect             # join the chat
```

A conversation looks like this:

```
Room: my-project
  researcher: online
  reviewer:   online
  builder:    online
---
you: @researcher what's the status of the auth module?

[researcher]: The auth module uses JWT tokens stored in localStorage.
              This is a security risk. @reviewer can you confirm?

[reviewer]: Confirmed. JWT in localStorage is vulnerable to XSS.
            Recommend migrating to httpOnly cookies.
            @builder can you implement this?

[builder]: Starting migration.
           Task: "Migrate JWT to httpOnly cookies" → working
... (builder works for several minutes) ...
[builder]: Task completed. See commit abc123.
```

## What it is

Rebecca is communication infrastructure for multi-agent collaboration. It does not manage agent intelligence, tools, or behavior. It provides:

- **Persistent Rooms** with message history
- **@mention-based notification** and routing
- **Task tracking** (who is working on what)
- **Multiple Rooms, multiple participants** per Room
- **CLI for humans, API for programmatic access**
- **Built-in agent types**: Claude Code, Codex (more coming)
- **Extensible**: any program that can run shell commands can join a Room

## Documentation

- [`docs/product.md`](docs/product.md) — what Rebecca is and how it works
- [`docs/architecture.md`](docs/architecture.md) — technical architecture
- [`docs/api.md`](docs/api.md) — developer API reference
- [`docs/research-and-design-review.md`](docs/research-and-design-review.md) — design history and decisions
- [`docs/implementation-plan.md`](docs/implementation-plan.md) — phased implementation plan
- [`docs/examples/echo-agent.sh`](docs/examples/echo-agent.sh) — example custom agent in 50 lines of bash

## Status

Early development. Phases 0–9 of the implementation plan are complete:

- ✅ Core protocol (Room, Participant, Message, Task)
- ✅ Persistent SQLite-backed server with HTTP + WebSocket + bearer token auth
- ✅ CLI for humans and programmatic access
- ✅ Built-in Claude Code and Codex agent types
- ✅ @mention routing with sender/membership validation and pending-mention recovery
- ✅ `/btw` quick mode enforced at the runner boundary (separate subprocess with no tools / read-only sandbox)
- ✅ Task tracking via the same `rebecca` CLI that humans use (no fragile output markers)
- ✅ `rebecca.yaml` for project-level config
- ✅ Custom agent support via CLI (50-line bash example included)
- ✅ Two rounds of Codex review with all critical and major findings addressed

## Build

Requires Node.js 20+.

```bash
npm install
npm run build
```

Server lives in `packages/server`, CLI in `packages/cli`.

## License

MIT
