import * as readline from "node:readline";
import WebSocket from "ws";
import { api, getWsUrl } from "../api.js";
import { parseMentions, parseModePrefix } from "../mentions.js";

export async function connectCommand(roomId: string) {
  const participantId = `human/${process.env.USER ?? "user"}`;
  const participantName = process.env.USER ?? "user";

  // Connect WebSocket FIRST so we don't miss participant events that occur
  // between the room snapshot fetch and WS subscription.
  const wsUrl = getWsUrl();
  const sep = wsUrl.includes("?") ? "&" : "?";
  const ws = new WebSocket(
    `${wsUrl}${sep}participant=${encodeURIComponent(participantId)}`,
  );

  // Wait for WS to be open and subscribed before snapshotting
  await new Promise<void>((resolve, reject) => {
    ws.on("open", () => {
      ws.send(JSON.stringify({ type: "subscribe", roomId }));
    });
    ws.on("message", (data) => {
      try {
        const event = JSON.parse(data.toString());
        if (event.type === "subscribed" && event.roomId === roomId) {
          resolve();
        }
      } catch {}
    });
    ws.on("error", (err) => reject(err));
    setTimeout(() => reject(new Error("WebSocket subscription timeout")), 10_000);
  });

  // Join room
  const joinRes = await api.join(roomId, participantId, participantName, "human");
  if (!joinRes.ok) {
    console.error(`Failed to join room: ${joinRes.data?.error ?? joinRes.status}`);
    process.exit(1);
  }

  // Get room info (may race with WS participant_joined events, handled in dedup)
  const roomRes = await api.getRoom(roomId);
  if (!roomRes.ok) {
    console.error(`Room not found: ${roomId}`);
    process.exit(1);
  }

  const room = roomRes.data;
  console.log(`\x1b[1mRoom: ${room.name}\x1b[0m`);
  if (room.participants?.length) {
    const others = room.participants
      .filter((p: any) => p.id !== participantId)
      .map((p: any) => `${p.name} (${p.kind}${p.status !== "offline" ? `, ${p.status}` : ""})`)
      .join(", ");
    if (others) console.log(`Participants: ${others}`);
  }

  // Show active tasks
  const taskRes = await api.getTasks(roomId);
  if (taskRes.ok && taskRes.data?.length) {
    const active = taskRes.data.filter(
      (t: any) => t.state === "working" || t.state === "input_required",
    );
    if (active.length > 0) {
      console.log("--- active tasks ---");
      for (const t of active) {
        const assignee = t.assigneeId?.split("/").pop() ?? "unassigned";
        console.log(`  \x1b[33m[${t.state}]\x1b[0m ${t.description} (${assignee})`);
      }
    }
  }

  // Show recent messages
  const msgRes = await api.readMessages(roomId, 20);
  if (msgRes.ok && msgRes.data?.length) {
    console.log("--- recent ---");
    for (const msg of msgRes.data) {
      printMessage(msg, participantId);
    }
  }
  console.log("---");

  // Live participant list — kept in sync via WebSocket events
  let participants: any[] = room.participants ?? [];

  ws.on("message", (data) => {
    try {
      const event = JSON.parse(data.toString());

      if (event.type === "message" && event.message?.senderId !== participantId) {
        process.stdout.write(`\r\x1b[K`);
        printMessage(event.message, participantId);
        rl.prompt();
      }

      if (event.type === "task_created" || event.type === "task_update") {
        const task = event.task;
        process.stdout.write(`\r\x1b[K`);
        console.log(
          `\x1b[33m[task]\x1b[0m ${task.description ?? task.id}: ${task.state}`,
        );
        rl.prompt();
      }

      if (event.type === "status_change") {
        process.stdout.write(`\r\x1b[K`);
        console.log(
          `\x1b[33m[status]\x1b[0m ${event.participantId}: ${event.status}`,
        );
        rl.prompt();
      }

      if (event.type === "participant_joined") {
        const p = event.participant;
        if (p && !participants.find((x) => x.id === p.id)) {
          participants.push(p);
          process.stdout.write(`\r\x1b[K`);
          console.log(`\x1b[33m[joined]\x1b[0m ${p.name} (${p.kind})`);
          rl.prompt();
        }
      }

      if (event.type === "participant_left") {
        participants = participants.filter((x) => x.id !== event.participantId);
        process.stdout.write(`\r\x1b[K`);
        console.log(`\x1b[33m[left]\x1b[0m ${event.participantId}`);
        rl.prompt();
      }
    } catch {
      // ignore
    }
  });

  ws.on("close", () => {
    console.log("\n[disconnected]");
    cleanup();
  });

  ws.on("error", (err) => {
    console.error(`\n[ws error] ${err.message}`);
  });

  // Readline for human input
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  rl.setPrompt(`\x1b[32m[${participantName}]\x1b[0m `);
  rl.prompt();

  rl.on("line", async (line) => {
    const trimmed = line.trim();
    if (!trimmed) {
      rl.prompt();
      return;
    }

    // Detect /btw prefix and strip it
    const { mode, text: messageText } = parseModePrefix(trimmed);

    // Parse @mentions
    const mentions = parseMentions(messageText, participants, participantId);

    await api.postMessage(
      roomId,
      participantId,
      messageText,
      mentions,
      mode,
    );
    rl.prompt();
  });

  rl.on("close", () => {
    cleanup();
  });

  function cleanup() {
    api.leave(roomId, participantId).catch(() => {});
    ws.close();
    process.exit(0);
  }

  // Handle Ctrl+C
  process.on("SIGINT", cleanup);
}

function printMessage(msg: any, selfId: string) {
  const name = msg.senderId === "system" ? "system" : senderName(msg.senderId);
  const text = extractText(msg.content);
  const color = msg.senderId === selfId ? "32" : "36";
  console.log(`\x1b[${color}m[${name}]\x1b[0m ${text}`);
}

function senderName(senderId: string): string {
  // Extract name from id like "human/alice" or "agent/researcher"
  const parts = senderId.split("/");
  return parts[parts.length - 1];
}

function extractText(content: any[]): string {
  if (!Array.isArray(content)) return String(content);
  return content
    .map((p: any) => p.text ?? "")
    .filter(Boolean)
    .join("\n");
}

