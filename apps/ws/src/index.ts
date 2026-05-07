/**
 * giper-pm realtime server. A small WebSocket fanout that lets the web
 * app push events to currently-connected browsers. Three responsibilities:
 *
 *   1. Accept WebSocket upgrades, authenticate via short-lived JWT issued
 *      by the web app (signed with WS_AUTH_SECRET).
 *   2. Track per-channel subscriptions in memory (one process = one Set).
 *   3. Expose `POST /publish` that the web app calls to fan out an event
 *      to all sockets subscribed to a channel. Auth: shared secret in
 *      `Authorization: Bearer <secret>`.
 *
 * Channels we support:
 *   user:<userId>      — personal inbox channel; only the matching user
 *                         can subscribe.
 *   task:<taskId>      — live updates on a single task (comments, status,
 *                         presence). Subscribable by anyone (the client
 *                         already knows the id only if it has access).
 *   project:<id>       — kanban-board events, same trust model as task.
 *
 * Why not Pusher: free tier limits, opaque infra, and one extra
 * 3rd-party in the trust chain. We can run this on the same Coolify host
 * for free, with full visibility.
 *
 * Why no Redis pub/sub: single-node deploy. The day we scale to N web
 * nodes we'll add Redis pub/sub here in ~1 hour — every sub/pub already
 * goes through one place.
 */

import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { WebSocketServer, type WebSocket as WSWebSocket } from 'ws';
import { jwtVerify } from 'jose';

const PORT = Number(process.env.WS_PORT ?? 3001);
const HOST = process.env.WS_HOST ?? '0.0.0.0';
const WS_AUTH_SECRET = requireEnv('WS_AUTH_SECRET');
const WS_PUBLISH_SECRET = requireEnv('WS_PUBLISH_SECRET');

// In-memory subscription map: channel name → Set of sockets subscribed.
// We also keep a reverse map socket → Set of channels for fast cleanup
// on disconnect.
const channels = new Map<string, Set<WSWebSocket>>();
const socketChannels = new WeakMap<WSWebSocket, Set<string>>();
const socketUser = new WeakMap<WSWebSocket, string>();

function subscribe(socket: WSWebSocket, channel: string) {
  let set = channels.get(channel);
  if (!set) {
    set = new Set();
    channels.set(channel, set);
  }
  set.add(socket);
  let mine = socketChannels.get(socket);
  if (!mine) {
    mine = new Set();
    socketChannels.set(socket, mine);
  }
  mine.add(channel);
  if (isPresenceChannel(channel)) {
    onPresenceJoin(socket, channel);
  }
}

function unsubscribe(socket: WSWebSocket, channel: string) {
  const set = channels.get(channel);
  if (set) {
    set.delete(socket);
    if (set.size === 0) channels.delete(channel);
  }
  const mine = socketChannels.get(socket);
  if (mine) mine.delete(channel);
  if (isPresenceChannel(channel)) {
    onPresenceLeave(socket, channel);
  }
}

function unsubscribeAll(socket: WSWebSocket) {
  const mine = socketChannels.get(socket);
  if (!mine) return;
  for (const channel of mine) {
    const set = channels.get(channel);
    if (set) {
      set.delete(socket);
      if (set.size === 0) channels.delete(channel);
    }
    if (isPresenceChannel(channel)) {
      onPresenceLeave(socket, channel);
    }
  }
  socketChannels.delete(socket);
}

// ------------- Presence -----------------
//
// Presence is a derived view of the `channels` subscription map: for
// every `task:*` channel we maintain a parallel map channel → Set<userId>
// (deduped — multiple tabs from the same user count as one viewer).
// `presence:state` is broadcast on every change so each subscriber gets
// the authoritative member list and doesn't need to track joins/leaves
// individually. Tradeoff: chattier than diffs, but we never desync.

function isPresenceChannel(channel: string): boolean {
  return channel.startsWith('task:');
}

const presenceMembers = new Map<string, Map<string, Set<WSWebSocket>>>();

function onPresenceJoin(socket: WSWebSocket, channel: string) {
  const userId = socketUser.get(socket);
  if (!userId) return;
  let users = presenceMembers.get(channel);
  if (!users) {
    users = new Map();
    presenceMembers.set(channel, users);
  }
  let userSockets = users.get(userId);
  if (!userSockets) {
    userSockets = new Set();
    users.set(userId, userSockets);
  }
  userSockets.add(socket);
  broadcastPresence(channel);
}

function onPresenceLeave(socket: WSWebSocket, channel: string) {
  const userId = socketUser.get(socket);
  if (!userId) return;
  const users = presenceMembers.get(channel);
  if (!users) return;
  const userSockets = users.get(userId);
  if (!userSockets) return;
  userSockets.delete(socket);
  if (userSockets.size === 0) users.delete(userId);
  if (users.size === 0) presenceMembers.delete(channel);
  broadcastPresence(channel);
}

function broadcastPresence(channel: string) {
  const users = presenceMembers.get(channel);
  const userIds = users ? [...users.keys()] : [];
  publish(channel, { type: 'presence:state', userIds });
}

function publish(channel: string, payload: unknown) {
  const set = channels.get(channel);
  if (!set || set.size === 0) return 0;
  const msg = JSON.stringify({ type: 'event', channel, payload });
  let count = 0;
  for (const socket of set) {
    if (socket.readyState === socket.OPEN) {
      socket.send(msg);
      count++;
    }
  }
  return count;
}

/**
 * Decide whether a socket (already authenticated as `userId`) is allowed
 * to subscribe to a given channel.
 *   - user:<id>      — must match the authenticated id.
 *   - task:* / project:* — open to any authenticated user (per the trust
 *                          model in the file header).
 *   - anything else  — denied.
 */
function canSubscribe(userId: string, channel: string): boolean {
  if (channel.startsWith('user:')) {
    return channel === `user:${userId}`;
  }
  if (channel.startsWith('task:') || channel.startsWith('project:')) {
    return true;
  }
  return false;
}

// ------------- HTTP layer (publish endpoint + health) -----------------

const httpServer = createServer((req, res) => {
  if (req.method === 'GET' && req.url === '/health') {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(
      JSON.stringify({
        ok: true,
        connections: wss?.clients.size ?? 0,
        channels: channels.size,
      }),
    );
    return;
  }
  if (req.method === 'POST' && req.url === '/publish') {
    handlePublish(req, res);
    return;
  }
  res.writeHead(404).end('not found');
});

async function handlePublish(req: IncomingMessage, res: ServerResponse) {
  const auth = req.headers.authorization ?? '';
  if (auth !== `Bearer ${WS_PUBLISH_SECRET}`) {
    res.writeHead(401).end('unauthorized');
    return;
  }
  let raw = '';
  req.on('data', (chunk) => {
    raw += chunk;
    if (raw.length > 1024 * 64) {
      req.destroy();
    }
  });
  req.on('end', () => {
    let body: { channel?: string; payload?: unknown };
    try {
      body = JSON.parse(raw);
    } catch {
      res.writeHead(400).end('invalid json');
      return;
    }
    if (!body.channel || typeof body.channel !== 'string') {
      res.writeHead(400).end('channel required');
      return;
    }
    const delivered = publish(body.channel, body.payload);
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ ok: true, delivered }));
  });
}

// ------------- WebSocket layer -----------------

const wss = new WebSocketServer({ noServer: true });

httpServer.on('upgrade', async (req, socket, head) => {
  // Token rides in the URL query — `?token=...` — because browsers can't
  // attach Authorization headers to native WebSocket connections.
  const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
  const token = url.searchParams.get('token');
  if (!token) {
    socket.destroy();
    return;
  }
  let userId: string | null = null;
  try {
    const secret = new TextEncoder().encode(WS_AUTH_SECRET);
    const { payload } = await jwtVerify(token, secret);
    if (typeof payload.sub === 'string') userId = payload.sub;
  } catch {
    socket.destroy();
    return;
  }
  if (!userId) {
    socket.destroy();
    return;
  }
  wss.handleUpgrade(req, socket, head, (ws) => {
    socketUser.set(ws, userId);
    wss.emit('connection', ws, req);
  });
});

wss.on('connection', (ws) => {
  ws.on('message', (raw) => {
    const userId = socketUser.get(ws);
    if (!userId) {
      ws.close(1008, 'no auth');
      return;
    }
    let msg: { type?: string; channel?: string };
    try {
      msg = JSON.parse(raw.toString());
    } catch {
      return;
    }
    if (msg.type === 'subscribe' && typeof msg.channel === 'string') {
      if (!canSubscribe(userId, msg.channel)) {
        ws.send(JSON.stringify({ type: 'error', channel: msg.channel, error: 'forbidden' }));
        return;
      }
      subscribe(ws, msg.channel);
      ws.send(JSON.stringify({ type: 'subscribed', channel: msg.channel }));
    } else if (msg.type === 'unsubscribe' && typeof msg.channel === 'string') {
      unsubscribe(ws, msg.channel);
      ws.send(JSON.stringify({ type: 'unsubscribed', channel: msg.channel }));
    } else if (msg.type === 'ping') {
      ws.send(JSON.stringify({ type: 'pong' }));
    }
  });

  ws.on('close', () => {
    unsubscribeAll(ws);
    socketUser.delete(ws);
  });

  // Tell the client we're ready.
  ws.send(JSON.stringify({ type: 'hello' }));
});

// Heartbeat — drop dead sockets every 30s.
setInterval(() => {
  for (const ws of wss.clients) {
    if (ws.readyState === ws.OPEN) {
      try {
        ws.ping();
      } catch {
        // ignore
      }
    }
  }
}, 30_000);

httpServer.listen(PORT, HOST, () => {
  // eslint-disable-next-line no-console
  console.log(`[giper-ws] listening on ${HOST}:${PORT}`);
});

function requireEnv(name: string): string {
  const v = process.env[name]?.trim();
  if (!v) {
    // eslint-disable-next-line no-console
    console.error(`[giper-ws] FATAL: ${name} is required`);
    process.exit(1);
  }
  return v;
}
