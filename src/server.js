import 'dotenv/config';
import express from 'express';
import { createServer } from 'node:http';
import { WebSocketServer } from 'ws';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getPool } from './db.js';
import workspaces from './routes/workspaces.js';
import submissions from './routes/submissions.js';
import leaderboard from './routes/leaderboard.js';
import { TokenBucketStrategy, SlidingWindowLogStrategy, rateLimit } from './rateLimiter.js';

const app = express();
const server = createServer(app);
const sockets = new WebSocketServer({ noServer: true });
const rooms = new Map();
const generalLimiter = new TokenBucketStrategy({ capacity: 120, refillPerSecond: 2 });
const submissionLimiter = new SlidingWindowLogStrategy({ limit: 8, windowMs: 60000 });
const root = path.dirname(fileURLToPath(import.meta.url));

app.disable('x-powered-by');
app.use(express.json({ limit: '256kb' }));
app.use('/api', rateLimit(generalLimiter));
app.use('/api/submissions', rateLimit(submissionLimiter));
app.set('broadcast', (message) => {
  const encoded = JSON.stringify(message);
  for (const client of sockets.clients) if (client.readyState === 1) client.send(encoded);
});
app.set('broadcastRoom', (roomId, message, clientId) => roomBroadcast(String(roomId), message, null, clientId));
app.use('/api/workspaces', workspaces);
app.use('/api/submissions', submissions);
app.use('/api/leaderboard', leaderboard);
app.use(express.static(path.resolve(root, '../public')));
app.use((error, _req, res, _next) => {
  console.error(`Request failed: ${error.message}`);
  res.status(error.status || 500).json({ error: error.status ? error.message : 'Internal server error' });
});

server.on('upgrade', (req, socket, head) => {
  const url = new URL(req.url, 'http://localhost');
  const roomId = url.searchParams.get('room');
  const clientId = url.searchParams.get('clientId') || '';
  if (url.pathname !== '/ws' || !/^\d+$/.test(roomId || '') || !/^[\w-]{1,64}$/.test(clientId)) {
    socket.destroy();
    return;
  }
  sockets.handleUpgrade(req, socket, head, (ws) => {
    ws.roomId = roomId;
    ws.clientId = clientId;
    sockets.emit('connection', ws);
  });
});

function roomBroadcast(roomId, message, except, exceptClientId) {
  const room = rooms.get(roomId);
  if (!room) return;
  const encoded = JSON.stringify(message);
  for (const client of room) {
    if (client !== except && (!exceptClientId || client.clientId !== exceptClientId) && client.readyState === 1) client.send(encoded);
  }
}

function sendPresence(roomId) {
  const room = rooms.get(roomId);
  roomBroadcast(roomId, { type: 'presence', count: room?.size || 0 });
}

sockets.on('connection', (ws) => {
  const roomId = ws.roomId;
  if (!rooms.has(roomId)) rooms.set(roomId, new Set());
  rooms.get(roomId).add(ws);
  sendPresence(roomId);
  ws.on('message', (buffer) => {
    if (buffer.length > 100000) return ws.close(1009, 'Message too large');
    let message;
    try { message = JSON.parse(buffer.toString()); } catch { return; }
    if (message.type === 'edit' && typeof message.code === 'string' && message.code.length <= 90000) {
      roomBroadcast(roomId, { type: 'edit', code: message.code, clientId: ws.clientId }, ws);
    }
  });
  ws.on('close', () => {
    const room = rooms.get(roomId);
    room?.delete(ws);
    if (room?.size === 0) rooms.delete(roomId);
    sendPresence(roomId);
  });
});

const port = Number(process.env.PORT || 3000);
server.listen(port, () => console.log(`CodeSync listening on http://localhost:${port}`));

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, async () => {
    sockets.close();
    server.close();
    await getPool().end().catch(() => {});
    process.exit(0);
  });
}
