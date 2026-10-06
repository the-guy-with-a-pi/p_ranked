<img width="172" height="53" alt="image" src="https://github.com/user-attachments/assets/36e1f672-a133-4f79-9fac-df4063815c2e" />

# Rally Ranked

A lightweight ranked 1v1 Pong game. The Node.js server serves the browser client, pairs queued players by rating, simulates the match, and saves ratings and records in `leaderboard.json`.

## Run locally

```sh
npm install
npm start
```

Open [http://localhost:3000](http://localhost:3000), create an account, then join ranked matchmaking. Join from a second browser or device on the same network to play another account. The server binds to `0.0.0.0`; set `PORT` to change the port.

Accounts use a 3–18 character username and a 10–128 character password. Passwords are stored as scrypt hashes in `accounts.json`; ranked profiles remain in `leaderboard.json`. Signed HttpOnly sessions use the local `session.key` file and expire after 30 days. Keep `accounts.json`, `leaderboard.json`, and `session.key` backed up together; do not publish or commit them.

Set `DATA_DIR` to store those files outside the project directory, for example on a persistent drive mounted on the Pi. The directory is created automatically and should be writable by the Node process.

## Raspberry Pi and tunnel

Node.js 20 or newer is required. The server uses a single Node process and one small WebSocket dependency, with a soft limit of 80 connected sockets. Put a tunnel or reverse proxy in front of port 3000 and ensure it supports WebSocket upgrades at `/game`. HTTPS pages automatically use secure WebSockets.

The JSON account and leaderboard stores assume one server process. Auth endpoints have a basic per-IP attempt limit; for a larger public service, move the stores to a transactional database and add account recovery and operational monitoring. Keep the session key persistent across restarts. Behind HTTPS, the server marks session cookies `Secure` when the proxy sets `X-Forwarded-Proto: https`.
