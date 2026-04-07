# Runtime Adapter Research (macOS Focus)

## Purpose

This document narrows the research to one question:

How can different local runtimes on macOS join the same shared collaboration chat?

The target runtimes for this pass are:

- `pi`
- `Claude Code`
- `Codex`
- `OpenClaw`

The discussion here is intentionally macOS-first. Cross-platform constraints are deferred unless they affect the macOS design directly.

## Executive Summary

There are three realistic adapter styles:

### 1. CLI Wrapper Adapter

Wrap a runtime as a subprocess, send it prompts, and parse machine-readable output.

Best for:

- `Claude Code`
- `Codex exec`

Pros:

- fastest to implement
- low coupling
- easy to replace later

Cons:

- weaker session control
- weaker event fidelity
- more prompt-level bridging

### 2. Native RPC / SDK Adapter

Integrate with a runtime’s programmatic session protocol or SDK.

Best for:

- `pi`
- `Codex app-server`

Pros:

- better session lifecycle control
- richer events
- cleaner interruption / resume semantics

Cons:

- more implementation work
- tighter protocol coupling

### 3. Host / Gateway Adapter

Use a runtime that already acts like a session router or chat gateway and connect your bus to it.

Best for:

- `OpenClaw`

Pros:

- already thinks in terms of sessions and message routing
- already exposes chat-facing transports

Cons:

- heavier system
- risks turning your architecture inside out if adopted too early

## Core Adapter Problem

For a runtime to participate in the shared chat bus cleanly, the adapter needs at least these capabilities:

- start or attach to a runtime instance
- identify the instance and keep a stable mapping
- inject a new message into that instance
- capture assistant output and tool/lifecycle events
- interrupt or steer in-flight work if supported
- resume a prior session or thread
- surface approvals and waiting states

Not every runtime exposes all of these equally well.

## Recommended Integration Principle

Do not make the chat bus depend on one runtime’s collaboration model.

For example:

- Claude Code has its own agent teams
- Codex has threads and turns
- pi has SDK, extensions, and RPC
- OpenClaw has a gateway and channel model

These are runtime-specific mechanics, not the shared bus abstraction.

The shared bus should define the collaboration semantics. Adapters should translate runtime behavior into that model.

## Practical Join Flow

For macOS local runtimes, "join the group chat" should mean the adapter performs this bridge:

1. start or attach to one runtime instance
2. register that instance as one participant in one room
3. subscribe to runtime output and lifecycle events
4. project selected runtime events into room messages, presence, and artifacts
5. inject inbound room messages back into the runtime as prompts, steering, or follow-ups

This keeps the room model stable even when runtime-specific APIs differ.

## What “Join the Group Chat” Should Mean

A runtime instance should be able to:

1. appear as a participant in a room
2. receive targeted or room-scoped messages
3. publish replies back into the room
4. publish artifacts
5. expose presence like idle, busy, awaiting approval, or offline

This does not require the runtime to natively understand “rooms”. The adapter can emulate room participation.

## Adapter Decision Matrix

| Runtime | Fastest usable path | Best long-term path | Notes |
|---------|---------------------|---------------------|-------|
| `pi` | SDK embedding | SDK embedding or RPC | Best first implementation because this repo already controls the launcher |
| `Claude Code` | CLI wrapper | CLI wrapper + hooks | Strong local UX, but its native team model should not become the shared bus model |
| `Codex` | `codex exec --json` | `codex app-server` | Best native event model after `pi` |
| `OpenClaw` | Participant wrapper | Deliberate gateway integration | Useful, but too heavy to become the default architecture early |

## `pi`: Best Adapter Path

### What `pi` exposes

`pi` is the most adapter-friendly runtime in this repo’s current stack.

Useful surfaces from the local package:

- SDK via `createAgentSession()`
- RPC mode over stdin/stdout JSONL
- extensions for tools, commands, event handlers, and UI

Relevant local references:

- [`@mariozechner/pi-coding-agent/README.md`](/Users/lixiaobo/Documents/Coding/rebecca/node_modules/@mariozechner/pi-coding-agent/README.md#L393)
- [`@mariozechner/pi-coding-agent/docs/rpc.md`](/Users/lixiaobo/Documents/Coding/rebecca/node_modules/@mariozechner/pi-coding-agent/docs/rpc.md#L1)
- [`@mariozechner/pi-coding-agent/examples/rpc-extension-ui.ts`](/Users/lixiaobo/Documents/Coding/rebecca/node_modules/@mariozechner/pi-coding-agent/examples/rpc-extension-ui.ts#L1)

Key capabilities:

- `prompt`
- `steer`
- `follow_up`
- `abort`
- `new_session`
- `get_state`

Implication:

`pi` can join the bus either through:

- direct SDK embedding
- RPC subprocess bridge

### Best use on macOS

For this project, the cleanest path is:

- keep `pi` in-process if the bus is implemented in Node
- use RPC only when isolation or process boundaries are needed

### Group chat implication

`pi` is the best first runtime for a first-class participant adapter because:

- you already control the wrapper
- you can intercept events
- you can inject follow-ups cleanly
- you do not need brittle terminal scraping

Suggested room bridge:

- room message -> `session.prompt()`, `session.steer()`, or `session.followUp()`
- `session.subscribe()` events -> room messages / artifacts / presence
- `session.abort()` -> participant interrupt

## Claude Code: Best Adapter Path

### What Claude Code exposes

Claude Code exposes strong CLI and automation surfaces:

- continue / resume
- named sessions and explicit session IDs
- print mode
- JSON and stream-json output
- hook lifecycle events
- subagents and agent teams

Key docs:

- [Claude Code CLI reference](https://code.claude.com/docs/en/cli-reference)
- [Claude Code hooks](https://code.claude.com/docs/en/hooks)
- [Claude Code subagents](https://code.claude.com/docs/en/sub-agents)
- [Claude Code agent teams](https://code.claude.com/docs/en/agent-teams)

Important details:

- `claude -c` continues the most recent conversation in the current directory
- `claude -r <session>` resumes a specific session
- `--session-id` can force a specific UUID-backed session
- `-p --output-format json|stream-json` gives machine-readable output
- `--include-hook-events` can include hook lifecycle events in the stream
- `--worktree` creates an isolated git worktree

### Best use on macOS

The best first Claude adapter is a CLI wrapper, not Claude’s built-in agent teams.

Why:

- agent teams are Claude-specific collaboration semantics
- your goal is a runtime-agnostic shared bus
- the CLI already gives enough session, output, and isolation controls

Recommended phase 1 pattern:

- one Claude instance per participant
- one session per participant
- use `-p` plus `stream-json` for machine-readable interaction
- use `--resume` or `--session-id` for continuity
- optionally use hooks to notify the external bus about important lifecycle points

### What Claude hooks are good for

Hooks are useful for:

- forwarding task completion or idle notifications to the bus
- enforcing guardrails before Bash/Edit/Write
- reacting to file changes or working-directory changes
- surfacing state transitions without scraping terminal output

They are less suitable as the primary message transport. They should complement the adapter, not replace it.

### Group chat implication

Claude Code can join the bus well, but the bus should drive Claude, not Claude agent teams.

The right abstraction is:

- external room bus
- Claude adapter maps room messages into Claude session prompts
- Claude session outputs become bus messages or artifacts

Suggested room bridge:

- room message -> `claude -p` follow-up against a stable session
- streaming output -> room typing / final messages
- hook events -> presence, approval, or lifecycle signals

## Codex: Best Adapter Path

### What Codex exposes

Codex has two very different integration levels:

1. `codex exec`
2. `codex app-server`

Key docs:

- [Codex non-interactive mode](https://developers.openai.com/codex/noninteractive)
- [Codex app-server](https://developers.openai.com/codex/app-server)

### `codex exec`

Useful properties:

- `codex exec --json` emits JSONL events
- event stream includes `thread.started`, `turn.started`, `turn.completed`, `item.*`, and `error`
- `codex exec resume --last` or `codex exec resume <SESSION_ID>` continues prior runs

Implication:

`codex exec` is suitable as a simple job-style participant or worker participant.

### `codex app-server`

This is the stronger long-term adapter surface.

Useful properties:

- `thread/start`
- `thread/resume`
- `thread/list`
- `thread/read`
- `turn/start`
- `turn/steer`
- explicit runtime status events
- explicit approval events for commands and file changes

Implication:

Codex app-server is close to an ideal first-class participant protocol.

It already thinks in:

- threads
- turns
- item events
- approvals
- cwd and sandbox policy

### Best use on macOS

Recommended sequence:

1. use `codex exec --json` first if you want a fast integration
2. move to `codex app-server` when you want true participant semantics

### Group chat implication

Codex is the strongest candidate for a native adapter after `pi`.

It is especially suitable when you want:

- structured event streaming
- thread-aware resumption
- robust steering of active work
- explicit approval surfacing

Suggested room bridge:

- room message -> `turn/start` or `turn/steer`
- `item/agentMessage/delta` -> room live typing
- `item/completed` -> authoritative room message or artifact
- approval request -> room escalation to a human participant

## OpenClaw: Best Adapter Path

### What OpenClaw exposes

OpenClaw is qualitatively different from the others.

It is closer to a gateway platform than to a plain coding-agent CLI.

Useful docs:

- [OpenClaw Agent Loop](https://docs.openclaw.ai/concepts/agent-loop)
- [OpenClaw WebChat](https://docs.openclaw.ai/web/webchat)
- [OpenClaw macOS app](https://docs.openclaw.ai/macos)

Important details:

- gateway RPC entry points: `agent` and `agent.wait`
- event streams bridge assistant, tool, and lifecycle output
- gateway/webchat already supports `chat.send`, `chat.history`, and `chat.inject`
- the macOS app can manage the local gateway and macOS permissions

### Best use on macOS

OpenClaw should not be the first integration unless you deliberately want it as the host gateway.

The safest framing is:

- either treat OpenClaw as another participant runtime
- or consciously decide to make it the outer routing layer

Do not accidentally let it become your architecture by default.

### Group chat implication

OpenClaw is very good at channels and routing, but that is exactly why it is dangerous to adopt too early.

If your goal is a runtime-agnostic bus, OpenClaw should be connected through a boundary, not be the boundary.

## macOS-Specific Notes

### Display and panes

For Claude Code, split-pane teammate mode depends on tmux or iTerm2 tooling. This is useful for human visibility but not required for the shared bus.

That means:

- UI multiplexing is optional
- chat-bus integration should not depend on tmux or iTerm2

### Worktree isolation

macOS local development should assume multiple writable instances can collide.

The adapter layer should prefer:

- separate `cwd`s
- separate git worktrees
- per-instance tmp/log/cache dirs

This matters more than shell choice.

## Recommended Bus-Level Contract

The shared bus should only require a minimal runtime-neutral adapter contract:

- `startInstance()`
- `attachParticipant()`
- `sendMessage()`
- `steer()`
- `interrupt()`
- `resume()`
- `subscribeEvents()`
- `getPresence()`

If a runtime cannot support all of these, the adapter can degrade gracefully:

- no `steer` support means queued follow-ups only
- no native `presence` means infer from process state
- no native artifact events means synthesize artifacts from final messages

This lets wrappers and native adapters coexist.

## Developer-Provided Adapters

The system should explicitly leave room for developers to bring their own runtimes.

This means:

- the core should not assume a closed list of supported runtimes
- built-in adapters should be examples, not the only extension path
- adapter contracts should be documented well enough for external implementation

Practically, this suggests:

- first-party adapters for key runtimes we care about directly
- a plugin-style adapter registration model for everything else

This makes the ecosystem scalable without forcing the core project to absorb every new agent product.

## Recommended Adapter Strategy

### Phase 1

Build the shared bus first, then attach runtimes through the least invasive usable adapter:

- `pi` via SDK or RPC
- `Claude Code` via CLI wrapper plus `stream-json`
- `Codex` via `codex exec --json`

### Phase 2

Promote runtimes with better native control to first-class adapters:

- `pi` stays first-class
- `Codex` upgrades to app-server
- `Claude Code` gains hooks-based state bridging if needed

### Phase 3

Only then decide whether:

- OpenClaw should join as a participant
- or OpenClaw should become a gateway peer

## Recommended Participant Join Model

For all runtimes, use the same abstract flow:

1. create runtime instance
2. map runtime instance to participant
3. subscribe to runtime events
4. project relevant runtime events into room messages
5. inject inbound room messages back into the runtime

This keeps the runtime-specific protocol at the edge.

## Best First Implementations

If the goal is to get a room working quickly on macOS:

1. `pi` adapter
2. `Claude Code` CLI adapter
3. `Codex exec` adapter

If the goal is to get the cleanest long-term architecture:

1. shared bus
2. `pi` native adapter
3. `Codex app-server` native adapter
4. `Claude Code` wrapper adapter with hooks as enhancements

## One-Sentence Conclusion

On macOS, the cleanest route is to treat group chat as an external bus and integrate runtimes through adapters, with `pi` and `Codex app-server` as the strongest native fits and `Claude Code` as the strongest wrapper-based fit.
