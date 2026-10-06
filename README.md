# Rally Ranked

A lightweight ranked 1v1 Pong game. The Node.js server serves the browser client, pairs queued players by rating, simulates the match, and saves ratings and records in `leaderboard.json`.

## Run locally

```sh
npm install
npm start
```

Open [http://localhost:3000](http://localhost:3000). Join from a second browser or device on the same network to test matchmaking. The server binds to `0.0.0.0`; set `PORT` to change the port.

## Raspberry Pi and tunnel

Node.js 20 or newer is required. The server uses a single Node process and one small WebSocket dependency, with a soft limit of 80 connected sockets. Put a tunnel or reverse proxy in front of port 3000 and ensure it supports WebSocket upgrades at `/game`. HTTPS pages automatically use secure WebSockets.

This starter uses browser-generated player IDs and a local JSON leaderboard, not authenticated accounts. For a public ranked service, add real sign-in, abuse/rate controls, backups, and durable shared storage before treating ratings as authoritative; the JSON file assumes one server process and can be reset by deleting it.
