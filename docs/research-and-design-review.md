# Research and Design Review

## Purpose

This document captures the findings from a comprehensive research phase covering the competitive landscape, protocol standards, and a critical review of Rebecca's original design. It records what was learned, what design decisions were made, and the reasoning behind each change.

## 1. Competitive Landscape

### 1.1 Multi-Agent Orchestration Frameworks

All major frameworks (CrewAI, LangGraph, AutoGen/AG2, MetaGPT, OpenHands, Agno) share a common limitation: agents can only collaborate within the same framework. None supports connecting an external Claude Code session or Codex instance as a peer participant.

| Framework | Collaboration Model | Cross-Runtime | Status |
|---|---|---|---|
| CrewAI | Role-based crews | No | Popular for prototyping |
| LangGraph | Directed graph with checkpointing | No | Production-ready, v1.0 |
| AutoGen/AG2 | GroupChat with speaker selection | No | Merged into Microsoft Agent Framework |
| MetaGPT | SOP-driven software company | No | Scaffolding-oriented |
| OpenHands | Sub-agent delegation | No | 45k+ GitHub stars |
| Agno | Teams + workflows, extreme performance | No | Active development |

Key insight: AutoGen's GroupChat is the closest to Rebecca's room concept, but it is framework-bound.

### 1.2 "Team Chat + AI" Products

| Product | What It Does | Difference From Rebecca |
|---|---|---|
| Glue | Agentic team chat, $20M Series A, MCP integration | Embeds AI into chat, does not connect external runtimes |
| Continua | AI joins SMS/iMessage/Discord group chats, $8M seed | Consumer social, not developer workflows |
| Agnes AI | Multi-agent group chat, 200K+ DAU | Closed consumer platform |
| MS Teams + Copilot | Copilot agents in Teams channels | Limited to Microsoft ecosystem |

### 1.3 Multi-Agent Coding Tools

| Product | Heterogeneous Runtime Support | Notes |
|---|---|---|
| Claude Code Agent Teams | No (Claude Code only) | Validates isolated-context + communication pattern |
| Codex app-server | No (Codex only) | JSON-RPC protocol is highly adapter-friendly |
| VS Code multi-agent | Partial (Claude + Codex + Copilot side by side) | IDE-centric, manual coordination, no bus/room layer |
| Gastown (Steve Yegge) | Yes (multiple coding agents) | Closest to Rebecca, but task/state focused, not chat focused |
| GitHub Squad | Based on Copilot | Repository-native, .squad/ folder for memory |
| OpenClaw ACPX | Yes (19+ agent harnesses) | Strongest heterogeneous integration, but platform-centric |

### 1.4 Research Projects

| Project | What It Does | Relevance |
|---|---|---|
| AgentHub (Karpathy) | Git + message board for agent swarms | Most conceptually similar to Rebecca's bus idea, but agent-first, not human-in-the-loop |
| IoA (OpenBMB/Tsinghua) | Heterogeneous agent collaboration protocol | Validates the concept, but research-grade and Docker-heavy |
| MassGen | Multi-model parallel terminal agents | Multi-model but not multi-runtime |

### 1.5 Market Gap

No existing product combines all of:

1. Runtime-agnostic adapter layer
2. Multi-party rooms as first-class collaboration spaces
3. Humans and agent instances as equal participants
4. Free-form chat with minimal structure
5. Artifacts for durable results
6. Local-first execution

This is Rebecca's design space, and it is currently unoccupied.

## 2. Protocol Standards Landscape

### 2.1 The Emerging Three-Layer Stack

The industry has converged on a layered architecture:

| Layer | Standard | Owner | Status |
|---|---|---|---|
| Agent to User (frontend) | AG-UI | CopilotKit / AAIF | Emerging |
| Agent to Agent (coordination) | A2A | Google / Linux Foundation | v1.0, 150+ organizations |
| Agent to Tool (integration) | MCP | Anthropic / AAIF | 97M installs, de facto standard |

All three are governed under the Linux Foundation's Agentic AI Foundation (AAIF), co-founded by Anthropic, OpenAI, and Block.

### 2.2 A2A (Agent-to-Agent Protocol)

Core design principles:

- **Simplicity**: Reuses HTTP, JSON-RPC 2.0, SSE, Protocol Buffers
- **Opacity**: Agents are black boxes, known only by their AgentCard and observable behavior
- **Async first**: Tasks can take minutes to days, human-in-the-loop is first-class
- **Modality agnostic**: Part model supports text, files, structured data, URLs
- **Enterprise ready**: Auth, security, signing, multi-tenancy built in from the start

Key data types:

- **AgentCard**: Self-description document with skills, capabilities, security schemes, input/output modes
- **Task**: Stateful work unit with lifecycle (submitted, working, input_required, completed, failed, canceled, rejected)
- **Message**: Contains Parts (multimodal content containers), role (user/agent), references to related tasks
- **Part**: Discriminated union of text, raw bytes, URL, or structured JSON data, with MIME type
- **Artifact**: Named deliverable containing Parts, distinct from messages

Critical architectural property: **A2A is strictly bilateral** (one client, one agent). It has no concept of rooms, group membership, or broadcast.

### 2.3 MCP (Model Context Protocol)

MCP is the dominant standard for agent-to-tool integration. It defines:

- **Resources**: Read-only data entities identified by URIs
- **Tools**: Executable actions with schemas
- **Prompts**: Pre-built prompt templates
- **Sampling**: Server can request LLM completions from the host
- **Elicitation**: Server can request human input

Limitations for agent-to-agent use: no push model (pull-based only), host-centric (no peer-to-peer), no event streaming, no multi-party awareness.

### 2.4 Other Standards

- **ACP (IBM)**: Was local-first/cluster-oriented, aligned well with Rebecca's macOS-first approach. Merged into A2A in September 2025.
- **AG-UI**: Frontend protocol for agent-to-UI streaming. 17 event types covering lifecycle, messages, tool calls, state sync.
- **ACPX (OpenClaw)**: Session management for heterogeneous coding agents. Patterns (queue ownership, cooperative cancel, warm daemons) are directly relevant to Rebecca's adapter layer.
- **AGENTS.md**: Project-level instruction files for coding agents. Useful as context input, not as agent/participant definition.
- **ANP**: Decentralized agent networks with DIDs. Too heavyweight for local-first use.
- **NLIP (Ecma)**: Formal standards for agent communication. May matter in regulated industries.

### 2.5 Gap in Standards

No current standard natively supports a room/broadcast/multi-party model. All are fundamentally bilateral or point-to-point. Multi-party scenarios require application-level orchestration above the protocol layer.

This gap is exactly where Rebecca operates.

## 3. Critical Review of Original Design

### 3.1 What Was Already Well-Designed

- Clear separation of concepts (model, agent, runtime, runtime instance, participant, room, artifact)
- The principle from cc-2.1: "Do not build many agents sharing one context. Build many isolated participants connected by an independent collaboration layer."
- Adapter design with graceful degradation for runtime capability differences
- Product framing beyond just coding (implementation, review, docs, marketing, launch)
- Phased implementation plan (pi first, then Claude Code, then Codex, then OpenClaw)

### 3.2 Issues Identified

**Design-to-code ratio**: 53K+ of documentation for 63 lines of code. The conceptual framework has outrun implementation by an order of magnitude. The biggest risk is not design errors, but never validating through implementation.

**Context window management**: Not addressed in any document. When a room accumulates messages and a new agent joins, how much context does it receive? How is room history compressed for different model context window sizes?

**Feedback loop prevention**: Multiple autonomous agents in a room without turn-taking controls can trigger each other in loops. The docs reference AutoGen's experience ("group chat alone often needs extra control policies") but do not define Rebecca's approach.

**Cost management**: Running multiple agents simultaneously means multiple concurrent API calls. No mention of budget limits, token tracking, throttling, or cost-aware routing.

**Observability**: Multi-agent systems are difficult to debug. No logging, tracing, or replay architecture.

### 3.3 What These Issues Mean

These are real problems but they are implementation-phase concerns, not design-phase blockers. They should be addressed when building, not when designing the protocol.

## 4. Protocol Design Decisions

### 4.1 Overall Strategy: Thin Core + Standards at the Boundaries

Rebecca's collaboration protocol should be a custom, minimal protocol for the core (rooms, participants, messages, tasks, artifacts) while using industry standards at every external touchpoint.

| Layer | Approach |
|---|---|
| Core bus protocol (Room, Participant, Message, Task, Artifact) | Rebecca's own design |
| External agent interop | A2A adapter |
| Agent-accessible room exposure | MCP server (rooms as resources, actions as tools) |
| Frontend rendering | AG-UI (future) |
| Per-project agent context | AGENTS.md reader |
| Local process session management | Borrow ACPX patterns |

### 4.2 What to Adopt From A2A

**Adopt the Part model** (highest priority):

Replace `text: string` with `parts: Part[]`. A Part contains exactly one of: text, raw bytes, URL, or structured JSON data. This makes Rebecca modality-agnostic. A message can simultaneously contain an explanation (text), a screenshot (raw), a diff (data), and a PR link (url).

```ts
type Part = {
  text?: string
  raw?: Uint8Array
  url?: string
  data?: unknown
  mediaType?: string
  filename?: string
  metadata?: Record<string, unknown>
}
```

**Adopt Skills instead of boolean capabilities**:

Replace `capabilities: { canReceiveMessage: boolean, ... }` with a skills array. Each skill has id, name, description, tags, and input/output modes. This enables intelligent routing within rooms.

```ts
type ParticipantSkill = {
  id: string
  name: string
  description: string
  tags: string[]
  examples?: string[]
  inputModes?: string[]
  outputModes?: string[]
}
```

**Adopt Task lifecycle**:

Add a Task type with A2A-style state machine. Tasks live within rooms and track units of work through their lifecycle.

```ts
type TaskState =
  | "submitted"
  | "working"
  | "completed"
  | "failed"
  | "canceled"
  | "rejected"
  | "input_required"

type Task = {
  id: string
  roomId: string
  assigneeId?: string
  status: {
    state: TaskState
    message?: string
    timestamp: string
  }
  artifacts?: string[]
  metadata?: Record<string, unknown>
}
```

**Adopt input/output mode negotiation**:

Let participants declare MIME types they can handle. This enables the room to avoid sending images to a text-only agent.

**Adopt contextId semantics**:

Map roomId to contextId for A2A interop. Internally, support multiple parallel contexts within a room.

**Adopt the extension mechanism**:

Use URI-identified extensions with metadata fields. Keep the protocol extensible without modifying core types.

**Adopt the principle that Messages and Artifacts are distinct**:

Messages are communication. Artifacts are deliverables. A2A explicitly states: "Messages SHOULD NOT be used to deliver task outputs. Results SHOULD BE returned using Artifacts."

### 4.3 What Rebecca Has That A2A Does Not

These are Rebecca's unique contributions that should be preserved:

**Multi-party rooms**: A2A is bilateral. Rebecca's Room is a multi-party space with N participants. This is the core value proposition. No standard provides this.

**Mentions**: In a multi-party room, mentions serve as the routing and delivery mechanism. They answer the question "which agent should respond to this message?" A2A does not need mentions because it is bilateral.

**Sender identity**: A2A only knows "user" or "agent". In a room with multiple agents, `senderId` is essential for knowing who said what.

### 4.4 What to Remove or Simplify

**Remove Presence**: With Task lifecycle, Presence is redundant. Agent "busyness" is expressed through Task states. Agent "liveness" is a runtime health check, not a protocol concept. If needed, a simple `availability: "online" | "offline"` at the runtime adapter level is sufficient.

**Simplify message types**: The original design had seven message types (chat, help, decision, artifact, handoff, status, system). With Task lifecycle and first-class Artifacts, most are absorbed:

| Original Type | What Absorbs It |
|---|---|
| `chat` | Remains as default |
| `help` | Just a regular message, or a Task with state "submitted" |
| `decision` | An Artifact of kind "decision" or "note" |
| `artifact` | First-class Artifact objects, not a message type |
| `handoff` | Task completion + new Task creation |
| `status` | Task state change events |
| `system` | Remains for infrastructure notifications |

Simplified to: messages are just messages. Structural semantics flow through Tasks and Artifacts.

**Simplify human-vs-agent distinction**: `kind: "human" | "agent"` is retained as a participant attribute but does not affect protocol-level behavior. The protocol treats all participants equally.

## 5. Revised Core Types (Intermediate Version)

Note: This section records the intermediate design that adopted heavily from A2A. It was subsequently simplified further in Section 6 (Final Architecture), which is the current design direction.

Based on the decisions above, the intermediate data model:

### Participant

```ts
type Participant = {
  id: string
  kind: "human" | "agent"
  displayName: string
  description?: string
  runtime?: string
  runtimeInstanceId?: string
  workspace?: string
  role?: string
  skills?: ParticipantSkill[]
  defaultInputModes?: string[]
  defaultOutputModes?: string[]
  metadata?: Record<string, unknown>
}

type ParticipantSkill = {
  id: string
  name: string
  description: string
  tags: string[]
  examples?: string[]
  inputModes?: string[]
  outputModes?: string[]
}
```

Changes from original:
- Removed `presence` (absorbed by Task states + runtime health)
- Removed boolean `capabilities` (replaced by `skills`)
- Added `description` (from A2A AgentCard)
- Added `skills` (from A2A AgentSkill)
- Added `defaultInputModes` / `defaultOutputModes` (from A2A)

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

Unchanged. Room is the multi-party coordination primitive that sits above A2A's bilateral model.

### Message

```ts
type Message = {
  id: string
  roomId: string
  senderId: string
  role: "user" | "agent"
  parts: Part[]
  mentions?: string[]
  threadId?: string
  replyTo?: string
  referenceTaskIds?: string[]
  extensions?: string[]
  createdAt: string
  metadata?: Record<string, unknown>
}

type Part = {
  text?: string
  raw?: Uint8Array
  url?: string
  data?: unknown
  mediaType?: string
  filename?: string
  metadata?: Record<string, unknown>
}
```

Changes from original:
- Replaced `text: string` with `parts: Part[]` (from A2A)
- Added `role: "user" | "agent"` (from A2A)
- Added `referenceTaskIds` (from A2A)
- Added `extensions` (from A2A)
- Removed `type` field (semantics absorbed by Task and Artifact)

### Task

```ts
type TaskState =
  | "submitted"
  | "working"
  | "completed"
  | "failed"
  | "canceled"
  | "rejected"
  | "input_required"

type Task = {
  id: string
  roomId: string
  assigneeId?: string
  status: {
    state: TaskState
    message?: string
    timestamp: string
  }
  artifacts?: string[]
  metadata?: Record<string, unknown>
}
```

New type. Adopted from A2A's Task lifecycle model. Tasks live within rooms and provide structured state tracking for work in progress.

### Artifact

```ts
type Artifact = {
  id: string
  roomId: string
  publisherId: string
  name: string
  description?: string
  parts: Part[]
  extensions?: string[]
  createdAt: string
  metadata?: Record<string, unknown>
}
```

Changes from original:
- Replaced `kind` enum + `content`/`uri` with `parts: Part[]` (from A2A, supports multi-part artifacts)
- Renamed `title` to `name` (aligns with A2A)
- Added `description` (from A2A)
- Added `extensions` (from A2A)
- Removed `kind` enum (use mediaType on Parts instead, infinitely extensible)

## 6. Final Architecture

After multiple rounds of simplification, the architecture converged to two layers and three core types.

### Why the Earlier Design Was Not Elegant

1. **Three layers were actually two doing the same thing.** A2A Gateway and Runtime Adapters both connect external entities to the Bus. The distinction was artificial.
2. **Core types accumulated enterprise complexity from A2A.** Skills, inputModes, outputModes, extensions on Participant -- designed for enterprise agent discovery, unnecessary for a system where participants are configured, not discovered.
3. **Five core types were too many.** Task and Artifact are valuable extensions but not the essence of a "free communication space."
4. **The Bus itself was underspecified.** The most important component had the vaguest definition.

### Architecture: Two Layers

```
┌─────────────────────────────────────────────────┐
│                  Connectors                      │
│  pi │ Claude Code │ Codex │ A2A │ Human CLI │ …  │
├─────────────────────────────────────────────────┤
│                     Bus                          │
│            Room / Participant / Message           │
└─────────────────────────────────────────────────┘
```

**Bus**: Manages rooms, members, and messages. Receives messages and routes them (by mentions or broadcast). Persists messages.

**Connectors**: Bridge external entities into rooms. Translate Bus messages into runtime-specific formats (outbound). Translate runtime events into Bus messages (inbound). Each connector implements one interface regardless of the underlying protocol.

### Core Types

```ts
type Participant = {
  id: string
  name: string
  kind: "human" | "agent"
}

type Room = {
  id: string
  name: string
  members: string[]
}

type Message = {
  id: string
  roomId: string
  senderId: string
  parts: Part[]
  mentions?: string[]
  createdAt: string
}

type Part = {
  text?: string
  data?: unknown
  url?: string
  mediaType?: string
}
```

Four types. No type has more than six fields.

### Connector Interface

```ts
interface Connector {
  connect(participantId: string, roomId: string): Promise<void>
  send(message: Message): Promise<void>
  onMessage(callback: (message: Message) => void): void
}
```

All connection methods are Connectors:

- `pi` Connector: uses SDK internally
- `Claude Code` Connector: uses CLI + stream-json internally
- `Codex` Connector: uses exec --json internally
- `A2A` Connector: uses A2A protocol internally
- `Human` Connector: uses CLI stdin/stdout internally

The Bus does not care what protocol a Connector uses. It only knows: there are participants, and messages flow in and out.

### What Is Deferred

These are extensions to be added after the core is validated:

- **Task**: Work unit with lifecycle states (from A2A). Depends on Room + Message. Room does not depend on Task.
- **Artifact**: Durable result references. Can be added when the distinction between "chat" and "deliverable" becomes painful.
- **Skills on Participant**: For routing and discovery. Can be added when rooms have enough participants that manual mentions become unwieldy.
- **A2A Server identity**: Exposing Rebecca itself as an A2A-compliant agent. Can be added when external systems need to delegate to Rebecca.
- **MCP Server**: Exposing rooms as MCP resources and tools. Can be added as a convenience layer for MCP-native tools.

### Positioning

Rebecca is a multi-party coordination layer that no existing standard provides. A2A is bilateral. MCP is point-to-point. Rebecca adds the room: N participants, shared messages, directed mentions.

A2A is used as one Connector type for interoperability with the broader agent ecosystem, not as the internal protocol.

### Design Principles

1. **If you cannot remove anything, it is elegant.** Three core types. One connector interface. Two layers.
2. **Validate before extending.** Run the core (Room + Message + two Connectors) with real work before adding Task, Artifact, Skills, or protocol bridges.
3. **The Bus is the product.** Connectors are replaceable. Types can evolve. The room where humans and agents communicate freely -- that is the thing.

## 7. Connector Implementation Research

### Integration Patterns in the Ecosystem

Three dominant patterns exist for integrating with coding agent CLIs:

1. **Subprocess + NDJSON (stream-json)**: Spawn the CLI as a long-lived subprocess, bidirectional communication via NDJSON over stdin/stdout. Used by all official SDKs and most community wrappers. Most reliable and token-efficient.

2. **tmux session management**: Run agents in tmux panes, communicate via send-keys/capture-pane. Simpler but less structured. Used by claude-squad (6.8k stars), oh-my-claudecode (23k stars).

3. **MCP server wrapping**: Wrap the agent as an MCP server, outer agents call it as a tool. Used by claude-code-mcp (1.2k stars), codex-mcp.

### Reference Projects

| Project | Stars | Relevance |
|---|---|---|
| [ACPX/OpenClaw](https://github.com/openclaw/acpx) | 1.9k | Closest to Rebecca's connector design. Has harnesses for pi, Claude Code, Codex, OpenCode, Gemini CLI. Structured JSON protocol. |
| [agent-orchestrator (ComposioHQ)](https://github.com/ComposioHQ/agent-orchestrator) | 5.8k | Plugin architecture with 8 pluggable slots. Agent-agnostic. |
| [claude-squad](https://github.com/smtg-ai/claude-squad) | 6.8k | tmux + git worktree per agent. Simple and proven. |
| [Gastown](https://github.com/steveyegge/gastown) | 13.5k | Does not spawn agents directly. Prepares git-backed state, agents consume work. Loose coupling. |
| [claude_code_bridge](https://github.com/bfly123/claude_code_bridge) | 2.1k | Queue-based daemon pattern. Claims 50-200 tokens per call. |
| [go-claudecode](https://github.com/bpowers/go-claudecode) | — | Clean subprocess + NDJSON implementation. Good reference for protocol handling. |
| [ai-sdk-provider-codex-cli](https://github.com/ben-vargas/ai-sdk-provider-codex-cli) | 39 | TypeScript. Supports both codex exec and app-server modes. |

### Connector Implementation Plan

**Claude Code**: Long-lived subprocess with `claude -p --input-format stream-json --output-format stream-json --verbose`. NDJSON on stdin/stdout. Critical: each subprocess invocation burns ~50k tokens in system prompt overhead, so long-lived processes are strongly preferred over one-shot.

**Codex**: `codex exec --json --full-auto` as one-shot subprocess. Session continuity via `codex exec resume <thread_id>`. Parse JSONL event stream, extract `item.completed { type: "agent_message" }`.

**pi**: Direct SDK embedding via `createAgentSession()`. Use `session.prompt()` when idle, `session.steer()` when busy. Subscribe to events, extract text from `agent_end`.

**Human**: readline interface. Parse `@name` for mentions. Format incoming messages as `[sender]: text`.

## 8. The Reply Loop Problem

### Discovery

After implementing the v1 prototype (Human + pi + Claude Code + Codex in one Room), a four-way conversation test revealed a critical problem: agents endlessly replied to each other with "Agreed", "Confirmed", "Noted", "Ready", creating an infinite loop that only stopped when the process was killed.

### Root Cause

All room messages were injected into each agent as `role: "user"` messages. Agents treated every incoming message as something requiring a response. They could not distinguish between:

- A human asking a question (should respond)
- Another agent's response (might not need a response)
- A conversation that has concluded (definitely should not respond)

### Research: How Others Solve This

Comprehensive research across products and academic papers revealed that **no existing system supports true free multi-agent communication without structural constraints**. Every system either:

1. **Eliminates free communication**: AutoGen's GroupChatManager centrally selects who speaks. OpenAI Agents SDK allows only one active agent at a time.
2. **Isolates agents**: CrewAI agents communicate through task results, not messages. Claude Squad agents never communicate with each other.
3. **Adds hard limits**: OpenClaw's `maxPingPongTurns` (default 5). ChatDev's 10-round cap per subtask.
4. **Defers to prompts**: AgentHub (Karpathy) explicitly states the platform is "dumb" and coordination must live in agent instructions.

### Academic Findings

Key papers that informed the decision:

- **"Proactive Conversational Agents with Inner Thoughts" (CHI 2025)**: Agents generate internal thoughts but evaluate them against 8 heuristics (Relevance, Information Gap, Originality, etc.) before speaking. Thoughts only surface if they exceed a motivation threshold. Most directly relevant research to the loop problem.
- **MAST: "Why Do Multi-Agent LLM Systems Fail?" (NeurIPS 2025)**: Identified 14 failure modes. Step repetition (FM-1.3) and unawareness of termination conditions (FM-1.5) directly describe the observed behavior. 41-86.7% of multi-agent systems fail in production.
- **Google/MIT Scaling Research (2025)**: Unstructured multi-agent networks amplify errors 17.2x. Coordination gains plateau beyond 3-4 agents.
- **Self-Organizing Agents (arXiv 2026)**: Optimal coordination comes from "minimal structural scaffolding + full role autonomy." Capable models voluntarily abstain from tasks outside their competence.
- **Gricean Maxims (AAMAS 2025)**: The Maxim of Quantity ("be informative as required, but not more") and Maxim of Relation ("be relevant") directly address the "Agreed!" problem.

### Decision: @mention-Only Activation

After considering multiple approaches (system prompt guidance, hop count/TTL, central orchestrator, inner thoughts model), the decision was made to use **@mention-only activation**:

1. Agents only receive messages and respond when explicitly @mentioned
2. Agents can @mention other agents in their responses
3. Humans always see all messages
4. No @mention from an agent = conversation chain naturally ends

**Why this was chosen over alternatives:**

| Alternative | Why Not Sufficient |
|---|---|
| System prompt guidance ("only respond if you have something to add") | Unreliable. Models often ignore instructions. |
| Hop count / message depth | Artificial cutoff. Might truncate valuable conversation. |
| Central orchestrator | Removes free communication. Agents lose autonomy. |
| Inner thoughts + 8 heuristics | Complex to implement, model-dependent reliability. |
| @mention-only | Simple, deterministic, preserves agent autonomy. Agent decides WHO to involve, not WHETHER to respond. |

**Key insight**: The conversation terminates not because the system forces it, but because the agent has no one to @mention. This preserves free communication while eliminating accidental loops.

## 9. Two-Context Model

### The Architecture

The system has two isolated contexts per agent:

```
Agent's Private Context          Room (Shared Context)
┌──────────────────────┐         ┌──────────────────────┐
│ Own LLM session      │         │ Messages between     │
│ Own tool calls       │         │ participants         │
│ Own file reads/writes│         │                      │
│ Own reasoning        │         │ Only final responses │
│                      │         │ visible here         │
│ Invisible to others  │         │                      │
└──────────┬───────────┘         └──────────────────────┘
           │ only final reply
           ↓
        Room.post()
```

- **Room context**: The shared conversation history. What participants said to each other.
- **Agent context**: The private working environment. The agent's LLM session, tool usage, file reads, intermediate reasoning.
- **Isolation**: The Room only sees agents' final messages. Agents' internal work (how many files they read, what commands they ran, what they considered and rejected) stays private.

### Alignment with A2A

This two-context model maps directly to A2A's opacity principle. In A2A, agents are "opaque black boxes" known only by their AgentCard and observable behavior. The protocol has no mechanism to request or transmit agent internals. Rebecca's Connector interface enforces this same boundary: `send(message)` is input, `room.post(response)` is output, everything in between is invisible.

### Each Agent Maintains State

All agents are stateful across interactions:

- **pi**: In-memory session via `createAgentSession()`. Conversation history persists in the session.
- **Claude Code**: Long-lived subprocess maintains its own session. History accumulates in the process.
- **Codex**: Sessions persisted on disk at `~/.codex/sessions/`. Resumed via `codex exec resume <thread_id>`.

This means agents remember prior interactions within the same Room session.

## 10. Context Delivery: The "One Screen + Pull" Model

### Inspiration from Human IM Behavior

Humans in Slack/Teams do not receive all channel history pushed to them when @mentioned. Instead:

1. They receive a notification ("you were mentioned")
2. They see the triggering message + recent messages (one "screen")
3. They scroll up to read more context if needed
4. They decide how much context is relevant
5. They respond

The context is **pull-based**, not push-based. The human has agency over how much to consume.

### Applied to Agents

When an agent is @mentioned in a Room:

1. **Deliver**: The triggering message + the last N messages (a "screen" of recent context)
2. **Make available**: A tool or mechanism for the agent to read more Room history if needed
3. **Agent decides**: Whether the recent context is sufficient or whether it needs to "scroll up"

```
Delivered to Agent:

<room-context recent="true">
[msg-8] [reviewer]: Suggest migrating to httpOnly cookies
[msg-9] [lixiaobo]: What about a phased migration?
[msg-10] [researcher]: Yes, start with the login endpoint
[msg-11] [lixiaobo]: @builder implement this phased plan
</room-context>

(Use read_room_history to see earlier messages if needed)
```

### Why This Is Better Than Alternatives

| Approach | Problem |
|---|---|
| Push full history | Exceeds context window. Wastes tokens on irrelevant messages. |
| Push incremental delta | Requires tracking lastSeenMessageId per agent. Complex. |
| Trust agent memory (A2A contextId) | Agent might not remember. Different runtimes handle state differently. |
| **One screen + pull** | Simple. Efficient. Agent has agency. Matches human behavior. |

### Room Requirements

For this model, the Room needs:

1. **Message history storage**: An ordered array of messages (currently fire-and-forget, needs to be changed)
2. **History read API**: A way for agents to request earlier messages (could be a tool exposed to the agent's runtime)
3. **Configurable window size**: How many recent messages constitute "one screen" (default: maybe 20)

### Context Compression for Long Rooms

When Room history grows very long, older messages can be compressed using a "handoff memo" pattern (borrowed from the nodex/soma project):

1. Detect when history exceeds a threshold
2. Generate a summary of older messages (the "handoff memo")
3. Store the summary as a bridge point
4. When an agent requests old history, return: summary + messages after the summary point

This is deferred to when Room conversations actually become long enough to need it.

## 11. Task Model

### Why Tasks Are Core

Agents often do long-running work. When someone says "@builder implement the phased migration," this is not a quick chat response. It might take minutes. During that time, the Room and other participants need to know:

- **submitted**: The request was received
- **working**: The agent is actively working on it
- **input_required**: The agent needs clarification or approval
- **completed**: The work is done, results are available
- **failed**: Something went wrong

Without Task, the Room has no way to represent "work in progress." Every interaction looks like a chat message, even when it is a multi-minute operation.

### Task States (from A2A)

```
submitted → working → completed
                   → failed
                   → canceled
                   → rejected
            working → input_required → working (after input received)
```

### How Tasks Relate to Messages

- A @mention can create a Task (if the work is non-trivial)
- Task state changes are visible in the Room
- Task completion may produce Artifacts (durable results: files, commits, PRs)
- Simple responses remain Messages (no Task needed)

Tasks are an extension of the core Room/Message model, not a replacement. They will be implemented after the @mention and context delivery patterns are validated.

## 12. Room Is Part of the Agent's Environment

### The Shift

An earlier version of the architecture placed the Room "above" agents as a coordination layer that pushes messages down and collects responses. This was wrong.

The correct framing: **Room is part of each agent's working environment**, the same way Slack is part of a human engineer's working environment.

A human engineer's working environment:

```
IDE         — write code
Terminal    — run commands
Browser     — read docs
Slack       — communicate with the team
```

Slack does not "control" the engineer. It is one of the tools available in the working environment. The engineer works autonomously. Slack is where they communicate with others. An @mention is a notification. The engineer decides when to look, how much to read, and how to respond.

An agent's working environment:

```
LLM session — reasoning
bash        — execute commands
read/write  — file operations
Room        — communicate with the team
```

Room does not "control" the agent. It is one of the tools available in the working environment. The agent works autonomously. Room is where it communicates with other participants.

### What This Means

```
Before: Room → pushes message → Connector → injects into Agent (Room drives)
After:  Agent → uses Room tool (Agent drives)

Before: Room decides when to send messages to the Agent
After:  Agent decides when to read Room, when to write to Room
        @mention is just a notification signal
```

Room is a shared resource that each agent can access, like a shared file system or a database. The agent's interaction with Room is:

```
read_room()           — read recent messages (like opening Slack)
read_room_history()   — scroll up to see older messages
post_to_room()        — send a message to the Room
```

These are capabilities available within the agent's working environment, not external control signals.

@mention acts as a notification/interrupt: "someone in the Room is asking for you." Like a phone notification from Slack. The agent can respond immediately, or finish what it is doing first.

### Connector as Environment Adapter

The Connector's role in this model: make Room accessible within each runtime's specific environment.

- **pi**: Room exposed as custom tools in the agent session
- **Claude Code**: Room exposed as MCP tools or injected via the communication protocol
- **Codex**: Room context provided as part of the execution prompt
- **Human**: Room rendered as a terminal chat interface

The Connector does not "bridge Room and Agent." It **makes Room a natural part of the agent's toolset**.

## 13. Current Architecture

```
Agent A's working environment:
┌────────────────────────────────────┐
│  LLM session + bash + read/write  │
│  + Room (read, write, notify)     │───┐
│  Private. Opaque to others.       │   │
└────────────────────────────────────┘   │
                                         │ post / read
Agent B's working environment:           │
┌────────────────────────────────────┐   │
│  LLM session + bash + read/write  │   │
│  + Room (read, write, notify)     │───┤
│  Private. Opaque to others.       │   │
└────────────────────────────────────┘   │     ┌─────────────────┐
                                         ├────▶│      Room       │
Human's environment:                     │     │                 │
┌────────────────────────────────────┐   │     │ Message history │
│  Terminal                         │   │     │ Tasks           │
│  + Room (read, write)             │───┘     │ Participants    │
│                                   │         │                 │
└────────────────────────────────────┘         └─────────────────┘
```

Core types:
- **Participant**: `{ id, name, kind }`
- **Message**: `{ id, senderId, parts, mentions?, createdAt }`
- **Part**: `{ text?, data?, url?, mediaType? }`
- **Task**: `{ id, assigneeId, state, ... }`

Routing:
- Human messages without @mention: announcement, no agent responds
- Human messages with @mention: only mentioned agents are notified
- Agent messages: @mentioned agents are notified, humans always see all messages

Context:
- @mentioned agent sees: last N messages (one screen) + triggering message
- Agent can pull more history from Room if needed
- Agent's internal work stays in its private environment
- Only final response enters Room

## 14. Lightweight vs Heavy Invocations (from /btw)

### The Insight

Claude Code's `/btw` (by the way) feature lets users ask a quick side question without interrupting the main agent. Implementation details:

- Spawns a forked agent that shares the parent's prompt cache (byte-identical for cache hit)
- Tools are explicitly denied (`canUseTool: 'deny'`)
- Single turn (`maxTurns: 1`)
- Fire-and-forget (no cache write)
- The main agent continues working in parallel

The result: a fast, focused answer that doesn't waste tokens on tool setup or extended reasoning.

### Why This Matters for Rebecca

In Rebecca's current model, every @mention triggers a full agent invocation. Claude Code takes 5-30+ seconds even for a trivial question because it spins up a full session, processes the system prompt, and loads tools. Most quick questions don't need this.

`/btw` validates a key principle: **multi-agent systems benefit from differentiating invocation weight**. Not every interaction is a full task.

### Design Decision: Quick vs Full Mentions

Rebecca adopts the `?` suffix on @mentions to signal quick mode:

- `@agent` → full invocation, tools allowed, may create tasks
- `@agent?` → quick query, no tools, single turn, answer from context

The constraint must be enforced at the **connector level** (not just system prompt), because models are unreliable about following "be quick" instructions:

- Claude Code: pass `--max-turns 1` and restrict allowed tools
- Codex: similar restrictions via flags
- Pi (when implemented): set `maxTurns` and disable tools in session config

This is deferred until after Phase 5 (Codex support). It's a refinement, not a blocker.

### Other Patterns Worth Borrowing

- **Cache sharing**: When the same agent is mentioned multiple times in a Room, the long-lived process already shares its prompt cache naturally. We get this for free.
- **State isolation**: /btw clones state to prevent concurrent mutations. Rebecca's two-context model already enforces this.
- **Strict capability constraints over prompt instructions**: Don't trust the model to follow "be quick" — enforce in the framework.

### What We Are NOT Borrowing

- The forked agent infrastructure with byte-identical CacheSafeParams. /btw uses this because it's all in one process. Rebecca's agents are separate processes already.
- The modal UI. Rebecca's responses go into the Room as messages, not as UI overlays.

## 15. Design Principles (Evolved)

1. **Room is part of the agent's environment, not above it.** Like Slack for a human engineer. The agent works autonomously. Room is where it communicates, not what controls it.
2. **Two contexts, always isolated.** Room is shared communication. Agent internals are private. Only final responses cross the boundary.
3. **@mention is a notification, not a command.** It tells the agent "someone is asking for you." The agent decides when and how to respond. Conversation ends naturally when no one is mentioned.
4. **One screen of context, pull for more.** Like humans scrolling Slack. Don't push everything, don't assume the agent remembers. Show recent context, let the agent decide if it needs more.
5. **Tasks are core.** Agent work is often long-running. The Room needs to represent work-in-progress, not just chat messages.
6. **Invocation has weight.** Not every @mention is a full task. Quick questions (`@agent?`) get fast, constrained responses. Full mentions (`@agent`) get the full agent. Enforced at the connector level, not via prompt.
7. **Aligned with A2A.** Opacity, Message/Artifact distinction, Task lifecycle. A2A is the bilateral wire protocol; Rebecca adds the multi-party room on top.
8. **Simplicity.** Three core types. One routing rule. If you cannot remove anything, it is elegant.

## 16. Sources

### Reply Loop and Communication Control

- [Proactive Conversational Agents with Inner Thoughts (CHI 2025)](https://arxiv.org/abs/2501.00383)
- [MAST: Why Do Multi-Agent LLM Systems Fail? (NeurIPS 2025)](https://arxiv.org/abs/2503.13657)
- [Towards a Science of Scaling Agent Systems (Google/MIT 2025)](https://arxiv.org/abs/2512.08296)
- [Self-Organizing LLM Agents Outperform Designed Structures (arXiv 2026)](https://arxiv.org/abs/2603.28990)
- [Gricean Norms as a Basis for Effective Collaboration (AAMAS 2025)](https://arxiv.org/abs/2503.14484)
- [CAMEL: Communicative Agents for Mind Exploration (NeurIPS 2023)](https://arxiv.org/abs/2303.17760)
- [Optima: Optimizing Effectiveness and Efficiency for LLM-Based MAS (ACL 2025)](https://arxiv.org/abs/2410.08115)
- [Cut the Crap: An Economical Communication Pipeline for LLM-based MAS (ICLR 2025)](https://arxiv.org/abs/2410.02506)
- [Multi-Agent Debate with Adaptive Stability Detection](https://arxiv.org/abs/2510.12697)
- [iMAD: Intelligent Multi-Agent Debate (92% token savings)](https://arxiv.org/abs/2511.11306)
- [The Multi-Agent Trap (Towards Data Science)](https://towardsdatascience.com/the-multi-agent-trap/)
- [Infinite Agent Loop Patterns (AgentPatterns.tech)](https://www.agentpatterns.tech/en/failures/infinite-loop)

### Protocol Specifications

- [A2A Protocol v1.0](https://a2a-protocol.org/latest/)
- [MCP Specification](https://modelcontextprotocol.io/specification/2025-11-25)
- [AG-UI Documentation](https://docs.ag-ui.com/)
- [ACPX Repository](https://github.com/openclaw/acpx)
- [AGENTS.md](https://agents.md/)

### Industry Analysis

- [AI Agent Protocol Ecosystem Map 2026](https://www.digitalapplied.com/blog/ai-agent-protocol-ecosystem-map-2026-mcp-a2a-acp-ucp)
- [A2A + ACP Merger](https://lfaidata.foundation/communityblog/2025/08/29/acp-joins-forces-with-a2a-under-the-linux-foundations-lf-ai-data/)
- [AAIF Formation](https://www.linuxfoundation.org/press/linux-foundation-announces-the-formation-of-the-agentic-ai-foundation)
- [Coordinating Multiple AI Coding Agents](https://mikemason.ca/writing/ai-coding-agents-jan-2026/)

### Competitive Products

- [Glue Agentic Team Chat](https://www.businesswire.com/news/home/20251008293325/en/Glue-Raises-$20M-for-Agentic-Team-Chat)
- [VS Code Multi-Agent Development](https://code.visualstudio.com/blogs/2026/02/05/multi-agent-development)
- [Claude Code Agent Teams](https://code.claude.com/docs/en/agent-teams)
- [Codex App Server](https://developers.openai.com/codex/app-server)
- [AgentHub (Karpathy)](https://github.com/ygivenx/agenthub)
- [Gastown](https://github.com/steveyegge/gastown)
- [OpenClaw ACPX](https://github.com/openclaw/acpx)
