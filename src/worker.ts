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
  const chars = "abcdefghijkmnpqrstuvwxyz23456789"; // no ambiguous chars
  let id = "";
  const bytes = new Uint8Array(6);
  crypto.getRandomValues(bytes);
  for (const b of bytes) {
    id += chars[b % chars.length];
  }
  return id;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;

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

    // GET /play/:id — serve the game page (handled by static assets with SPA fallback)
    // The static asset handler will serve public/index.html for these routes
    // We need to rewrite to index.html for SPA-style routing
    if (path.match(/^\/play\/[a-z0-9]+$/)) {
      const assetUrl = new URL("/index.html", url.origin);
      return env.ASSETS.fetch(new Request(assetUrl, request));
    }

    // Everything else → static assets (index.html, doom.js, doom.wasm, etc.)
    return env.ASSETS.fetch(request);
  },
} satisfies ExportedHandler<Env>;

// ─── Durable Object: DoomLobby ───────────────────────────────────────────────

interface Player {
  ws: WebSocket;
  from: number; // fake IP (uint32)
  name: string;
  joinedAt: number;
}

export class DoomLobby implements DurableObject {
  private players: Map<WebSocket, Player> = new Map();
  private gameStarted = false;

  constructor(
    private state: DurableObjectState,
    private env: Env,
  ) {}

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    // Status endpoint
    if (url.pathname === "/status") {
      const players = [...this.players.values()].map((p) => ({
        name: p.name,
        joinedAt: p.joinedAt,
      }));
      return Response.json({
        players,
        playerCount: players.length,
        maxPlayers: 4,
        gameStarted: this.gameStarted,
      });
    }

    // WebSocket upgrade
    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);

    this.state.acceptWebSocket(server);

    // Store initial player state (fake IP assigned on first game packet)
    this.players.set(server, {
      ws: server,
      from: 0,
      name: new URL(request.url).searchParams.get("name") || `Player ${this.players.size + 1}`,
      joinedAt: Date.now(),
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
          if (player) {
            player.name = msg.name;
            this.broadcastLobbyState();
          }
        }
        if (msg.type === "game_started") {
          this.gameStarted = true;
          this.broadcastLobbyState();
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
    this.players.delete(ws);
    this.broadcastLobbyState();
    if (this.players.size === 0) {
      this.gameStarted = false;
    }
  }

  async webSocketError(ws: WebSocket): Promise<void> {
    this.players.delete(ws);
    this.broadcastLobbyState();
  }

  private broadcastLobbyState(): void {
    const state = JSON.stringify({
      type: "lobby_state",
      players: [...this.players.values()].map((p) => ({
        name: p.name,
        joinedAt: p.joinedAt,
      })),
      playerCount: this.players.size,
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
