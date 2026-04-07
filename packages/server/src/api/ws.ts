import { WebSocketServer, WebSocket } from "ws";
import type { Server } from "node:http";

interface WsClient {
  ws: WebSocket;
  participantId: string | null;
  subscribedRooms: Set<string>;
  alive: boolean;
}

export type WebSocketBroadcaster = (
  roomId: string,
  event: Record<string, unknown>,
) => void;

const MAX_SUBSCRIPTIONS = 50;

export function setupWebSocket(server: Server) {
  const wss = new WebSocketServer({ server, path: "/ws" });
  const clients = new Set<WsClient>();

  // Heartbeat: ping every 30s, drop dead connections
  const heartbeat = setInterval(() => {
    for (const client of clients) {
      if (!client.alive) {
        client.ws.terminate();
        clients.delete(client);
        continue;
      }
      client.alive = false;
      client.ws.ping();
    }
  }, 30_000);

  wss.on("close", () => clearInterval(heartbeat));

  wss.on("connection", (ws, req) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    const participantId = url.searchParams.get("participant");

    const client: WsClient = {
      ws,
      participantId,
      subscribedRooms: new Set(),
      alive: true,
    };
    clients.add(client);

    ws.on("pong", () => {
      client.alive = true;
    });

    ws.on("message", (data) => {
      try {
        const msg = JSON.parse(data.toString());

        if (msg.type === "subscribe" && typeof msg.roomId === "string") {
          if (client.subscribedRooms.size >= MAX_SUBSCRIPTIONS) {
            ws.send(JSON.stringify({ type: "error", message: "Too many subscriptions" }));
            return;
          }
          client.subscribedRooms.add(msg.roomId);
          ws.send(JSON.stringify({ type: "subscribed", roomId: msg.roomId }));
        }

        if (msg.type === "unsubscribe" && typeof msg.roomId === "string") {
          client.subscribedRooms.delete(msg.roomId);
          ws.send(JSON.stringify({ type: "unsubscribed", roomId: msg.roomId }));
        }
      } catch {
        ws.send(JSON.stringify({ type: "error", message: "Invalid message format" }));
      }
    });

    ws.on("close", () => {
      clients.delete(client);
    });
  });

  const broadcast: WebSocketBroadcaster = (roomId, event) => {
    const payload = JSON.stringify(event);
    for (const client of clients) {
      if (
        client.ws.readyState === WebSocket.OPEN &&
        client.subscribedRooms.has(roomId)
      ) {
        client.ws.send(payload);
      }
    }
  };

  return { wss, broadcast };
}
