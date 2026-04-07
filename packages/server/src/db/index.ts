import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import * as schema from "./schema.js";
import { existsSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";

export function createDb(dbPath: string) {
  const dir = dirname(dbPath);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }

  const sqlite = new Database(dbPath);

  // Enable WAL mode and verify
  const walResult = sqlite.pragma("journal_mode = WAL") as { journal_mode: string }[];
  if (walResult[0]?.journal_mode !== "wal") {
    console.warn(
      `[db] WAL mode not enabled (got: ${walResult[0]?.journal_mode}). Performance may be degraded.`,
    );
  }
  sqlite.pragma("busy_timeout = 5000");
  sqlite.pragma("foreign_keys = ON");
  sqlite.pragma("synchronous = NORMAL");

  const db = drizzle(sqlite, { schema });

  // Create tables in a single transaction
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS rooms (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS participants (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      kind TEXT NOT NULL CHECK (kind IN ('human', 'agent')),
      status TEXT NOT NULL DEFAULT 'offline'
        CHECK (status IN ('online','offline','working','error','rate_limited')),
      status_message TEXT
    );

    CREATE TABLE IF NOT EXISTS room_members (
      room_id TEXT NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
      participant_id TEXT NOT NULL REFERENCES participants(id) ON DELETE CASCADE,
      joined_at TEXT NOT NULL,
      PRIMARY KEY (room_id, participant_id)
    );

    CREATE TABLE IF NOT EXISTS messages (
      id TEXT PRIMARY KEY,
      room_id TEXT NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
      sender_id TEXT NOT NULL,
      content TEXT NOT NULL CHECK (json_valid(content)),
      mentions TEXT CHECK (mentions IS NULL OR json_valid(mentions)),
      created_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_messages_room_time
      ON messages(room_id, created_at);

    CREATE TABLE IF NOT EXISTS tasks (
      id TEXT PRIMARY KEY,
      room_id TEXT NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
      assignee_id TEXT REFERENCES participants(id),
      description TEXT,
      state TEXT NOT NULL DEFAULT 'submitted'
        CHECK (state IN ('submitted','working','input_required',
                         'completed','failed','canceled')),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_tasks_room ON tasks(room_id, state);

    CREATE TABLE IF NOT EXISTS agent_configs (
      participant_id TEXT PRIMARY KEY REFERENCES participants(id) ON DELETE CASCADE,
      room_id TEXT NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
      type TEXT NOT NULL,
      run_command TEXT NOT NULL,
      cwd TEXT,
      env TEXT CHECK (env IS NULL OR json_valid(env)),
      auto_start INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_agent_configs_room ON agent_configs(room_id);

    CREATE TABLE IF NOT EXISTS pending_mentions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      participant_id TEXT NOT NULL,
      room_id TEXT NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
      message_id TEXT NOT NULL,
      created_at TEXT NOT NULL,
      UNIQUE (participant_id, message_id)
    );

    CREATE INDEX IF NOT EXISTS idx_pending_mentions_participant
      ON pending_mentions(participant_id);
  `);

  return { db, sqlite };
}

export type Db = ReturnType<typeof createDb>["db"];
export { schema };
