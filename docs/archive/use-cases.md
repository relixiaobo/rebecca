# Use Cases

## Purpose

This document captures realistic scenarios the system is intended to support.

The goal is to keep the architecture grounded in actual user workflows rather than abstract multi-agent theory.

## Core Positioning

This system is not only for "multiple coding agents".

It is for workflows where:

- multiple participants need to collaborate
- participants may be humans or agent instances
- participants may come from different runtimes
- important results need to be shared without merging all contexts together

## Use Case 1: Build and Launch a Product Feature

This is a core scenario.

A team is shipping a new product capability. The work includes:

- implementation
- review
- docs
- release notes
- landing page copy
- marketing communication

Possible room:

- `product-x-launch`

Possible participants:

- `human/founder`
- `pi/product-x/implementer`
- `claude-code/product-x/reviewer`
- `pi/product-x/docs-writer`
- `pi/product-x/marketing-writer`
- `codex/product-x/landing-page-worker`

How the system helps:

- implementation progress is visible in the room
- reviewers can point out risk in the same room
- docs and marketing participants can consume artifacts rather than read the whole repo
- the human can redirect priorities or messaging in one place
- feature summaries, known limitations, and release notes can be published as artifacts

Why this matters:

Without a shared collaboration layer, the human becomes the message relay between coding tools, docs tools, and marketing drafts.

## Use Case 2: Cross-Project Dependency Coordination

Project B depends on a module or API from Project A.

Possible participants:

- `claude-code/project-a/main`
- `codex/project-b/implementer`
- `human/lixiaobo`

Possible room:

- `auth-integration`

How the system helps:

- Project B can ask Project A directly for interface or behavior clarification
- Project A can publish a summary or file artifact
- the human does not need to manually shuttle context between tools

Why this matters:

Cross-project communication is one of the biggest pain points when using separate agent runtimes.

## Use Case 3: Multi-Role Work Inside One Codebase

One repository may need different roles at the same time:

- researcher
- implementer
- reviewer

Possible participants:

- `pi/project-a/researcher`
- `pi/project-a/implementer`
- `claude-code/project-a/reviewer`

Possible room:

- `project-a`

How the system helps:

- research findings can be shared without copying raw exploration context into every session
- implementation can proceed in parallel
- review can happen as a first-class participant rather than as an afterthought

Why this matters:

It reduces the need for the human to manually coordinate between separate terminals and prompts.

## Use Case 4: Human-in-the-Loop Team Collaboration

The human wants to remain actively involved, not just delegate and wait.

Possible room:

- any project or launch room

How the system helps:

- the human can steer multiple participants from one space
- constraints can be stated once for everyone relevant
- questions, corrections, and decisions are visible to the right participants

Why this matters:

This avoids rigid ticket-only systems and preserves the flexibility of team chat.

## Use Case 5: Local Multi-Instance Development Without Chaos

A user wants several local agent instances working in parallel on macOS.

Possible participants:

- `claude-code/project-a/reviewer`
- `claude-code/project-a/implementer`
- `pi/project-a/researcher`

How the system helps:

- collaboration is centralized in the room
- side effects are isolated per runtime instance
- worktrees, `cwd`, and writable scope can be tracked explicitly

Why this matters:

Without isolation rules, local multi-instance work quickly turns into file, git, and process conflicts.

## Use Case 6: First-Party and Third-Party Agents in One System

The system owner wants to define custom agents on top of `pi`, while also letting external runtimes join.

Possible participants:

- `pi/product-a/researcher`
- `pi/product-a/reviewer`
- `claude-code/product-a/main`
- `codex/product-a/worker`

How the system helps:

- first-party agent definitions can live on `pi`
- third-party runtimes can join through adapters
- the room does not care which runtime each participant comes from

Why this matters:

It avoids locking the system to one runtime while still allowing deep native control where available.

## Common Thread Across All Use Cases

Across all scenarios, the system is solving the same underlying problem:

- participants need to collaborate
- participants should keep private working context
- collaboration should happen through shared messages, artifacts, and presence
- runtime differences should be hidden behind adapters

## One-Sentence Summary

This system is designed for product and engineering workflows where multiple humans and agent instances need to collaborate across projects, roles, and runtimes without collapsing everything into one shared context.
