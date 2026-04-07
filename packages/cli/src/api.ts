import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

const DEFAULT_BASE = "http://127.0.0.1:4135";
const TOKEN_PATH = join(homedir(), ".rebecca", "auth.token");

function getBase(): string {
  return process.env.REBECCA_URL ?? DEFAULT_BASE;
}

function getToken(): string | null {
  if (process.env.REBECCA_TOKEN) return process.env.REBECCA_TOKEN;
  if (existsSync(TOKEN_PATH)) {
    return readFileSync(TOKEN_PATH, "utf-8").trim();
  }
  return null;
}

async function request(
  method: string,
  path: string,
  body?: unknown,
): Promise<{ ok: boolean; status: number; data: any }> {
  const url = `${getBase()}${path}`;
  const headers: Record<string, string> = {};
  if (body) headers["Content-Type"] = "application/json";

  const token = getToken();
  if (token) headers["Authorization"] = `Bearer ${token}`;

  const res = await fetch(url, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => null);
  return { ok: res.ok, status: res.status, data };
}

export function getAuthToken(): string | null {
  return getToken();
}

function enc(s: string): string {
  return encodeURIComponent(s);
}

export const api = {
  // Rooms
  createRoom: (name: string, id?: string) =>
    request("POST", "/rooms", { name, id }),

  listRooms: () => request("GET", "/rooms"),

  getRoom: (id: string) => request("GET", `/rooms/${enc(id)}`),

  // Participants
  join: (roomId: string, id: string, name: string, kind: string) =>
    request("POST", `/rooms/${enc(roomId)}/join`, { id, name, kind }),

  leave: (roomId: string, id: string) =>
    request("POST", `/rooms/${enc(roomId)}/leave`, { id }),

  getParticipants: (roomId: string) =>
    request("GET", `/rooms/${enc(roomId)}/participants`),

  // Messages
  postMessage: (
    roomId: string,
    senderId: string,
    text: string,
    mentions?: string[],
    quickMentions?: string[],
  ) =>
    request("POST", `/rooms/${enc(roomId)}/messages`, {
      senderId,
      text,
      mentions: mentions?.length ? mentions : undefined,
      quickMentions: quickMentions?.length ? quickMentions : undefined,
    }),

  readMessages: (roomId: string, limit?: number, before?: string) => {
    const params = new URLSearchParams();
    if (limit) params.set("limit", String(limit));
    if (before) params.set("before", before);
    const qs = params.toString();
    return request(
      "GET",
      `/rooms/${enc(roomId)}/messages${qs ? `?${qs}` : ""}`,
    );
  },

  // Agents
  addAgent: (
    roomId: string,
    name: string,
    type: string,
    runCommand: string,
    cwd?: string,
    env?: Record<string, string>,
  ) =>
    request("POST", `/rooms/${enc(roomId)}/agents`, {
      name,
      type,
      runCommand,
      cwd,
      env,
    }),

  removeAgent: (roomId: string, name: string) =>
    request("DELETE", `/rooms/${enc(roomId)}/agents/${enc(name)}`),

  listAgents: (roomId: string) => request("GET", `/rooms/${enc(roomId)}/agents`),

  startRoom: (roomId: string) => request("POST", `/rooms/${enc(roomId)}/start`),

  stopRoom: (roomId: string) => request("POST", `/rooms/${enc(roomId)}/stop`),

  // Tasks
  createTask: (roomId: string, description: string, assigneeId?: string) =>
    request("POST", `/rooms/${enc(roomId)}/tasks`, { description, assigneeId }),

  updateTask: (taskId: string, state: string) =>
    request("PATCH", `/tasks/${enc(taskId)}`, { state }),

  getTasks: (roomId: string) => request("GET", `/rooms/${enc(roomId)}/tasks`),

  // Status
  status: () => request("GET", "/status"),
};

export function getWsUrl(): string {
  const base = getBase().replace("http", "ws");
  const token = getToken();
  return token ? `${base}/ws?token=${encodeURIComponent(token)}` : `${base}/ws`;
}
