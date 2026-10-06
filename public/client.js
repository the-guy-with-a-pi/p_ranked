const canvas = document.querySelector('#court');
const context = canvas.getContext('2d');
const queueButton = document.querySelector('#queue-button');
const notice = document.querySelector('#notice');
const leaderboardElement = document.querySelector('#leaderboard');
const accountButton = document.querySelector('#account-button');
const accountDialog = document.querySelector('#account-dialog');
const authForm = document.querySelector('#auth-form');
const authNotice = document.querySelector('#auth-notice');
let account = null;
let authMode = 'login';

const state = {
  socket: null, connected: false, queued: false, playing: false,
  leftY: 0.5, rightY: 0.5, ball: { x: 500, y: 300 }, leftScore: 0, rightScore: 0,
  ballVelocity: { x: 0, y: 0 }, stateReceivedAt: 0, pointerY: null,
  keys: { up: false, down: false }, profile: null,
};
let drawRequested = false;

function requestCourtDraw() {
  if (drawRequested) return;
  drawRequested = true;
  requestAnimationFrame(drawCourt);
}

function setNotice(message) { notice.textContent = message; }

function updateProfile(profile) {
  if (!profile) return;
  state.profile = profile;
  document.querySelector('#player-rating').textContent = profile.rating;
  document.querySelector('#wins').textContent = profile.wins;
  document.querySelector('#losses').textContent = profile.losses;
  const total = profile.wins + profile.losses;
  const winRate = total ? Math.round(profile.wins / total * 100) : 0;
  document.querySelector('#win-rate').textContent = `${winRate}%`;
  document.querySelector('#record-track-fill').style.width = `${winRate}%`;
}

function renderLeaderboard(entries = []) {
  leaderboardElement.replaceChildren();
  if (!entries.length) {
    const empty = document.createElement('li');
    empty.className = 'empty-ladder';
    const headline = document.createElement('strong');
    headline.textContent = 'No ranked players yet.';
    const subline = document.createElement('span');
    subline.textContent = 'Be the first on court.';
    empty.append(headline, subline);
    leaderboardElement.append(empty);
    return;
  }
  for (const [index, player] of entries.entries()) {
    const row = document.createElement('li');
    row.className = 'ladder-row';
    row.style.animationDelay = `${index * 35}ms`;
    const identity = document.createElement('span');
    identity.className = 'ladder-player';
    const rank = document.createElement('span');
    rank.className = 'ladder-rank';
    rank.textContent = String(index + 1).padStart(2, '0');
    const name = document.createElement('span');
    name.className = 'ladder-name';
    name.textContent = player.name;
    identity.append(rank, name);
    const record = document.createElement('span');
    record.className = 'ladder-record';
    record.textContent = `${player.wins}–${player.losses}`;
    const rating = document.createElement('span');
    rating.className = 'ladder-rating';
    rating.textContent = player.rating;
    row.append(identity, record, rating);
    leaderboardElement.append(row);
  }
}

function setConnection(connected) {
  state.connected = connected;
  document.querySelector('#connection-dot').classList.toggle('online', connected);
  document.querySelector('#connection-label').textContent = connected ? 'CONNECTED' : account ? 'RECONNECTING' : 'SIGNED OUT';
  queueButton.disabled = !connected || !account;
}

function connect() {
  if (!account) return;
  const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
  const socket = new WebSocket(`${protocol}//${location.host}/game`);
  state.socket = socket;
  socket.addEventListener('open', () => {
    if (socket !== state.socket) return;
    setConnection(true);
    socket.send(JSON.stringify({ type: 'hello' }));
  });
  socket.addEventListener('message', (event) => {
    const message = JSON.parse(event.data);
    if (message.type === 'welcome') {
      updateProfile(message.profile);
      renderLeaderboard(message.leaderboard);
      setNotice(`Ready when you are, ${message.profile.name}.`);
    } else if (message.type === 'presence') {
      document.querySelector('#online-count').textContent = String(message.online);
    } else if (message.type === 'queue') {
      if (state.queued) setNotice(message.waiting > 1 ? `${message.waiting} players looking for a match.` : 'You’re on the court list. Finding a rival…');
    } else if (message.type === 'match') {
      state.queued = false;
      state.playing = true;
      state.leftScore = 0;
      state.rightScore = 0;
      state.pointerY = null;
      state.ballVelocity = { x: 0, y: 0 };
      state.stateReceivedAt = performance.now();
      queueButton.disabled = true;
      queueButton.classList.remove('searching');
      queueButton.querySelector('span:nth-child(2)').textContent = 'Match in progress';
      document.querySelector('#match-label').textContent = 'RANKED MATCH · LIVE';
      document.querySelector('#opponent-label').textContent = message.opponent.name.toUpperCase();
      document.querySelector('#left-score').textContent = '0';
      document.querySelector('#right-score').textContent = '0';
      setNotice(`Matched with ${message.opponent.name} · ${message.opponent.rating} rating. First to ${message.target}.`);
      canvas.focus({ preventScroll: true });
      requestCourtDraw();
    } else if (message.type === 'state') {
      const receivedAt = performance.now();
      state.ballVelocity = { x: message.ball.vx, y: message.ball.vy };
      state.stateReceivedAt = receivedAt;
      state.leftY = message.leftY;
      state.rightY = message.rightY;
      state.ball = message.ball;
      state.leftScore = message.leftScore;
      state.rightScore = message.rightScore;
      document.querySelector('#left-score').textContent = message.leftScore;
      document.querySelector('#right-score').textContent = message.rightScore;
      requestCourtDraw();
    } else if (message.type === 'match-end') {
      state.playing = false;
      state.queued = false;
      state.pointerY = null;
      updateProfile(message.profile);
      renderLeaderboard(message.leaderboard);
      document.querySelector('#match-label').textContent = 'RANKED MATCH';
      queueButton.disabled = false;
      queueButton.querySelector('span:nth-child(2)').textContent = 'Find ranked match';
      queueButton.classList.remove('searching');
      const won = message.winnerId === state.profile?.id;
      setNotice(message.reason === 'disconnect'
        ? (won ? `Your rival disconnected. +${message.winnerChange} rating.` : 'You disconnected from the match. This loss counted toward your rating.')
        : (won ? `Match won. +${message.winnerChange} rating. Run it back?` : `Match lost. ${message.loserChange} rating. Ready for another?`));
      if (won) document.querySelector('#match-label').textContent = 'VICTORY';
      requestCourtDraw();
    }
  });
  socket.addEventListener('close', () => {
    if (socket !== state.socket) return;
    state.socket = null;
    setConnection(false);
    state.queued = false;
    state.playing = false;
    queueButton.classList.remove('searching');
    queueButton.querySelector('span:nth-child(2)').textContent = 'Find ranked match';
    setNotice('Connection lost. Reconnecting…');
    if (account) window.setTimeout(connect, 1500);
  });
  socket.addEventListener('error', () => socket.close());
}

function sendInput(input) {
  if (state.socket?.readyState === WebSocket.OPEN && state.playing) {
    state.socket.send(JSON.stringify({ type: 'input', ...input }));
  }
}

queueButton.addEventListener('click', () => {
  if (!state.connected || !state.socket) return;
  if (state.queued) {
    state.socket.send(JSON.stringify({ type: 'leave-queue' }));
    state.queued = false;
    requestCourtDraw();
    queueButton.classList.remove('searching');
    queueButton.querySelector('span:nth-child(2)').textContent = 'Find ranked match';
    setNotice('Matchmaking cancelled.');
  } else if (!state.playing) {
    state.socket.send(JSON.stringify({ type: 'hello' }));
    state.socket.send(JSON.stringify({ type: 'queue' }));
    state.queued = true;
    requestCourtDraw();
    queueButton.classList.add('searching');
    queueButton.querySelector('span:nth-child(2)').textContent = 'Cancel matchmaking';
    setNotice('You’re on the court list. Finding a rival…');
  }
});

function keyInput(event, isDown) {
  const key = event.key.toLowerCase();
  const direction = key === 'w' || key === 'arrowup' ? 'up' : key === 's' || key === 'arrowdown' ? 'down' : null;
  if (!direction) return;
  event.preventDefault();
  state.keys[direction] = isDown;
  if (isDown) state.pointerY = null;
  sendInput({ up: state.keys.up, down: state.keys.down });
  requestCourtDraw();
}

function setAuthMode(mode) {
  authMode = mode;
  for (const button of document.querySelectorAll('[data-auth-mode]')) {
    button.classList.toggle('selected', button.dataset.authMode === mode);
  }
  document.querySelector('#account-title').textContent = mode === 'login' ? 'Back to the court.' : 'Claim your handle.';
  document.querySelector('#auth-password').autocomplete = mode === 'login' ? 'current-password' : 'new-password';
  document.querySelector('#auth-hint').textContent = mode === 'login'
    ? 'Use your username and password to continue.'
    : 'Username: 3–18 letters, numbers, or underscores. Password: at least 10 characters.';
  document.querySelector('#auth-submit').firstChild.textContent = mode === 'login' ? 'Sign in ' : 'Create account ';
  authNotice.textContent = '';
}

function updateAccountInterface() {
  const authFields = document.querySelector('#auth-fields');
  const accountStatus = document.querySelector('#account-status');
  authFields.hidden = Boolean(account);
  accountStatus.hidden = !account;
  accountButton.textContent = account ? account.username : 'SIGN IN';
  accountButton.classList.toggle('signed-in', Boolean(account));
  document.querySelector('#player-name').textContent = account?.username || 'GUEST';
  if (account) document.querySelector('#account-username').textContent = account.username;
  queueButton.disabled = !state.connected || !account;
}

for (const button of document.querySelectorAll('[data-auth-mode]')) {
  button.addEventListener('click', () => setAuthMode(button.dataset.authMode));
}

accountButton.addEventListener('click', () => {
  authNotice.textContent = '';
  if (!account) setAuthMode('login');
  updateAccountInterface();
  accountDialog.showModal();
});
document.querySelector('#account-close').addEventListener('click', () => accountDialog.close());
accountDialog.addEventListener('click', (event) => {
  if (event.target === accountDialog) accountDialog.close();
});

authForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const submit = document.querySelector('#auth-submit');
  submit.disabled = true;
  authNotice.textContent = '';
  try {
    const response = await fetch(`/api/${authMode === 'login' ? 'login' : 'register'}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username: document.querySelector('#auth-username').value,
        password: document.querySelector('#auth-password').value,
      }),
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || 'Could not sign in.');
    account = result.account;
    updateAccountInterface();
    updateProfile(account.profile);
    accountDialog.close();
    authForm.reset();
    connect();
  } catch (error) {
    authNotice.textContent = error.message;
  } finally {
    submit.disabled = false;
  }
});

document.querySelector('#signout-button').addEventListener('click', async () => {
  try { await fetch('/api/logout', { method: 'POST' }); } catch {}
  account = null;
  state.playing = false;
  state.queued = false;
  const socket = state.socket;
  state.socket = null;
  if (socket) socket.close();
  setConnection(false);
  updateAccountInterface();
  document.querySelector('#player-rating').textContent = '—';
  document.querySelector('#wins').textContent = '0';
  document.querySelector('#losses').textContent = '0';
  document.querySelector('#win-rate').textContent = '—%';
  document.querySelector('#record-track-fill').style.width = '0';
  accountDialog.close();
  setNotice('Sign in to play ranked matches.');
});

async function restoreAccount() {
  try {
    const response = await fetch('/api/me');
    if (!response.ok) throw new Error('No active session.');
    const result = await response.json();
    account = result.account;
    updateAccountInterface();
    updateProfile(account.profile);
    connect();
  } catch {
    account = null;
    updateAccountInterface();
    setConnection(false);
    setNotice('Sign in or create an account to play ranked matches.');
  }
}
window.addEventListener('keydown', (event) => keyInput(event, true));
window.addEventListener('keyup', (event) => keyInput(event, false));
window.addEventListener('blur', () => {
  state.keys.up = false;
  state.keys.down = false;
  sendInput({ up: false, down: false });
});
canvas.addEventListener('pointermove', (event) => {
  if (!state.playing) return;
  const bounds = canvas.getBoundingClientRect();
  const halfPaddle = 56 / canvas.height;
  state.pointerY = Math.max(halfPaddle, Math.min(1 - halfPaddle, (event.clientY - bounds.top) / bounds.height));
  sendInput({ y: state.pointerY });
  requestCourtDraw();
});

function predictBall(age, ownPaddleCenter) {
  let x = state.ball.x;
  let y = state.ball.y;
  const vx = state.ballVelocity.x;
  const vy = state.ballVelocity.y;
  const nextX = x + vx * age;
  const nextY = y + vy * age;
  const leftPlane = 64;
  const rightPlane = 936;
  const leftCenter = ownPaddleCenter;
  const rightCenter = state.rightY * canvas.height;

  let plane;
  let paddleCenter;
  if (vx < 0 && x >= leftPlane && nextX <= leftPlane) {
    plane = leftPlane;
    paddleCenter = leftCenter;
  } else if (vx > 0 && x <= rightPlane && nextX >= rightPlane) {
    plane = rightPlane;
    paddleCenter = rightCenter;
  } else {
    return { x: nextX, y: nextY };
  }

  const impactTime = (plane - x) / vx;
  const impactY = y + vy * impactTime;
  if (impactY < paddleCenter - 66 || impactY > paddleCenter + 66) return { x: nextX, y: nextY };

  const offset = (impactY - paddleCenter) / 56;
  const speed = Math.min(900, Math.hypot(vx, vy) * 1.045);
  const reflectedVY = offset * 520;
  const reflectedVX = Math.sqrt(Math.max(120 * 120, speed * speed - reflectedVY * reflectedVY)) * (plane === leftPlane ? 1 : -1);
  const remainingTime = age - impactTime;
  return {
    x: plane + reflectedVX * remainingTime,
    y: impactY + reflectedVY * remainingTime,
  };
}

function drawCourt() {
  drawRequested = false;
  const width = canvas.width;
  const height = canvas.height;
  context.clearRect(0, 0, width, height);
  context.fillStyle = '#202623';
  context.fillRect(0, 0, width, height);
  context.strokeStyle = 'rgba(228, 236, 231, .12)';
  context.lineWidth = 2;
  context.setLineDash([9, 12]);
  context.beginPath();
  context.moveTo(width / 2, 18);
  context.lineTo(width / 2, height - 18);
  context.stroke();
  context.setLineDash([]);

  const elapsed = state.stateReceivedAt ? Math.min((performance.now() - state.stateReceivedAt) / 1000, 0.04) : 0;
  const ownPaddleY = state.leftY;
  const keyboardDirection = Number(state.keys.down) - Number(state.keys.up);
  const halfPaddle = 56 / height;
  const localPaddleY = Math.max(halfPaddle, Math.min(1 - halfPaddle, state.pointerY ?? ownPaddleY + keyboardDirection * 1.25 * elapsed)) * height;
  const yourPaddleY = localPaddleY;
  const rivalPaddleY = state.rightY * height;
  const yourX = 40;
  const rivalX = width - 54;
  context.fillStyle = '#d1f35a';
  context.fillRect(yourX, yourPaddleY - 56, 14, 112);
  context.fillStyle = '#fa6d51';
  context.fillRect(rivalX, rivalPaddleY - 56, 14, 112);
  const ballAge = state.playing ? Math.min(elapsed, 0.04) : 0;
  const predictedBall = predictBall(ballAge, localPaddleY);
  const predictedBallX = Math.max(10, Math.min(width - 10, predictedBall.x));
  const predictedBallY = Math.max(10, Math.min(height - 10, predictedBall.y));
  const ballX = predictedBallX;
  context.fillStyle = '#f0f4f1';
  context.beginPath();
  context.arc(ballX, predictedBallY, 10, 0, Math.PI * 2);
  context.fill();
  if (!state.playing) {
    context.fillStyle = 'rgba(239, 244, 240, .67)';
    context.textAlign = 'center';
    context.font = '500 15px "DM Mono", monospace';
    context.fillText(state.queued ? 'WAITING FOR A RIVAL' : 'RALLY STARTS HERE', width / 2, height / 2 + 66);
  }
  if (state.playing) requestCourtDraw();
}

renderLeaderboard();
requestCourtDraw();
restoreAccount();
