![Rally Ranked](https://github.com/user-attachments/assets/36e1f672-a133-4f79-9fac-df4063815c2e)

# Rally Ranked

A lightweight ranked 1v1 Pong game. The Node.js server serves the browser client, pairs queued players by rating, simulates the match, and saves ratings and records in `leaderboard.json`.

## Run locally

```sh
npm install
npm start
```

Open [http://localhost:3000](http://localhost:3000), create an account, then join ranked matchmaking. Join from a second browser or device on the same network to play another account. The server binds to `0.0.0.0`; set `PORT` to change the port.

Accounts use a 3–18 character username and a 10–128 character password. Passwords are stored as scrypt hashes in `accounts.json`; ranked profiles remain in `leaderboard.json`. Signed HttpOnly sessions use `session.key` and expire after 30 days. The LAN admin app uses a separate random `admin.key`. Keep these files together in `DATA_DIR`, back them up together, and never publish or commit them.

Set `DATA_DIR` to store those files outside the project directory, for example on a persistent drive mounted on the Pi. The directory is created automatically and should be writable by the Node process.

## Raspberry Pi and tunnel

Node.js 20 or newer is required. The server uses a single Node process and one small WebSocket dependency, with a soft limit of 80 connected sockets. Put a tunnel or reverse proxy in front of port 3000 and ensure it supports WebSocket upgrades at `/game`. HTTPS pages automatically use secure WebSockets.

For a first install, clone the repository. For later updates, run the `git pull` command from inside the existing checkout:

```sh
git clone https://github.com/the-guy-with-a-pi/p_ranked.git
cd p_ranked
# Later updates, from this directory:
git pull --ff-only origin main
npm ci --omit=dev
```

Keep account data on a persistent directory outside the checkout:

```sh
export DATA_DIR=/var/lib/rally-ranked
sudo mkdir -p /var/lib/rally-ranked
sudo chown -R "$USER":"$(id -gn)" /var/lib/rally-ranked
```

Start the app with PM2 and save it for reboot recovery:

```sh
DATA_DIR="$DATA_DIR" PORT=3000 pm2 start server.js --name rally-ranked
DATA_DIR="$DATA_DIR" PORT=3000 GAME_ORIGIN=http://127.0.0.1:3000 ADMIN_PORT=3002 pm2 start admin-server.js --name rally-ranked-admin
pm2 save
pm2 startup
```

Open the admin panel at `http://<pi-lan-address>:3002`. It accepts private-network clients only. Do not put port 3002 behind the public tunnel or forward it through your router; expose only game port 3000. Run the command printed by `pm2 startup` once. After code updates, run `npm ci --omit=dev`, then restart both PM2 apps with `DATA_DIR="$DATA_DIR" PORT=3000 pm2 restart rally-ranked --update-env` and `DATA_DIR="$DATA_DIR" PORT=3000 GAME_ORIGIN=http://127.0.0.1:3000 ADMIN_PORT=3002 pm2 restart rally-ranked-admin --update-env`. Point the tunnel or reverse proxy to the Pi on port 3000 and preserve WebSocket upgrades.

The JSON account and leaderboard stores assume one server process. Auth endpoints have a basic per-IP attempt limit; for a larger public service, move the stores to a transactional database and add account recovery and operational monitoring. Keep the session key persistent across restarts. Behind HTTPS, the server marks session cookies `Secure` when the proxy sets `X-Forwarded-Proto: https`.
