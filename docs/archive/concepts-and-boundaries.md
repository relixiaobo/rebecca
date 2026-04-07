# Concepts and Boundaries

## Purpose

This document defines the core concepts used in the collaboration architecture and clarifies how they differ.

The main goal is to prevent common category mistakes, especially between:

- `model`
- `agent`
- `runtime`
- `runtime instance`
- `participant`

## The Short Version

- `model`: the underlying intelligence
- `agent`: a role-shaped use of that intelligence
- `runtime`: the execution system that runs the agent
- `runtime instance`: one concrete running or resumable runtime session
- `participant`: the identity of a member inside the collaboration system
- `room`: a collaboration space
- `artifact`: a published result reference

## Model

A model is the underlying foundation model.

Examples:

- Claude Sonnet
- GPT-5
- Gemini

A model answers:

- how capable the intelligence is
- how good the reasoning is
- what multimodal abilities exist

A model does **not** answer:

- how sessions are stored
- how prompts are injected
- how tools are run
- how approvals work
- how the participant joins a room

## Agent

An agent is a role-shaped intelligence built on top of a model.

Examples:

- reviewer
- implementer
- architect
- researcher

An agent is usually defined by:

- system prompt
- allowed tools
- role or purpose
- behavioral constraints

An agent answers:

- what kind of work it is trying to do
- how it should behave
- what boundaries it should follow

An agent does **not** answer:

- how the session is resumed
- how the shell runs
- what the working directory is
- how events are streamed

## Runtime

A runtime is the execution system that hosts and operates an agent.

Examples:

- `pi`
- `Claude Code`
- `Codex`
- `OpenClaw`

A runtime answers:

- how a session starts
- how input is injected
- how output is streamed
- how tools are executed
- how approvals and permissions work
- how sessions are resumed
- how working directories are handled
- how hooks, plugins, or extensions are loaded

This is the most important distinction:

- `agent` answers what it does
- `runtime` answers how it runs

Important clarification:

- `Claude Code` is not one agent
- `Codex` is not one agent
- `pi` is not one agent

Each of them is a runtime type that can host multiple concrete instances at the same time.

### First-Party and Third-Party Runtimes

In this project, `pi` should be treated differently from external runtimes.

Why:

- `pi` is the runtime framework we already control directly
- custom agents can be defined and hosted on top of `pi`
- this makes `pi` the natural first-party runtime family

Examples of first-party agents:

- a `researcher` agent running on `pi`
- a `reviewer` agent running on `pi`
- an `implementer` agent running on `pi`

By contrast, external runtimes such as:

- `Claude Code`
- `Codex`
- `OpenClaw`

should initially be treated as third-party runtimes integrated through adapters.

This leads to a useful architectural split:

- first-party agents on `pi`
- third-party participants through adapter boundaries

## Runtime Instance

A runtime instance is one concrete running or resumable execution instance inside a runtime.

Examples:

- one `Claude Code` session bound to `/repo-a`
- one `Codex` thread running in a specific worktree
- one in-memory `pi` session created by the SDK
- another `Claude Code` session bound to `/repo-b`
- another `pi` session with a different role and system prompt

A runtime instance may carry:

- `cwd`
- `sessionId`
- `threadId`
- writable scope
- isolation mode
- current state

Typical states:

- starting
- idle
- busy
- awaiting approval
- stopped
- error

Important distinction:

- `runtime` is a type
- `runtime instance` is one concrete session of that type

## Participant

A participant is the collaboration identity of a member in the shared system.

A participant can be:

- a human
- one `pi` instance
- one `Claude Code` instance
- one `Codex` instance

Examples:

- `human/lixiaobo`
- `pi/project-a/worker-1`
- `claude-code/project-b/reviewer`
- `codex/project-c/impl-1`

A participant answers:

- who is participating
- who can be mentioned
- who can send and receive room messages
- who published an artifact

A participant does **not** need to own all runtime details directly.

Important distinction:

- `runtime` answers how it runs
- `participant` answers who it is in the collaboration system

## Room

A room is a collaboration space.

Examples:

- `project-a`
- `project-b`
- `auth-integration`
- `release-war-room`

A room answers:

- where collaboration happens
- who the members are
- which messages belong together

A room is not:

- a runtime
- a session
- a task list

One room can have many participants.  
One participant can join many rooms.

## Artifact

An artifact is a published result reference.

It is not just a chat message. It is an explicit record that some meaningful result exists.

Examples:

- a file path
- a commit hash
- a PR link
- a short summary
- a patch
- a decision note

Why artifacts exist:

- chat is good for discussion
- artifacts are better for durable results

Without artifacts, important outputs get buried in room history.

## Human-Friendly Comparison

Think of the system like this:

- `model` = the brain
- `agent` = the job or role
- `runtime` = the office system the person works inside
- `runtime instance` = the person’s actual current workspace/session
- `participant` = the person’s identity in the team chat
- `room` = the shared chat room
- `artifact` = the result they publish back to the team

## Example: Claude Code Reviewer

Example stack:

- model: Claude Sonnet
- agent: reviewer
- runtime: `Claude Code`
- runtime instance: one specific Claude Code session using one `cwd`
- participant: `claude-code/project-a/reviewer`
- room: `project-a`

This is why the same runtime can appear multiple times in one room.

Example:

- `claude-code/project-a/reviewer`
- `claude-code/project-a/implementer`

These are different participants because they map to different runtime instances, even though both use the same runtime.

The same is true for:

- multiple `pi` participants
- multiple `Codex` participants
- multiple `Claude Code` participants

## Why This Separation Matters

If these concepts are mixed together, the architecture gets messy very quickly.

Typical failure modes:

- treating `Claude Code` as if it were a participant instead of a runtime
- treating a role like `reviewer` as if it were a runtime
- storing `cwd` on the room instead of the runtime instance
- assuming one runtime can only appear once in the collaboration system
- treating `pi` as a single agent instead of as a runtime family for self-defined agents

Keeping the boundaries clear makes the architecture much easier to extend.

## Design Rule

When unsure whether something belongs to runtime or participant, ask:

Does this describe how the agent is executed and controlled?

If yes, it probably belongs to the runtime or runtime instance.

Does this describe who is present in the shared collaboration space?

If yes, it probably belongs to the participant.

## Recommended Mental Model

Use this as the default:

- `model`: what intelligence it uses
- `agent`: what role it plays
- `runtime`: what execution system runs it
- `runtime instance`: which concrete session is active
- `participant`: who it is in the collaboration system
- `room`: where collaboration happens
- `artifact`: what result got published

## One-Sentence Summary

The collaboration system should be built around participants and rooms, while runtimes and runtime instances stay behind adapters as execution details.
