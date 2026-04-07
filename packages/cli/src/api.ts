const DEFAULT_BASE = "http://127.0.0.1:4135";

function getBase(): string {
  return process.env.REBECCA_URL ?? DEFAULT_BASE;
}

async function request(
  method: string,
  path: string,
  body?: unknown,
): Promise<{ ok: boolean; status: number; data: any }> {
  const url = `${getBase()}${path}`;
  const res = await fetch(url, {
    method,
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => null);
  return { ok: res.ok, status: res.status, data };
}

export const api = {
  // Rooms
  createRoom: (name: string, id?: string) =>
    request("POST", "/rooms", { name, id }),

  listRooms: () => request("GET", "/rooms"),

  getRoom: (id: string) => request("GET", `/rooms/${id}`),

  // Participants
  join: (roomId: string, id: string, name: string, kind: string) =>
    request("POST", `/rooms/${roomId}/join`, { id, name, kind }),

  leave: (roomId: string, id: string) =>
    request("POST", `/rooms/${roomId}/leave`, { id }),

  getParticipants: (roomId: string) =>
    request("GET", `/rooms/${roomId}/participants`),

  // Messages
  postMessage: (
    roomId: string,
    senderId: string,
    text: string,
    mentions?: string[],
  ) =>
    request("POST", `/rooms/${roomId}/messages`, {
      senderId,
      text,
      mentions: mentions?.length ? mentions : undefined,
    }),

  readMessages: (roomId: string, limit?: number, before?: string) => {
    const params = new URLSearchParams();
    if (limit) params.set("limit", String(limit));
    if (before) params.set("before", before);
    const qs = params.toString();
    return request("GET", `/rooms/${roomId}/messages${qs ? `?${qs}` : ""}`);
  },

  // Agents
  addAgent: (
    roomId: string,
    name: string,
    type: string,
    runCommand: string,
    cwd?: string,
  ) =>
    request("POST", `/rooms/${roomId}/agents`, {
      name,
      type,
      runCommand,
      cwd,
    }),

  removeAgent: (roomId: string, name: string) =>
    request("DELETE", `/rooms/${roomId}/agents/${name}`),

  listAgents: (roomId: string) => request("GET", `/rooms/${roomId}/agents`),

  startRoom: (roomId: string) => request("POST", `/rooms/${roomId}/start`),

  stopRoom: (roomId: string) => request("POST", `/rooms/${roomId}/stop`),

  // Tasks
  createTask: (roomId: string, description: string, assigneeId?: string) =>
    request("POST", `/rooms/${roomId}/tasks`, { description, assigneeId }),

  updateTask: (taskId: string, state: string) =>
    request("PATCH", `/tasks/${taskId}`, { state }),

  getTasks: (roomId: string) => request("GET", `/rooms/${roomId}/tasks`),

  // Status
  status: () => request("GET", "/status"),
};

export function getWsUrl(): string {
  const base = getBase().replace("http", "ws");
  return `${base}/ws`;
}
