const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { WebSocket, WebSocketServer } = require('ws');

const PORT = Number(process.env.PORT || 3000);
const PUBLIC_DIR = path.join(__dirname, 'public');
const PROFILE_FILE = path.join(__dirname, 'leaderboard.json');
const WIDTH = 1000;
const HEIGHT = 600;
const PADDLE_HEIGHT = 112;
const PADDLE_WIDTH = 14;
const BALL_RADIUS = 10;
const WIN_SCORE = 7;
const MAX_CONNECTIONS = 80;
const profiles = loadProfiles();
const clients = new Set();
const queue = [];
const rooms = new Set();

function loadProfiles() {
  try {
    const saved = JSON.parse(fs.readFileSync(PROFILE_FILE, 'utf8'));
    return new Map(Object.entries(saved));
  } catch {
    return new Map();
  }
}

function saveProfiles() {
  try {
    fs.writeFileSync(PROFILE_FILE, JSON.stringify(Object.fromEntries(profiles), null, 2));
  } catch (error) {
    console.error('Could not save leaderboard:', error.message);
  }
}

function cleanName(value) {
  const name = String(value || '').replace(/[<>\u0000-\u001f]/g, '').trim().slice(0, 18);
  return name || 'Player';
}

function profileSummary(profile) {
  return { id: profile.id, name: profile.name, rating: profile.rating, wins: profile.wins, losses: profile.losses };
}

function leaderboard() {
  return [...profiles.values()]
    .sort((first, second) => second.rating - first.rating || second.wins - first.wins)
    .slice(0, 10)
    .map(profileSummary);
}

function send(client, data) {
  if (client.socket.readyState === WebSocket.OPEN) client.socket.send(JSON.stringify(data));
}

function broadcastQueue() {
  const status = { type: 'queue', waiting: queue.length };
  for (const client of queue) send(client, status);
}

function broadcastPresence() {
  const status = { type: 'presence', online: clients.size };
  for (const client of clients) send(client, status);
}

function removeFromQueue(client) {
  const index = queue.indexOf(client);
  if (index !== -1) queue.splice(index, 1);
}

function resetBall(room, direction) {
  const angle = Math.random() * 0.5 - 0.25;
  room.ball = { x: WIDTH / 2, y: HEIGHT / 2, vx: Math.cos(angle) * 440 * direction, vy: Math.sin(angle) * 440, speed: 440 };
}

function sendState(room) {
  const state = {
    type: 'state', leftY: room.left.paddleY, rightY: room.right.paddleY,
    ball: { x: room.ball.x, y: room.ball.y }, leftScore: room.leftScore,
    rightScore: room.rightScore, target: WIN_SCORE,
  };
  send(room.left, state);
  send(room.right, state);
}

function finishMatch(room, winner, reason) {
  if (room.finished) return;
  room.finished = true;
  const loser = winner === room.left ? room.right : room.left;
  const winnerProfile = winner.profile;
  const loserProfile = loser.profile;
  const expectedWinner = 1 / (1 + 10 ** ((loserProfile.rating - winnerProfile.rating) / 400));
  const winnerChange = Math.max(8, Math.round(32 * (1 - expectedWinner)));
  const loserChange = -Math.max(8, Math.round(32 * expectedWinner));
  winnerProfile.rating += winnerChange;
  loserProfile.rating = Math.max(100, loserProfile.rating + loserChange);
  winnerProfile.wins += 1;
  loserProfile.losses += 1;
  saveProfiles();

  const result = { type: 'match-end', winnerId: winner.id, reason, winnerChange, loserChange, profile: null, leaderboard: leaderboard() };
  send(winner, { ...result, profile: profileSummary(winnerProfile) });
  send(loser, { ...result, profile: profileSummary(loserProfile) });
  winner.room = null;
  loser.room = null;
  rooms.delete(room);
}

function startMatch(first, second) {
  removeFromQueue(first);
  removeFromQueue(second);
  const room = { left: first, right: second, leftScore: 0, rightScore: 0, ball: {}, finished: false, lastTick: Date.now(), lastBroadcast: 0 };
  first.room = room;
  second.room = room;
  first.side = 'left';
  second.side = 'right';
  first.paddleY = second.paddleY = 0.5;
  first.input = { up: false, down: false, pointer: false, targetY: 0.5 };
  second.input = { up: false, down: false, pointer: false, targetY: 0.5 };
  resetBall(room, Math.random() < 0.5 ? -1 : 1);
  rooms.add(room);
  send(first, { type: 'match', side: 'left', opponent: profileSummary(second.profile), target: WIN_SCORE });
  send(second, { type: 'match', side: 'right', opponent: profileSummary(first.profile), target: WIN_SCORE });
  broadcastQueue();
}

function findMatches() {
  while (queue.length > 1) {
    const oldest = queue[0];
    let bestIndex = -1;
    let smallestGap = Infinity;
    for (let index = 1; index < queue.length; index += 1) {
      const candidate = queue[index];
      const waitSeconds = (Date.now() - Math.min(oldest.queuedAt, candidate.queuedAt)) / 1000;
      const allowedGap = Math.min(800, 100 + waitSeconds * 35);
      const gap = Math.abs(oldest.profile.rating - candidate.profile.rating);
      if (gap <= allowedGap && gap < smallestGap) {
        smallestGap = gap;
        bestIndex = index;
      }
    }
    if (bestIndex === -1) break;
    startMatch(oldest, queue[bestIndex]);
  }
}

function updatePaddle(client, deltaSeconds) {
  const input = client.input;
  if (input.pointer) {
    client.paddleY = Math.max(PADDLE_HEIGHT / 2 / HEIGHT, Math.min(1 - PADDLE_HEIGHT / 2 / HEIGHT, input.targetY));
    return;
  }
  const direction = Number(input.down) - Number(input.up);
  client.paddleY = Math.max(PADDLE_HEIGHT / 2 / HEIGHT, Math.min(1 - PADDLE_HEIGHT / 2 / HEIGHT, client.paddleY + direction * 1.25 * deltaSeconds));
}

function stepRoom(room, now) {
  if (room.finished) return;
  const deltaSeconds = Math.min((now - room.lastTick) / 1000, 0.04);
  room.lastTick = now;
  updatePaddle(room.left, deltaSeconds);
  updatePaddle(room.right, deltaSeconds);
  const ball = room.ball;
  const previousX = ball.x;
  const previousY = ball.y;
  ball.x += ball.vx * deltaSeconds;
  ball.y += ball.vy * deltaSeconds;
  if (ball.y - BALL_RADIUS <= 0 || ball.y + BALL_RADIUS >= HEIGHT) {
    ball.y = Math.max(BALL_RADIUS, Math.min(HEIGHT - BALL_RADIUS, ball.y));
    ball.vy *= -1;
  }

  const leftX = 40;
  const rightX = WIDTH - 40 - PADDLE_WIDTH;
  const leftTop = room.left.paddleY * HEIGHT - PADDLE_HEIGHT / 2;
  const rightTop = room.right.paddleY * HEIGHT - PADDLE_HEIGHT / 2;
  let hitPaddle = false;
  const leftPlane = leftX + PADDLE_WIDTH + BALL_RADIUS;
  const rightPlane = rightX - BALL_RADIUS;
  if (ball.vx < 0 && previousX >= leftPlane && ball.x <= leftPlane) {
    const impactTime = (previousX - leftPlane) / (previousX - ball.x);
    const impactY = previousY + (ball.y - previousY) * impactTime;
    if (impactY >= leftTop - BALL_RADIUS && impactY <= leftTop + PADDLE_HEIGHT + BALL_RADIUS) {
      ball.x = leftPlane;
      ball.y = impactY;
      hitPaddle = true;
      const offset = (impactY - (leftTop + PADDLE_HEIGHT / 2)) / (PADDLE_HEIGHT / 2);
      ball.vx = Math.abs(ball.vx);
      ball.vy = offset * 520;
    }
  } else if (ball.vx > 0 && previousX <= rightPlane && ball.x >= rightPlane) {
    const impactTime = (rightPlane - previousX) / (ball.x - previousX);
    const impactY = previousY + (ball.y - previousY) * impactTime;
    if (impactY >= rightTop - BALL_RADIUS && impactY <= rightTop + PADDLE_HEIGHT + BALL_RADIUS) {
      ball.x = rightPlane;
      ball.y = impactY;
      hitPaddle = true;
      const offset = (impactY - (rightTop + PADDLE_HEIGHT / 2)) / (PADDLE_HEIGHT / 2);
      ball.vx = -Math.abs(ball.vx);
      ball.vy = offset * 520;
    }
  }
  if (hitPaddle) {
    ball.speed = Math.min(900, ball.speed * 1.045);
    const horizontalSpeed = Math.sqrt(Math.max(120 * 120, ball.speed * ball.speed - ball.vy * ball.vy));
    ball.vx = Math.sign(ball.vx) * horizontalSpeed;
  }

  if (ball.x < -BALL_RADIUS) {
    room.rightScore += 1;
    if (room.rightScore >= WIN_SCORE) return finishMatch(room, room.right, 'score');
    resetBall(room, -1);
  } else if (ball.x > WIDTH + BALL_RADIUS) {
    room.leftScore += 1;
    if (room.leftScore >= WIN_SCORE) return finishMatch(room, room.left, 'score');
    resetBall(room, 1);
  }
  if (now - room.lastBroadcast >= 33) {
    room.lastBroadcast = now;
    sendState(room);
  }
}

function handleMessage(client, raw) {
  let message;
  try { message = JSON.parse(raw.toString()); } catch { return; }
  if (message.type === 'hello') {
    const id = String(message.id || '');
    if (!/^[a-zA-Z0-9-]{8,64}$/.test(id)) return client.socket.close(1008, 'Invalid player id');
    if (client.profile && client.id !== id) return;
    let profile = profiles.get(id);
    if (!profile) {
      profile = { id, name: cleanName(message.name), rating: 1000, wins: 0, losses: 0 };
      profiles.set(id, profile);
    } else profile.name = cleanName(message.name || profile.name);
    client.id = id;
    client.profile = profile;
    saveProfiles();
    send(client, { type: 'welcome', profile: profileSummary(profile), leaderboard: leaderboard() });
    return;
  }
  if (!client.profile) return;
  broadcastPresence();
  if (message.type === 'queue') {
    if (client.room) return;
    if (!queue.includes(client)) {
      client.queuedAt = Date.now();
      queue.push(client);
      findMatches();
      broadcastQueue();
    }
  } else if (message.type === 'leave-queue') {
    removeFromQueue(client);
    broadcastQueue();
  } else if (message.type === 'input' && client.room && !client.room.finished) {
    const input = client.input;
    input.up = Boolean(message.up);
    input.down = Boolean(message.down);
    if (Number.isFinite(message.y)) {
      input.pointer = true;
      input.targetY = Math.max(0, Math.min(1, message.y));
    } else if (message.up || message.down) input.pointer = false;
  }
}

function serveStatic(request, response) {
  const pathname = new URL(request.url, 'http://localhost').pathname;
  if (pathname === '/health') {
    response.writeHead(200, { 'Content-Type': 'application/json' });
    return response.end(JSON.stringify({ ok: true, online: clients.size, matches: rooms.size }));
  }
  let filePath;
  try {
    const relative = decodeURIComponent(pathname === '/' ? '/index.html' : pathname);
    filePath = path.resolve(PUBLIC_DIR, `.${relative}`);
  } catch {
    response.writeHead(400).end('Bad request');
    return;
  }
  if (!filePath.startsWith(`${PUBLIC_DIR}${path.sep}`) || !fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
    response.writeHead(404).end('Not found');
    return;
  }
  const contentTypes = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8' };
  response.writeHead(200, { 'Content-Type': contentTypes[path.extname(filePath)] || 'application/octet-stream' });
  fs.createReadStream(filePath).pipe(response);
}

const server = http.createServer(serveStatic);
const webSockets = new WebSocketServer({ noServer: true, maxPayload: 1024 });
server.on('upgrade', (request, socket, head) => {
  if (new URL(request.url, 'http://localhost').pathname !== '/game') return socket.destroy();
  webSockets.handleUpgrade(request, socket, head, (webSocket) => webSockets.emit('connection', webSocket, request));
});

webSockets.on('connection', (socket) => {
  if (clients.size >= MAX_CONNECTIONS) {
    socket.close(1013, 'Server is full');
    return;
  }
  const client = { socket, id: null, profile: null, room: null, paddleY: 0.5,
    input: { up: false, down: false, pointer: false, targetY: 0.5 }, isAlive: true };
  clients.add(client);
  socket.on('pong', () => { client.isAlive = true; });
  socket.on('message', (data) => handleMessage(client, data));
  socket.on('close', () => {
    clients.delete(client);
    broadcastPresence();
    removeFromQueue(client);
    broadcastQueue();
    if (client.room && !client.room.finished) {
      const opponent = client.room.left === client ? client.room.right : client.room.left;
      finishMatch(client.room, opponent, 'disconnect');
    }
  });
  socket.on('error', () => {});
});

setInterval(() => {
  const now = Date.now();
  for (const room of rooms) stepRoom(room, now);
}, 16);
setInterval(() => {
  for (const client of clients) {
    if (!client.isAlive) {
      client.socket.terminate();
      continue;
    }
    client.isAlive = false;
    client.socket.ping();
  }
}, 30000);

server.listen(PORT, '0.0.0.0', () => console.log(`Rally Ranked listening on http://0.0.0.0:${PORT}`));
