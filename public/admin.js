const playersBody = document.querySelector('#players-body');
const searchInput = document.querySelector('#search');
const notice = document.querySelector('#notice');
let users = [];

function showNotice(message, isError = false) {
  notice.textContent = message;
  notice.classList.toggle('error', isError);
}

function createCell(className = '') {
  const cell = document.createElement('td');
  if (className) cell.className = className;
  return cell;
}

function renderUsers() {
  const query = searchInput.value.trim().toLowerCase();
  const filtered = users.filter((user) => user.username.toLowerCase().includes(query));
  playersBody.replaceChildren();
  document.querySelector('#player-count').textContent = users.length;
  document.querySelector('#banned-count').textContent = users.filter((user) => user.banned).length;
  document.querySelector('#updated-at').textContent = `Updated ${new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;

  if (!filtered.length) {
    const row = document.createElement('tr');
    const cell = createCell('empty-row');
    cell.colSpan = 6;
    cell.textContent = users.length ? 'No matching players.' : 'No registered players yet.';
    row.append(cell);
    playersBody.append(row);
    return;
  }

  for (const user of filtered) {
    const row = document.createElement('tr');
    const playerCell = createCell();
    const player = document.createElement('div');
    player.className = 'player-cell';
    const name = document.createElement('strong');
    name.textContent = user.username;
    const id = document.createElement('span');
    id.textContent = user.id;
    player.append(name, id);
    playerCell.append(player);

    const rankCell = createCell();
    const rank = document.createElement('span');
    rank.className = 'rank-label';
    rank.dataset.rank = user.rank.name.toLowerCase();
    rank.textContent = user.rank.name;
    rankCell.append(rank);

    const rating = createCell();
    rating.textContent = user.rating;
    const record = createCell();
    record.textContent = `${user.wins}–${user.losses}`;
    const accountCell = createCell();
    const status = document.createElement('span');
    status.className = `account-state${user.banned ? ' banned' : ''}`;
    status.textContent = user.banned ? 'BANNED' : 'ACTIVE';
    accountCell.append(status);

    const actionsCell = createCell();
    const actions = document.createElement('div');
    actions.className = 'actions';
    const amount = document.createElement('input');
    amount.className = 'delta-input';
    amount.type = 'number';
    amount.min = '1';
    amount.max = '10000';
    amount.step = '25';
    amount.value = '25';
    amount.setAttribute('aria-label', `Elo amount for ${user.username}`);
    const removeElo = document.createElement('button');
    removeElo.className = 'icon-action';
    removeElo.type = 'button';
    removeElo.textContent = '−';
    removeElo.title = `Remove Elo from ${user.username}`;
    removeElo.setAttribute('aria-label', removeElo.title);
    removeElo.addEventListener('click', () => changeElo(user, -Number(amount.value)));
    const addElo = document.createElement('button');
    addElo.className = 'icon-action';
    addElo.type = 'button';
    addElo.textContent = '+';
    addElo.title = `Add Elo to ${user.username}`;
    addElo.setAttribute('aria-label', addElo.title);
    addElo.addEventListener('click', () => changeElo(user, Number(amount.value)));
    const ban = document.createElement('button');
    ban.className = `ban-button${user.banned ? ' banned' : ''}`;
    ban.type = 'button';
    ban.textContent = user.banned ? 'UNBAN' : 'BAN';
    ban.addEventListener('click', () => setBanned(user, !user.banned));
    actions.append(amount, removeElo, addElo, ban);
    actionsCell.append(actions);

    row.append(playerCell, rankCell, rating, record, accountCell, actionsCell);
    playersBody.append(row);
  }
}

async function requestJson(url, options) {
  const response = await fetch(url, options);
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || `Request failed (${response.status}).`);
  return result;
}

async function loadUsers() {
  const result = await requestJson('/api/users');
  users = result.users;
  renderUsers();
}

async function changeElo(user, delta) {
  if (!Number.isSafeInteger(delta) || delta === 0 || Math.abs(delta) > 10000) {
    return showNotice('Enter a whole Elo amount from 1 to 10000.', true);
  }
  try {
    const result = await requestJson(`/api/users/${user.id}/elo`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ delta }),
    });
    await loadUsers();
    const actual = result.actualDelta;
    showNotice(`${user.username}: ${actual > 0 ? '+' : ''}${actual} Elo. New rating ${result.user.rating} (${result.user.rank.name}).`);
  } catch (error) { showNotice(error.message, true); }
}

async function setBanned(user, banned) {
  const action = banned ? 'ban' : 'unban';
  if (banned && !window.confirm(`Ban ${user.username}? Active matches will be forfeited.`)) return;
  try {
    await requestJson(`/api/users/${user.id}/ban`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ banned }),
    });
    await loadUsers();
    showNotice(`${user.username} ${banned ? 'banned' : 'unbanned'}.`);
  } catch (error) { showNotice(error.message, true); }
}

document.querySelector('#refresh-button').addEventListener('click', () => {
  showNotice('');
  loadUsers().catch((error) => showNotice(error.message, true));
});
searchInput.addEventListener('input', renderUsers);
loadUsers().catch((error) => {
  playersBody.replaceChildren();
  const row = document.createElement('tr');
  const cell = createCell('empty-row');
  cell.colSpan = 6;
  cell.textContent = error.message;
  row.append(cell);
  playersBody.append(row);
  showNotice(error.message, true);
});
