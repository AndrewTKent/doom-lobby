/**
 * doom-lobby — Instant multiplayer DOOM via Cloudflare Workers + Durable Objects
 *
 * Routes:
 *   /                  → Single player (static index.html)
 *   /play              → Create new lobby, redirect to /play/:id
 *   /play/:id          → Join existing lobby
 *   /api/lobby/:id     → Lobby status JSON
 *   /api/ws/:id        → WebSocket upgrade → Durable Object
 */

export interface Env {
  LOBBY: DurableObjectNamespace;
  ASSETS: Fetcher;
}

function generateLobbyId(): string {
  const chars = "abcdefghijkmnpqrstuvwxyz23456789"; // no ambiguous chars (30)
  const limit = 256 - (256 % chars.length); // reject bytes >= 240
  let id = "";
  while (id.length < 6) {
    const bytes = new Uint8Array(8);
    crypto.getRandomValues(bytes);
    for (const b of bytes) {
      if (b < limit && id.length < 6) {
        id += chars[b % chars.length];
      }
    }
  }
  return id;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;

    // POST /api/debug — client telemetry
    if (path === "/api/debug" && request.method === "POST") {
      const body = await request.text();
      console.log("[DEBUG]", body);
      return Response.json({ ok: true });
    }

    // GET /api/debug — retrieve recent logs
    if (path === "/api/debug" && request.method === "GET") {
      return Response.json({ message: "Use wrangler tail to view debug logs" });
    }

    // POST /api/lobby — create new lobby
    if (path === "/api/lobby" && request.method === "POST") {
      const lobbyId = generateLobbyId();
      return Response.json({ id: lobbyId, url: `${url.origin}/play/${lobbyId}` });
    }

    // GET /api/lobby/:id — lobby status
    const lobbyStatusMatch = path.match(/^\/api\/lobby\/([a-z0-9]+)$/);
    if (lobbyStatusMatch) {
      const lobbyId = lobbyStatusMatch[1];
      const doId = env.LOBBY.idFromName(lobbyId);
      const stub = env.LOBBY.get(doId);
      return stub.fetch(new Request(`http://internal/status`, { method: "GET" }));
    }

    // GET /api/ws/:id — WebSocket upgrade to Durable Object
    const wsMatch = path.match(/^\/api\/ws\/([a-z0-9]+)$/);
    if (wsMatch) {
      const upgradeHeader = request.headers.get("Upgrade");
      if (upgradeHeader !== "websocket") {
        return new Response("Expected WebSocket", { status: 426 });
      }
      const lobbyId = wsMatch[1];
      const doId = env.LOBBY.idFromName(lobbyId);
      const stub = env.LOBBY.get(doId);
      return stub.fetch(request);
    }

    // GET /play — create lobby and redirect
    if (path === "/play" || path === "/play/") {
      const lobbyId = generateLobbyId();
      return Response.redirect(`${url.origin}/play/${lobbyId}`, 302);
    }

    // GET /play/:id — serve index.html for SPA-style lobby routing
    if (path.match(/^\/play\/[a-z0-9]+$/)) {
      return env.ASSETS.fetch(new URL("/index.html", url.origin));
    }

    // Everything else → static assets (index.html, doom.js, doom.wasm, etc.)
    return env.ASSETS.fetch(request);
  },
} satisfies ExportedHandler<Env>;

// ─── Durable Object: DoomLobby ───────────────────────────────────────────────

const LOBBY_TTL_MS = 5 * 60 * 1000; // 5 minutes
const RECONNECT_GRACE_MS = 10_000; // 10 seconds

type ConnectionPhase = "lobby" | "game";

interface Player {
  ws: WebSocket;
  from: number; // fake IP (uint32)
  name: string;
  joinedAt: number;
  phase: ConnectionPhase;
}

export class DoomLobby implements DurableObject {
  private players: Map<WebSocket, Player> = new Map();
  private disconnected: Map<string, { player: Player; timer: ReturnType<typeof setTimeout> }> = new Map();
  private gameStarted = false;

  constructor(
    private state: DurableObjectState,
    private env: Env,
  ) {}

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    // Status endpoint
    if (url.pathname === "/status") {
      const uniquePlayers = this.getUniquePlayers();
      return Response.json({
        players: uniquePlayers,
        playerCount: uniquePlayers.length,
        maxPlayers: 4,
        gameStarted: this.gameStarted,
      });
    }

    // Check for reconnection (reclaim disconnected slot)
    const reqName = url.searchParams.get("name") || "";
    const disconnectedEntry = this.disconnected.get(reqName);
    if (disconnectedEntry) {
      clearTimeout(disconnectedEntry.timer);
      this.disconnected.delete(reqName);
    }

    // Reject if lobby is full (count unique players, not connections)
    if (!disconnectedEntry && this.getUniquePlayers().length >= 4) {
      return Response.json({ error: "Lobby is full", maxPlayers: 4 }, { status: 409 });
    }

    // WebSocket upgrade
    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);

    this.state.acceptWebSocket(server);
    this.state.storage.setAlarm(Date.now() + LOBBY_TTL_MS);

    // Determine phase from query param
    const phase: ConnectionPhase = url.searchParams.get("phase") === "game" ? "game" : "lobby";

    // Store player state — restore fake IP if reconnecting
    this.players.set(server, {
      ws: server,
      from: disconnectedEntry ? disconnectedEntry.player.from : 0,
      name: reqName || `Player ${this.players.size + 1}`,
      joinedAt: disconnectedEntry ? disconnectedEntry.player.joinedAt : Date.now(),
      phase,
    });

    // Notify all players of updated lobby state
    this.broadcastLobbyState();

    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(ws: WebSocket, message: ArrayBuffer | string): Promise<void> {
    if (typeof message === "string") {
      // Control messages (JSON)
      try {
        const msg = JSON.parse(message);
        if (msg.type === "name") {
          const player = this.players.get(ws);
          if (player && typeof msg.name === "string") {
            player.name = msg.name.slice(0, 16).trim() || player.name;
            this.broadcastLobbyState();
          }
        }
        if (msg.type === "game_started") {
          this.gameStarted = true;
          this.broadcastLobbyState();
        }
        if (msg.type === "chat") {
          const player = this.players.get(ws);
          const chatMsg = JSON.stringify({
            type: "chat",
            name: player?.name || "Unknown",
            text: String(msg.text).slice(0, 200),
          });
          for (const [otherWs] of this.players) {
            if (otherWs.readyState === WebSocket.READY_STATE_OPEN) {
              otherWs.send(chatMsg);
            }
          }
        }
      } catch {
        // ignore malformed JSON
      }
      return;
    }

    // Binary messages — DOOM network packets
    // Wire format: [to: uint32 LE] [from: uint32 LE] [payload...]
    if (message.byteLength < 8) return;

    const view = new DataView(message);
    const to = view.getUint32(0, true);
    const from = view.getUint32(4, true);

    // Register sender's fake IP on first packet
    const sender = this.players.get(ws);
    if (sender && sender.from === 0) {
      sender.from = from;
    }

    // Special: from==1 && to==0 means server restart — reset room
    if (from === 1 && to === 0) {
      for (const [otherWs, player] of this.players) {
        if (otherWs !== ws) {
          otherWs.close(1000, "Room reset");
        }
      }
      this.players.clear();
      if (sender) {
        this.players.set(ws, sender);
      }
      this.gameStarted = false;
      return;
    }

    // Route: strip `to` header (4 bytes), forward [from][payload] to target
    const forwarded = message.slice(4);

    if (to === 0xffffffff) {
      // Broadcast to all other players
      for (const [otherWs] of this.players) {
        if (otherWs !== ws && otherWs.readyState === WebSocket.READY_STATE_OPEN) {
          otherWs.send(forwarded);
        }
      }
    } else {
      // Unicast to specific player by fake IP
      for (const [otherWs, player] of this.players) {
        if (player.from === to && otherWs.readyState === WebSocket.READY_STATE_OPEN) {
          otherWs.send(forwarded);
          break;
        }
      }
    }
  }

  async webSocketClose(ws: WebSocket): Promise<void> {
    const player = this.players.get(ws);
    this.players.delete(ws);

    // During a game, hold the slot for reconnection
    if (player && this.gameStarted && player.phase === "game" && player.from !== 0) {
      const timer = setTimeout(() => {
        this.disconnected.delete(player.name);
        this.broadcastLobbyState();
      }, RECONNECT_GRACE_MS);
      this.disconnected.set(player.name, { player, timer });
    }

    this.broadcastLobbyState();
    if (this.players.size === 0 && this.disconnected.size === 0) {
      this.gameStarted = false;
      this.state.storage.setAlarm(Date.now() + 30_000);
    } else {
      this.state.storage.setAlarm(Date.now() + LOBBY_TTL_MS);
    }
  }

  async webSocketError(ws: WebSocket): Promise<void> {
    // Delegate to webSocketClose for consistent cleanup + reconnect grace
    await this.webSocketClose(ws);
  }

  async alarm(): Promise<void> {
    if (this.players.size === 0 && this.disconnected.size === 0) {
      return;
    }
    for (const [ws] of this.players) {
      ws.close(1000, "Lobby timed out");
    }
    this.players.clear();
    for (const [, entry] of this.disconnected) {
      clearTimeout(entry.timer);
    }
    this.disconnected.clear();
    this.gameStarted = false;
  }

  private getUniquePlayers(): Array<{ name: string; joinedAt: number }> {
    const seen = new Set<string>();
    const unique: Array<{ name: string; joinedAt: number }> = [];
    for (const p of this.players.values()) {
      if (!seen.has(p.name)) {
        seen.add(p.name);
        unique.push({ name: p.name, joinedAt: p.joinedAt });
      }
    }
    return unique;
  }

  private broadcastLobbyState(): void {
    const uniquePlayers = this.getUniquePlayers();
    const state = JSON.stringify({
      type: "lobby_state",
      players: uniquePlayers,
      playerCount: uniquePlayers.length,
      maxPlayers: 4,
      gameStarted: this.gameStarted,
    });

    for (const [ws] of this.players) {
      if (ws.readyState === WebSocket.READY_STATE_OPEN) {
        ws.send(state);
      }
    }
  }
}
