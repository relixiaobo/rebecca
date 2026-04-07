import { Hono } from "hono";
import { eq, desc, lt, and } from "drizzle-orm";
import type { Db } from "../db/index.js";
import { schema } from "../db/index.js";
import type { WebSocketBroadcaster } from "./ws.js";
import Database from "better-sqlite3";
import { AgentManager } from "../agents/manager.js";

type SqliteInstance = InstanceType<typeof Database>;

export function createRoutes(
  db: Db,
  sqlite: SqliteInstance,
  broadcast: WebSocketBroadcaster,
  serverUrl: string,
) {
  // ─── Agent Manager ──────────────────────────────────────

  const setStatus = (
    participantId: string,
    status: string,
    message?: string,
  ) => {
    db.update(schema.participants)
      .set({ status: status as any, statusMessage: message ?? null })
      .where(eq(schema.participants.id, participantId))
      .run();

    const participant = db
      .select()
      .from(schema.participants)
      .where(eq(schema.participants.id, participantId))
      .get();
    if (!participant) return;

    // Find rooms this participant is in and broadcast status
    const memberships = db
      .select()
      .from(schema.roomMembers)
      .where(eq(schema.roomMembers.participantId, participantId))
      .all();
    for (const m of memberships) {
      broadcast(m.roomId, {
        type: "status_change",
        roomId: m.roomId,
        participantId,
        status,
        message,
      });
    }
  };

  // Internal post: used by both HTTP route and AgentManager
  async function postMessageInternal(
    roomId: string,
    senderId: string,
    text: string,
    mentions?: string[],
  ): Promise<void> {
    const msgId = crypto.randomUUID();
    const content = JSON.stringify([{ text }]);
    const mentionsJson = mentions?.length ? JSON.stringify(mentions) : null;

    const message = {
      id: msgId,
      roomId,
      senderId,
      content,
      mentions: mentionsJson,
      createdAt: new Date().toISOString(),
    };

    db.insert(schema.messages).values(message).run();

    const parsed = {
      id: message.id,
      roomId,
      senderId,
      content: [{ text }],
      mentions: mentions ?? null,
      createdAt: message.createdAt,
    };

    broadcast(roomId, { type: "message", roomId, message: parsed });

    if (mentions?.length) {
      for (const mentionedId of mentions) {
        broadcast(roomId, {
          type: "mention",
          roomId,
          messageId: msgId,
          senderId,
          mentionedId,
        });
        // Notify agent manager
        agentManager.handleMention(roomId, mentionedId, msgId).catch((err) => {
          console.error("[routes] handleMention failed:", err);
        });
      }
    }
  }

  const agentManager = new AgentManager(
    db,
    postMessageInternal,
    setStatus,
    broadcast,
    serverUrl,
  );

  const app = new Hono();

  // ─── Helpers ────────────────────────────────────────────

  function transaction<T>(fn: () => T): T {
    return sqlite.transaction(fn)();
  }

  function clampInt(value: string | undefined, min: number, max: number, fallback: number): number {
    const n = parseInt(value ?? "", 10);
    if (isNaN(n)) return fallback;
    return Math.max(min, Math.min(max, n));
  }

  const VALID_TASK_STATES = new Set([
    "submitted", "working", "input_required", "completed", "failed", "canceled",
  ]);

  const VALID_KINDS = new Set(["human", "agent"]);

  // ─── Rooms ──────────────────────────────────────────────

  app.post("/rooms", async (c) => {
    const body = await c.req.json().catch(() => null);
    if (!body || !body.name) {
      return c.json({ error: "Missing required field: name" }, 400);
    }
    const roomId = body.id ?? crypto.randomUUID();
    try {
      db.insert(schema.rooms)
        .values({ id: roomId, name: body.name })
        .run();
    } catch (err: any) {
      if (err.message?.includes("UNIQUE constraint")) {
        return c.json({ error: "Room already exists" }, 409);
      }
      throw err;
    }
    return c.json({ id: roomId, name: body.name }, 201);
  });

  app.get("/rooms", (c) => {
    const rows = db.select().from(schema.rooms).all();
    return c.json(rows);
  });

  app.get("/rooms/:id", (c) => {
    const room = db
      .select()
      .from(schema.rooms)
      .where(eq(schema.rooms.id, c.req.param("id")))
      .get();
    if (!room) return c.json({ error: "Room not found" }, 404);

    const members = db
      .select()
      .from(schema.roomMembers)
      .innerJoin(
        schema.participants,
        eq(schema.roomMembers.participantId, schema.participants.id),
      )
      .where(eq(schema.roomMembers.roomId, room.id))
      .all();

    return c.json({
      ...room,
      participants: members.map((m) => m.participants),
    });
  });

  // ─── Participants ───────────────────────────────────────

  app.post("/rooms/:id/join", async (c) => {
    const roomId = c.req.param("id");
    const body = await c.req.json().catch(() => null);
    if (!body?.id || !body?.name) {
      return c.json({ error: "Missing required fields: id, name" }, 400);
    }
    const kind = VALID_KINDS.has(body.kind) ? body.kind : "agent";

    // Verify room exists
    const room = db.select().from(schema.rooms).where(eq(schema.rooms.id, roomId)).get();
    if (!room) return c.json({ error: "Room not found" }, 404);

    transaction(() => {
      db.insert(schema.participants)
        .values({ id: body.id, name: body.name, kind, status: "online" })
        .onConflictDoUpdate({
          target: schema.participants.id,
          set: { name: body.name, status: "online" },
        })
        .run();

      db.insert(schema.roomMembers)
        .values({ roomId, participantId: body.id })
        .onConflictDoNothing()
        .run();
    });

    broadcast(roomId, {
      type: "participant_joined",
      roomId,
      participant: { id: body.id, name: body.name, kind },
    });

    return c.json({ ok: true });
  });

  app.post("/rooms/:id/leave", async (c) => {
    const roomId = c.req.param("id");
    const body = await c.req.json().catch(() => null);
    if (!body?.id) {
      return c.json({ error: "Missing required field: id" }, 400);
    }

    transaction(() => {
      db.delete(schema.roomMembers)
        .where(
          and(
            eq(schema.roomMembers.roomId, roomId),
            eq(schema.roomMembers.participantId, body.id),
          ),
        )
        .run();

      // Only mark offline if participant is not in any other room
      const otherMemberships = db
        .select()
        .from(schema.roomMembers)
        .where(eq(schema.roomMembers.participantId, body.id))
        .all();

      if (otherMemberships.length === 0) {
        db.update(schema.participants)
          .set({ status: "offline" })
          .where(eq(schema.participants.id, body.id))
          .run();
      }
    });

    broadcast(roomId, {
      type: "participant_left",
      roomId,
      participantId: body.id,
    });

    return c.json({ ok: true });
  });

  app.get("/rooms/:id/participants", (c) => {
    const roomId = c.req.param("id");
    const members = db
      .select()
      .from(schema.roomMembers)
      .innerJoin(
        schema.participants,
        eq(schema.roomMembers.participantId, schema.participants.id),
      )
      .where(eq(schema.roomMembers.roomId, roomId))
      .all();

    return c.json(members.map((m) => m.participants));
  });

  // ─── Messages ───────────────────────────────────────────

  app.post("/rooms/:id/messages", async (c) => {
    const roomId = c.req.param("id");
    const body = await c.req.json().catch(() => null);
    if (!body?.senderId) {
      return c.json({ error: "Missing required field: senderId" }, 400);
    }
    if (!body.text && !body.content) {
      return c.json({ error: "Missing required field: text or content" }, 400);
    }

    const text =
      body.text ??
      (Array.isArray(body.content)
        ? body.content
            .map((p: any) => p.text ?? "")
            .filter(Boolean)
            .join("\n")
        : "");

    try {
      await postMessageInternal(roomId, body.senderId, text, body.mentions);
    } catch (err: any) {
      if (err.message?.includes("FOREIGN KEY")) {
        return c.json({ error: "Room or participant not found" }, 404);
      }
      throw err;
    }

    return c.json({ ok: true }, 201);
  });

  app.get("/rooms/:id/messages", (c) => {
    const roomId = c.req.param("id");
    const limit = clampInt(c.req.query("limit"), 1, 200, 20);
    const before = c.req.query("before");

    const rows = db
      .select()
      .from(schema.messages)
      .where(
        before
          ? and(
              eq(schema.messages.roomId, roomId),
              lt(schema.messages.createdAt, before),
            )
          : eq(schema.messages.roomId, roomId),
      )
      .orderBy(desc(schema.messages.createdAt))
      .limit(limit)
      .all()
      .reverse();

    return c.json(
      rows.map((r) => ({
        id: r.id,
        roomId: r.roomId,
        senderId: r.senderId,
        content: safeParse(r.content, []),
        mentions: r.mentions ? safeParse(r.mentions, null) : null,
        createdAt: r.createdAt,
      })),
    );
  });

  // ─── Tasks ──────────────────────────────────────────────

  app.post("/rooms/:id/tasks", async (c) => {
    const roomId = c.req.param("id");
    const body = await c.req.json().catch(() => null);
    if (!body?.description) {
      return c.json({ error: "Missing required field: description" }, 400);
    }

    const taskId = body.id ?? crypto.randomUUID();
    const now = new Date().toISOString();

    const task = {
      id: taskId,
      roomId,
      assigneeId: body.assigneeId ?? null,
      description: body.description,
      state: "submitted" as const,
      createdAt: now,
      updatedAt: now,
    };

    db.insert(schema.tasks).values(task).run();
    broadcast(roomId, { type: "task_created", roomId, task });
    return c.json(task, 201);
  });

  app.patch("/tasks/:id", async (c) => {
    const taskId = c.req.param("id");
    const body = await c.req.json().catch(() => null);
    if (!body) {
      return c.json({ error: "Invalid request body" }, 400);
    }

    // Whitelist patchable fields
    const update: Record<string, unknown> = {};
    if (body.state) {
      if (!VALID_TASK_STATES.has(body.state)) {
        return c.json({ error: `Invalid state: ${body.state}` }, 400);
      }
      update.state = body.state;
    }
    if (body.assigneeId !== undefined) update.assigneeId = body.assigneeId;
    if (body.description !== undefined) update.description = body.description;

    if (Object.keys(update).length === 0) {
      return c.json({ error: "No valid fields to update" }, 400);
    }
    update.updatedAt = new Date().toISOString();

    const existing = db.select().from(schema.tasks).where(eq(schema.tasks.id, taskId)).get();
    if (!existing) {
      return c.json({ error: "Task not found" }, 404);
    }

    db.update(schema.tasks)
      .set(update)
      .where(eq(schema.tasks.id, taskId))
      .run();

    const task = db.select().from(schema.tasks).where(eq(schema.tasks.id, taskId)).get();
    broadcast(existing.roomId, { type: "task_update", roomId: existing.roomId, task });
    return c.json(task);
  });

  app.get("/rooms/:id/tasks", (c) => {
    const roomId = c.req.param("id");
    const rows = db
      .select()
      .from(schema.tasks)
      .where(eq(schema.tasks.roomId, roomId))
      .all();
    return c.json(rows);
  });

  // ─── Agents ─────────────────────────────────────────────

  app.post("/rooms/:id/agents", async (c) => {
    const roomId = c.req.param("id");
    const body = await c.req.json().catch(() => null);
    if (!body?.name || !body?.type || !body?.runCommand) {
      return c.json(
        { error: "Missing required fields: name, type, runCommand" },
        400,
      );
    }

    const room = db
      .select()
      .from(schema.rooms)
      .where(eq(schema.rooms.id, roomId))
      .get();
    if (!room) return c.json({ error: "Room not found" }, 404);

    const participantId = body.id ?? `agent/${body.name}`;

    try {
      transaction(() => {
        // Upsert participant
        db.insert(schema.participants)
          .values({
            id: participantId,
            name: body.name,
            kind: "agent",
            status: "offline",
          })
          .onConflictDoUpdate({
            target: schema.participants.id,
            set: { name: body.name, kind: "agent" },
          })
          .run();

        // Add to room
        db.insert(schema.roomMembers)
          .values({ roomId, participantId })
          .onConflictDoNothing()
          .run();

        // Save agent config (replace if exists)
        db.delete(schema.agentConfigs)
          .where(eq(schema.agentConfigs.participantId, participantId))
          .run();

        db.insert(schema.agentConfigs)
          .values({
            participantId,
            roomId,
            type: body.type,
            runCommand: body.runCommand,
            cwd: body.cwd ?? null,
            env: body.env ? JSON.stringify(body.env) : null,
            autoStart: body.autoStart === false ? 0 : 1,
          })
          .run();
      });
    } catch (err: any) {
      return c.json({ error: err.message }, 500);
    }

    return c.json({ id: participantId, name: body.name, type: body.type }, 201);
  });

  app.delete("/rooms/:id/agents/:name", async (c) => {
    const roomId = c.req.param("id");
    const name = c.req.param("name");
    const participantId = `agent/${name}`;

    await agentManager.stopAgent(participantId).catch(() => {});

    transaction(() => {
      db.delete(schema.agentConfigs)
        .where(eq(schema.agentConfigs.participantId, participantId))
        .run();
      db.delete(schema.roomMembers)
        .where(
          and(
            eq(schema.roomMembers.roomId, roomId),
            eq(schema.roomMembers.participantId, participantId),
          ),
        )
        .run();
    });

    return c.json({ ok: true });
  });

  app.get("/rooms/:id/agents", (c) => {
    const roomId = c.req.param("id");
    const configs = db
      .select()
      .from(schema.agentConfigs)
      .where(eq(schema.agentConfigs.roomId, roomId))
      .all();
    return c.json(configs);
  });

  app.post("/rooms/:id/start", async (c) => {
    const roomId = c.req.param("id");
    await agentManager.startRoom(roomId);
    return c.json({ ok: true });
  });

  app.post("/rooms/:id/stop", async (c) => {
    const roomId = c.req.param("id");
    const configs = db
      .select()
      .from(schema.agentConfigs)
      .where(eq(schema.agentConfigs.roomId, roomId))
      .all();
    for (const config of configs) {
      await agentManager.stopAgent(config.participantId);
    }
    return c.json({ ok: true });
  });

  // ─── Status ─────────────────────────────────────────────

  app.get("/status", (c) => {
    const roomCount = db.select().from(schema.rooms).all().length;
    const participantRows = db.select().from(schema.participants).all();
    return c.json({
      status: "running",
      rooms: roomCount,
      participants: participantRows,
    });
  });

  return { app, agentManager };
}

function safeParse(json: string, fallback: unknown): unknown {
  try {
    return JSON.parse(json);
  } catch {
    return fallback;
  }
}
