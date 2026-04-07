# Multi-Agent Collaboration Notes

## Purpose

This document summarizes the current design direction for turning this repository from a thin `pi` launcher into a collaboration system where humans and multiple agent runtimes can coexist and cooperate.

The goal is not to build a single agent. The goal is to build a collaboration layer that can host:

- multiple `pi` instances
- multiple `Claude Code` instances
- multiple `Codex` instances
- other runtimes such as `OpenClaw`
- human participants

## Current Repo Position

This repository is currently a very small wrapper around `@mariozechner/pi-coding-agent`.

Current behavior:

- bootstraps a terminal agent from [`src/cli.ts`](/Users/lixiaobo/Documents/Coding/rebecca/src/cli.ts#L1)
- uses a Rebecca-specific system prompt
- restricts available tools to `bash`
- delegates almost all runtime behavior to `pi-coding-agent`

This means the repository is currently closer to a custom runtime entrypoint than to a complete agent platform.

## Product Framing

This system is intended for developers who:

- use multiple coding agents across projects
- want humans and agents to collaborate in the same space
- want to keep private runtime contexts isolated
- want cross-runtime collaboration without being locked into one product

The main problem being solved is not "how to build another agent".

The main problem is:

- agents are isolated inside separate tools
- cross-project and cross-agent collaboration is awkward
- humans cannot easily work in the same loop as multiple agents
- local multi-instance execution creates side-effect risks without a shared coordination layer

This problem is not limited to coding-only workflows.

A realistic product workflow often spans:

- implementation
- review
- documentation
- launch planning
- marketing copy
- release communication

The same product goal may need multiple role-shaped participants, not just multiple coding agents.

The system addresses this by:

- treating humans and agent instances as participants
- connecting them through a shared collaboration bus and rooms
- keeping runtime details behind adapters
- preserving private contexts while exposing messages, artifacts, and presence

This makes the system suitable not only for software implementation work, but for broader product delivery collaboration.

## Core Goal

The intended system should support:

- private context per instance
- free-form chat between humans and agents
- cross-project collaboration
- multiple runtimes joining the same shared collaboration space
- local-first execution when needed
- a single abstraction that does not depend on one specific runtime

## Key Terminology

### Model

The underlying foundation model.

Examples:

- Claude
- GPT
- Gemini

### Agent

A role-shaped intelligence configured with prompts, tools, and behavior constraints.

Examples:

- reviewer
- implementer
- researcher

### Runtime

The execution system that hosts and runs an agent instance.

A runtime answers:

- how a session is started
- how input is injected
- how output is streamed
- how sessions are resumed
- how tools are executed
- how approvals and permissions work
- how working directories and environment are handled

Examples:

- `pi`
- `Claude Code`
- `Codex`
- `OpenClaw`

### Runtime Instance

A concrete running or resumable execution instance inside a runtime.

A runtime instance may have:

- `cwd`
- session ID
- thread ID
- writable scope
- isolation mode
- state

### Participant

The collaboration-system identity of a member in the shared space.

A participant is the primary abstraction for the bus. It can be:

- a human
- one `pi` instance
- one `Claude Code` instance
- one `Codex` instance

Important distinction:

- `runtime` answers: how does it run?
- `participant` answers: who is participating?

This is why the collaboration system should be designed around `participant`, not `agent`.

## Proposed Core Abstraction

The system should treat everything as a participant:

- `human/lixiaobo`
- `pi/project-a/worker-1`
- `claude-code/project-b/reviewer`
- `codex/project-c/implementer`

That gives a uniform collaboration model across products and runtimes.

Important clarification:

- `pi` is a runtime family, not one agent
- `Claude Code` is a runtime, not one agent
- `Codex` is a runtime, not one agent

Each of them can have many simultaneous instances, and each instance can map to a different participant.

## Recommended Architecture

### 1. Runtime Adapter Layer

Adapters integrate with specific runtimes.

Examples:

- `pi` adapter
- `Claude Code` adapter
- `Codex` adapter
- `OpenClaw` adapter

Responsibilities:

- create runtime instances
- attach participants
- send input
- resume sessions
- interrupt sessions
- stream runtime events
- read runtime state

The core system should not hard-code Claude-specific or Codex-specific logic.

### First-Party vs Third-Party Runtimes

The architecture should distinguish between:

- first-party agents running on `pi`
- third-party participants running on external runtimes

This matters because `pi` is not just another external tool here.

`pi` should be treated as the first runtime framework that can host custom agents defined by this system.

Examples:

- `pi` + researcher prompt + bash-only tool policy
- `pi` + reviewer prompt + stricter write permissions
- `pi` + implementer prompt + project-specific skills

These are separate agents, all running on the same `pi` runtime family.

By contrast:

- `Claude Code`
- `Codex`
- `OpenClaw`

should initially be treated as third-party runtimes joined through adapters.

This gives the system two useful layers:

- first-party agent family on top of `pi`
- third-party runtime participants connected at the edge

### 2. Participant Registry

Tracks collaboration identities and links them to runtime instances.

Responsibilities:

- participant identity
- participant kind: human or agent
- runtime name
- runtime instance ID
- display name
- workspace
- role
- capabilities
- presence

### 3. Bus / Room Layer

Provides shared collaboration spaces.

Responsibilities:

- rooms
- membership
- messages
- mentions
- threads
- presence updates
- lightweight broadcasting

This layer is the collaboration core.

### 4. Artifact Projection Layer

Captures important outputs as explicit result references.

This exists because not every important result should remain buried in chat history.

Examples of artifacts:

- file path
- commit hash
- PR link
- summary note
- patch
- decision record

The first version should keep this lightweight. Artifact records should mostly point to the real storage location rather than duplicate content.

## Open Ecosystem Direction

The system should not try to directly support every agent product in the core.

Instead, it should:

- provide a few built-in adapters
- expose a stable adapter boundary for developers
- allow third parties to connect their own runtimes

That means the system should be designed to support:

- built-in adapters for important runtimes
- native adapters for SDK/RPC-capable runtimes
- process adapters for CLI/headless runtimes
- future protocol adapters for cross-agent standards

This is preferable to hard-coding product-specific logic for every new agent ecosystem.

## Why Artifacts Matter

Without artifacts:

- someone says "I finished it"
- others still do not know where the result is
- the result can be buried in chat history
- later participants cannot quickly identify the canonical output

With artifacts:

- results can be explicitly published
- results can be referenced by room or thread
- other participants know what exists, who produced it, and where to find it

The point of an artifact is not to replace files. The point is to give the collaboration system a consistent way to recognize and reference outcomes.

## Group Chat vs Inbox / Task System

The intended UX is closer to a shared chat space with humans and agents participating together.

However, pure free-form group chat is not enough by itself.

Why:

- chat is good for discussion, not for durable state
- important conclusions can be buried in history
- ambiguous messages are hard for agents to interpret
- later participants cannot easily tell what is final vs exploratory

The recommended direction is:

- keep group chat free-form
- add a very thin protocol on top
- keep durable state outside raw chat logs when necessary

That means:

- chat remains natural
- humans are not forced into rigid tickets
- agents still have enough structure to collaborate reliably

## Thin Protocol Guidance

The collaboration layer should stay lightweight.

A reasonable first version of message types:

- `chat`
- `help`
- `status`
- `decision`
- `artifact`
- `handoff`
- `system`

This is not intended to become a heavy workflow engine.

## Minimal Data Model

### Participant

```ts
type Participant = {
  id: string
  kind: "human" | "agent"
  displayName: string
  runtime?: string
  runtimeInstanceId?: string
  workspace?: string
  role?: string
  capabilities: {
    canReceiveMessage: boolean
    canSendMessage: boolean
    canPublishArtifact: boolean
    canResume: boolean
    canInterrupt: boolean
  }
  presence: "idle" | "busy" | "offline" | "awaiting_input"
  metadata?: Record<string, unknown>
}
```

### RuntimeInstance

```ts
type RuntimeInstance = {
  id: string
  runtime: "pi" | "claude-code" | "codex" | "openclaw" | string
  cwd?: string
  repoId?: string
  sessionId?: string
  threadId?: string
  writable: boolean
  isolation: "none" | "cwd" | "git-worktree" | "container" | "vm"
  state: "starting" | "idle" | "busy" | "stopped" | "error"
  metadata?: Record<string, unknown>
}
```

### Room

```ts
type Room = {
  id: string
  name: string
  members: string[]
  topics?: string[]
  metadata?: Record<string, unknown>
}
```

### Message

```ts
type Message = {
  id: string
  roomId: string
  senderId: string
  type: "chat" | "help" | "decision" | "artifact" | "handoff" | "status" | "system"
  text: string
  mentions?: string[]
  threadId?: string
  replyTo?: string
  createdAt: string
  metadata?: Record<string, unknown>
}
```

### Artifact

```ts
type Artifact = {
  id: string
  roomId: string
  publisherId: string
  kind: "file" | "summary" | "link" | "commit" | "patch" | "note"
  title: string
  uri?: string
  content?: string
  createdAt: string
  metadata?: Record<string, unknown>
}
```

## Artifact Storage

Artifacts should be stored lightly.

Recommended approach:

- real content stays where it naturally belongs
- the collaboration system stores metadata records that reference that content

Examples:

- file artifact points to a file path
- commit artifact points to a git commit
- link artifact points to a URL
- summary artifact can inline short text

This avoids inventing a second heavy storage system too early.

## Local-First Multi-Instance Risks

If multiple runtime instances run on the same Mac and all can execute shell commands, the main risk is not "bash" itself. The risk is shared side effects.

Main collision surfaces:

- same working directory
- same git worktree
- same files
- same ports
- same global config directories
- same temp directories
- same background processes

Recommended first rules:

1. Only one writable instance per `cwd`.
2. Multiple writable instances for the same repo must use different `git worktree` directories.
3. Each instance should have its own temp/cache/log directory.
4. Ports and lock files should be tracked as instance metadata.

The real isolation unit is:

- `cwd`
- `repo`
- writable scope
- side-effect surface

## What We Learned From `cc-2.1`

The most useful inspiration from `/Users/lixiaobo/Documents/Coding/cc-2.1` is not its coordinator. It is its collaboration layer.

Strong ideas worth learning from:

- each agent keeps private context
- collaboration state exists outside any single project
- agents communicate by messages rather than shared full context
- new messages can be auto-delivered into the next turn
- humans can see those messages
- execution backend and collaboration protocol are decoupled

Parts that are less suitable to copy directly:

- `Team = TaskList`
- strong `team-lead` centrality
- heavy lifecycle coordination as a baseline

The key takeaway:

Do not build "many agents sharing one context". Build "many isolated participants connected by an independent collaboration layer".

## Competitor / Product Research Summary

### Claude Code

Useful takeaways:

- has programmatic/headless usage
- supports session continuation and structured output
- has hooks and plugin surfaces
- has subagents / teammates with isolated contexts

Implication:

`Claude Code` is a strong candidate for an adapter-friendly runtime.

References:

- [Claude Code headless](https://code.claude.com/docs/en/headless)
- [Claude Code hooks](https://code.claude.com/docs/en/hooks)
- [Claude Code subagents](https://code.claude.com/docs/en/subagents)
- [Claude Code agent teams](https://code.claude.com/docs/en/agent-teams)

### Codex

Useful takeaways:

- `codex exec --json` is suitable for script-driven integration
- `codex app-server` is suitable for deep integration with threads, turns, and events

Implication:

`Codex` should likely have both a simple adapter path and a deeper adapter path.

References:

- [Codex non-interactive mode](https://developers.openai.com/codex/noninteractive)
- [Codex app-server](https://developers.openai.com/codex/app-server)

### Cursor / GitHub Copilot / Devin

Useful takeaways:

- isolated environments matter
- parallel execution matters
- task and review surfaces are effective for human oversight

But these products are more task-centric than chat-centric.

References:

- [Cursor Background Agents](https://docs.cursor.com/en/background-agent)
- [GitHub Copilot agents](https://github.com/features/copilot/agents)
- [Devin advanced capabilities](https://docs.devin.ai/work-with-devin/advanced-capabilities)

### OpenHands / CrewAI / AutoGen

Useful takeaways:

- delegation and orchestration are separate concerns
- crews and flows should not be collapsed into one abstraction
- group chat alone often needs extra control policies to remain stable

References:

- [OpenHands sub-agent delegation](https://docs.openhands.dev/sdk/guides/agent-delegation)
- [CrewAI docs](https://docs.crewai.com/)
- [AutoGen multi-agent chat](https://autogenhub.github.io/autogen/docs/Use-Cases/agent_chat/)

### OpenClaw

Useful takeaways:

- it can serve as a runtime or heavier platform layer
- it already thinks in terms of plugin/runtime integration

References:

- [OpenClaw agent loop](https://docs.openclaw.ai/concepts/agent-loop)
- [OpenClaw plugins](https://docs.openclaw.ai/tools/plugin)
- [OpenClaw plugin runtime](https://docs.openclaw.ai/plugins/sdk-runtime)

## Current Recommended Product Direction

At this stage, the clearest direction is:

- keep this repository small and runtime-focused at first
- define a collaboration layer outside any single runtime
- treat all humans and runtime instances as participants
- integrate runtimes through adapters
- treat `pi` as the home runtime for first-party agents
- treat other runtimes as third-party participants joined through adapters
- keep the protocol thin
- preserve free-form chat
- add artifacts and minimal structure only where they solve real collaboration problems

## Suggested Near-Term Next Steps

1. Define the on-disk `bus/` layout.
2. Define the adapter interface in code.
3. Decide how runtime events become room messages.
4. Decide how messages are injected back into runtime instances.
5. Define local isolation rules for writable instances.
6. Implement one runtime adapter first, likely `pi` or `Claude Code`.

## Adapter Research: How Runtimes Join Group Chat

The adapter question is not "can this runtime talk?" Most of them can. The real question is:

- how do we identify an instance
- how do we inject room messages into it
- how do we extract output/events from it
- how do we resume the same conversation later
- how do we handle approvals and side effects

On macOS, the most practical first-generation integration strategy is to prefer local process adapters before deeper native integrations, except where a runtime already exposes a strong process protocol.

### Adapter Modes

There are three useful adapter classes.

#### 1. Process Wrapper Adapter

Spawn the runtime as a subprocess, stream stdin/stdout, and treat it as a participant.

Good for:

- `pi --mode rpc`
- `claude -p --output-format stream-json`
- `codex exec --json`

Strengths:

- fastest to implement
- local and macOS-friendly
- no need to modify the runtime itself

Weaknesses:

- session semantics vary by runtime
- approval handling may be limited
- interactive UX may be harder unless the runtime already emits structured events

#### 2. Native Runtime Adapter

Integrate with a runtime’s first-class control protocol or SDK.

Good for:

- `pi` SDK
- `codex app-server`
- potentially Claude Code SDK or Remote Control later

Strengths:

- better session control
- better event fidelity
- cleaner approval handling
- more reliable resume/interrupt semantics

Weaknesses:

- higher implementation complexity
- runtime-specific protocol surface

#### 3. Embedded / Host Adapter

Treat the runtime not just as a participant, but as a platform or host that can run other runtimes.

Good for:

- `OpenClaw`

Strengths:

- good when the runtime already manages routing, sessions, channels, and background runs

Weaknesses:

- heavier and more opinionated
- risks distorting the bus design if adopted too early

### `pi` Adapter

`pi` is the most flexible runtime in this repository because it already supports:

- direct SDK embedding
- RPC mode over stdin/stdout
- JSON mode
- extension event hooks
- custom messages and queued steering/follow-up input

Relevant sources:

- [`pi` README: SDK and RPC mode](https://github.com/mariozechner/pi-coding-agent) when available locally via [`node_modules/@mariozechner/pi-coding-agent/README.md`](/Users/lixiaobo/Documents/Coding/rebecca/node_modules/@mariozechner/pi-coding-agent/README.md#L393)
- [`pi` RPC docs](/Users/lixiaobo/Documents/Coding/rebecca/node_modules/@mariozechner/pi-coding-agent/docs/rpc.md#L1)
- [`AgentSession` typings](/Users/lixiaobo/Documents/Coding/rebecca/node_modules/@mariozechner/pi-coding-agent/dist/core/agent-session.d.ts#L1)
- [`Extensions` docs](/Users/lixiaobo/Documents/Coding/rebecca/node_modules/@mariozechner/pi-coding-agent/docs/extensions.md#L1)

Important capabilities:

- `AgentSession.prompt()` can send prompts directly
- `steer()` and `followUp()` support queued delivery while streaming
- `sendCustomMessage()` can inject room events or internal bus events without pretending they were user text
- `subscribe()` exposes agent session events
- extensions can intercept tools and lifecycle events

Implication:

`pi` is a strong candidate for the first native adapter because it can represent room traffic as custom messages instead of flattening everything into plain prompt text.

Recommended `pi` path:

1. Build a Node-native adapter around `createAgentSession()`.
2. Represent room messages as `sendCustomMessage()` where appropriate.
3. Subscribe to `AgentSession` events and map them to room messages/artifacts.
4. Add a small extension only if extra tool interception or room-aware UI is needed.

### Claude Code Adapter

Claude Code has three relevant surfaces for this problem.

#### A. Headless / print mode

Useful CLI features:

- `claude -p`
- `--output-format json`
- `--output-format stream-json`
- `--input-format stream-json`
- `--resume`
- `--continue`
- `--session-id`

Official references:

- [Claude Code CLI reference](https://code.claude.com/docs/en/cli-reference)
- [Claude Code SDK overview](https://docs.anthropic.com/s/claude-code-sdk)

Important implications:

- Claude Code can run in non-interactive mode as a local subprocess.
- It can stream structured output.
- It can accept streaming JSON input over stdin, which means we do not need to restart the binary for every room message.
- It can resume by session ID or continue from the current directory’s latest session.

This is the most practical first adapter path for Claude Code on macOS.

#### B. Hooks

Hooks matter because they provide context injection and lifecycle interception.

Official reference:

- [Claude Code hooks](https://code.claude.com/docs/en/hooks)

Important implications:

- `UserPromptSubmit` hooks can inject additional context into the conversation.
- `SessionStart` hooks can inject initial context.
- `Notification` hooks expose permission and idle notifications.
- `PreToolUse` / `PostToolUse` hooks can intercept or annotate tool behavior.

This makes hooks useful for:

- pulling unread room messages into the next turn
- mirroring important local runtime events to the room
- forwarding permission prompts into the collaboration layer

#### C. Subagents / teammates

Official references:

- [Claude Code subagents](https://code.claude.com/docs/en/sub-agents)
- [Claude Code agent teams](https://code.claude.com/docs/en/agent-teams)

Important implication:

Claude Code already thinks in terms of isolated contexts per subagent/teammate, which aligns well with the participant model. However, its built-in team system should not become the system-wide bus. It should remain an internal Claude-specific runtime feature.

Recommended Claude Code path:

1. Start with a process adapter using `claude -p --output-format stream-json --input-format stream-json`.
2. Use `--session-id`, `--resume`, or `--continue` to keep participant continuity.
3. Add hooks only for context injection and event mirroring.
4. Do not make Claude teams the global collaboration model.

### Codex Adapter

Codex has two distinct adapter surfaces.

#### A. `codex exec --json`

Official reference:

- [Codex non-interactive mode](https://developers.openai.com/codex/noninteractive)

Important capabilities:

- emits JSONL event streams
- includes `thread.started`, `turn.started`, `turn.completed`, `turn.failed`, `item.*`, and `error`
- can resume prior runs with `codex exec resume`
- can produce structured final output with `--output-schema`

Implication:

This is the fastest way to make Codex a participant. It is especially good for:

- one-shot tasks
- background workers
- automation
- artifact-heavy workflows

#### B. `codex app-server`

Official reference:

- [Codex app-server](https://developers.openai.com/codex/app-server)

Important capabilities:

- bidirectional JSON-RPC
- `thread/start`
- `thread/resume`
- `turn/start`
- streamed notifications such as `turn/started`
- explicit approval request flow for command execution and file changes
- per-thread or per-turn `cwd`, sandbox policy, approval policy, model, and summary settings

Implication:

This is the best native adapter surface if Codex is meant to feel like a first-class participant in the room, not just a background worker.

Recommended Codex path:

1. Start with `codex exec --json` for speed.
2. Move to `codex app-server` when thread continuity, approvals, and richer UI matter.

### OpenClaw Adapter

OpenClaw is different from `pi`, Claude Code, and Codex because it can act as either:

- a participant runtime
- or a host/gateway for other runtimes

Official references:

- [OpenClaw agent runtime](https://docs.openclaw.ai/concepts/agent)
- [OpenClaw plugin runtime helpers](https://docs.openclaw.ai/plugins/sdk-runtime)
- [OpenClaw ACP agents](https://docs.openclaw.ai/tools/acp-agents)
- [OpenClaw sub-agents](https://docs.openclaw.ai/tools/subagents)

Important capabilities:

- `api.runtime.agent` exposes workspace, identity, timeout, and session helpers
- `api.runtime.subagent` manages background subagent runs
- `api.runtime.events` exposes runtime event subscriptions
- ACP sessions let OpenClaw route work to external harnesses such as Pi, Claude Code, Codex, OpenCode, and Gemini CLI

Implication:

OpenClaw is best treated as a host/gateway later, not as the first core bus abstraction.

If integrated early, the safest posture is:

- let OpenClaw join as one participant runtime
- do not let OpenClaw define the collaboration protocol for the rest of the system

### How a Runtime Actually Joins a Room

For a runtime instance to join group chat cleanly, the adapter should provide these operations:

```ts
interface RuntimeAdapter {
  createInstance(input: {
    runtime: string
    cwd?: string
    role?: string
  }): Promise<RuntimeInstance>

  attachParticipant(instanceId: string, participantId: string): Promise<void>

  injectRoomMessage(instanceId: string, message: Message): Promise<void>

  resume(instanceId: string): Promise<void>

  interrupt(instanceId: string): Promise<void>

  streamEvents(
    instanceId: string,
    onEvent: (event: RuntimeEvent) => void
  ): Promise<void>
}
```

The key method is `injectRoomMessage()`.

This method should not always flatten everything into plain user prompt text.

Preferred mapping by runtime:

- `pi`: custom message or user message depending on semantics
- Claude Code: streaming JSON user input plus hook-injected room context
- Codex exec: plain task/input continuation
- Codex app-server: `turn/start` with typed input items
- OpenClaw: plugin/runtime event injection or ACP session steering

### macOS-Focused Recommendation

For macOS only, the cleanest phased plan is:

#### Phase 1

- `pi`: native SDK adapter
- Claude Code: process adapter with `-p` and `stream-json`
- Codex: process adapter with `exec --json`

#### Phase 2

- Codex: native app-server adapter
- Claude Code: richer hook-based context bridge

#### Phase 3

- OpenClaw: optional host/gateway integration

Why this order is good:

- all three can run locally on macOS
- no cross-platform abstraction is needed yet
- each runtime gets the simplest viable bridge first
- approvals and room semantics can be tested before deeper integrations

### Working Conclusion

The system should not start from "a group chat UI that all runtimes must somehow fit into."

It should start from:

- a bus with rooms, participants, messages, and artifacts
- a per-runtime adapter that knows how to inject room messages and extract runtime events
- a local macOS execution model that isolates write scopes per runtime instance

This keeps the collaboration layer stable while each runtime joins through its own best interface.

## One-Sentence Summary

The system should be designed as a runtime-agnostic collaboration bus for participants, not as a single-agent framework tied to one product.
