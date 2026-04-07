import { sqliteTable, text, integer, index } from "drizzle-orm/sqlite-core";

export const rooms = sqliteTable("rooms", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  createdAt: text("created_at")
    .notNull()
    .$defaultFn(() => new Date().toISOString()),
});

export const participants = sqliteTable("participants", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  kind: text("kind", { enum: ["human", "agent"] }).notNull(),
  status: text("status", {
    enum: ["online", "offline", "working", "error", "rate_limited"],
  })
    .notNull()
    .default("offline"),
  statusMessage: text("status_message"),
});

export const roomMembers = sqliteTable(
  "room_members",
  {
    roomId: text("room_id")
      .notNull()
      .references(() => rooms.id),
    participantId: text("participant_id")
      .notNull()
      .references(() => participants.id),
    joinedAt: text("joined_at")
      .notNull()
      .$defaultFn(() => new Date().toISOString()),
  },
  (table) => [
    index("idx_room_members_room").on(table.roomId),
  ],
);

export const messages = sqliteTable(
  "messages",
  {
    id: text("id").primaryKey(),
    roomId: text("room_id")
      .notNull()
      .references(() => rooms.id),
    senderId: text("sender_id").notNull(),
    content: text("content").notNull(), // JSON: Part[]
    mentions: text("mentions"), // JSON: string[]
    createdAt: text("created_at")
      .notNull()
      .$defaultFn(() => new Date().toISOString()),
  },
  (table) => [
    index("idx_messages_room_time").on(table.roomId, table.createdAt),
  ],
);

export const agentConfigs = sqliteTable(
  "agent_configs",
  {
    participantId: text("participant_id")
      .primaryKey()
      .references(() => participants.id),
    roomId: text("room_id")
      .notNull()
      .references(() => rooms.id),
    type: text("type").notNull(),
    runCommand: text("run_command").notNull(),
    cwd: text("cwd"),
    env: text("env"), // JSON
    autoStart: integer("auto_start").notNull().default(1),
    createdAt: text("created_at")
      .notNull()
      .$defaultFn(() => new Date().toISOString()),
  },
  (table) => [index("idx_agent_configs_room").on(table.roomId)],
);

export const pendingMentions = sqliteTable(
  "pending_mentions",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    participantId: text("participant_id").notNull(),
    roomId: text("room_id")
      .notNull()
      .references(() => rooms.id),
    messageId: text("message_id").notNull(),
    createdAt: text("created_at")
      .notNull()
      .$defaultFn(() => new Date().toISOString()),
    deliveredAt: text("delivered_at"),
  },
  (table) => [
    index("idx_pending_mentions_participant").on(
      table.participantId,
      table.deliveredAt,
    ),
  ],
);

export const tasks = sqliteTable(
  "tasks",
  {
    id: text("id").primaryKey(),
    roomId: text("room_id")
      .notNull()
      .references(() => rooms.id),
    assigneeId: text("assignee_id").references(() => participants.id),
    description: text("description"),
    state: text("state", {
      enum: [
        "submitted",
        "working",
        "input_required",
        "completed",
        "failed",
        "canceled",
      ],
    })
      .notNull()
      .default("submitted"),
    createdAt: text("created_at")
      .notNull()
      .$defaultFn(() => new Date().toISOString()),
    updatedAt: text("updated_at")
      .notNull()
      .$defaultFn(() => new Date().toISOString()),
  },
  (table) => [
    index("idx_tasks_room").on(table.roomId, table.state),
  ],
);
