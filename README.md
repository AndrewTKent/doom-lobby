# DOOM Lobby

<!-- TODO: add demo.gif/demo.svg here once recorded -->

Multiplayer DOOM should not require a 45-minute LAN party setup in 2026. Send a link. Open a browser. You're in a deathmatch.

The entire backend is ~170 lines of TypeScript. One Cloudflare Worker handles routing. One Durable Object per lobby relays game packets between players. [Chocolate Doom](https://github.com/cloudflare/doom-wasm) runs at 60fps in the browser via WebAssembly. There is no matchmaking server, no account system, no download. The lobby URL *is* the invite.

## Quick Start

### Play

```bash
npm install
make setup          # fetches shareware WAD + builds WASM engine
make dev            # localhost:8787
```

Click **HOST DEATHMATCH**. Copy the link. Send it to up to 3 friends. Click **START**. That's the whole product.

### Deploy

```bash
npx wrangler login  # one-time Cloudflare auth
make deploy
```

Now you have a URL on Cloudflare's edge network. 300+ cities. Free tier.

## The Lobby

```
/                    solo — no network, just DOOM in your browser
/play                creates a lobby, redirects to ↓
/play/xk7f3n         the lobby — share this URL, everyone who opens it joins
```

When you hit `/play`, the Worker mints a lobby ID and drops you into a waiting room. You get a share link, a QR code, and a player list that updates live. Friends open the same URL and show up. Host clicks START, four WebSocket connections route through one Durable Object, and DOOM's 1993 netcode handles the rest.

```
  Browsers                                   Cloudflare Edge
                                            +-----------------------------+
 +-----------------+                        |                             |
 |  DOOM (WASM)    |  <--- WebSocket --->   |  +~~~~~~~~~~~~~~~~~~~~~~~+  |
 |  full 60fps     |                        |  |                       |  |
 +-----------------+                        |  |  DoomLobby            |  |
                                            |  |  (Durable Object)     |  |
 +-----------------+                        |  |                       |  |
 |  DOOM (WASM)    |  <--- WebSocket --->   |  |  - 4 WebSockets       |  |
 |  same lobby URL |                        |  |  - relay binary pkts  |  |
 +-----------------+                        |  |  - route by fake IP   |  |
                                            |  |                       |  |
 +-----------------+                        |  +~~~~~~~~~~~~~~~~~~~~~~~+  |
 |  DOOM (WASM)    |  <--- WebSocket --->   |                             |
 |  another friend |                        |   Static: HTML, WASM, WAD   |
 +-----------------+                        +-----------------------------+
```

Each client runs the full engine. The Durable Object is just a packet relay — it reads an 8-byte header (destination IP, source IP), strips the destination, and forwards to the right socket. Same architecture DOOM used over IPX in '93, except the "LAN" is Cloudflare's backbone.

## What's in the box

| | |
|---|---|
| **Worker** | ~170 lines TypeScript — lobby creation, WebSocket upgrade, static assets |
| **Frontend** | ~270 lines — single HTML file with lobby UI, DOOM canvas, share/QR |
| **Engine** | Chocolate Doom compiled to WASM via Emscripten, WebSocket net driver |
| **Max players** | 4 (DOOM's original limit) |
| **State** | In-memory only. No database. Lobby dies when everyone leaves. |
| **Cost** | Free tier covers it |

## Building the WASM Engine

The engine is [cloudflare/doom-wasm](https://github.com/cloudflare/doom-wasm) — Chocolate Doom with UDP ripped out and a WebSocket driver patched in. You need [Emscripten](https://emscripten.org/) to compile it:

```bash
# one-time: install Emscripten
git clone https://github.com/emscripten-core/emsdk.git
cd emsdk && ./emsdk install latest && ./emsdk activate latest
source ./emsdk_env.sh

# build (clones the repo, compiles, copies artifacts to public/)
make build-wasm
```

First build is ~10-15 minutes. After that it's fast. The shareware WAD downloads separately via `make fetch-wad`, or just run `make setup` for both.

## All Commands

| Command | What it does |
|---------|-------------|
| `make dev` | Local dev server |
| `make deploy` | Deploy to Cloudflare |
| `make setup` | Fetch WAD + build WASM |
| `make build-wasm` | Compile DOOM to WASM |
| `make fetch-wad` | Download `doom1.wad` |
| `make types` | TypeScript type check |
| `make clean` | Nuke build artifacts |

## Standing on

- [cloudflare/doom-wasm](https://github.com/cloudflare/doom-wasm) — the WASM engine and WebSocket net driver
- [cloudflare/doom-workers](https://github.com/cloudflare/doom-workers) — the original Durable Objects relay (we rewrote it)
- [id Software](https://github.com/id-Software/DOOM) — the reason any of this exists

## License

GPL-2.0, inherited from Chocolate Doom and the DOOM source release.
