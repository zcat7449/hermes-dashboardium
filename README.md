# Dashboardium

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Node.js](https://img.shields.io/badge/Node.js-20+-green.svg)](https://nodejs.org)
[![Hermes Agent](https://img.shields.io/badge/Hermes%20Agent-Compatible-blueviolet)](https://hermes-agent.nousresearch.com)

> **Hermes Profiles Dashboard** — real-time monitoring, chat, and Kanban task management for Hermes Agent profiles.

![Dashboardium Screenshot](screenshot.png)
*Dashboardium in action — real-time profile monitoring and Kanban management.*

---

## Features

- **Profile Monitoring** — View all active Hermes Agent profiles, their status, resource usage, and activity logs in real time.
- **Chat with Leaders** — Communicate with profile leaders directly from the dashboard via WebSocket.
- **Kanban Tasks** — Create, assign, and track tasks across Kanban boards integrated with Hermes profiles.
- **WebSocket Real-Time** — Live updates for profile state changes, new messages, and task transitions without page reloads.
- **i18n (RU / EN)** — Full Russian and English interface. Switch languages on the fly.
- **HTTP Basic Auth** — Simple, secure authentication via `AUTH_USERNAME` / `AUTH_PASSWORD` environment variables.
- **PostgreSQL (Optional)** — Session persistence and history storage when a database is configured.

---

## Installation

### Prerequisites

- [Node.js](https://nodejs.org) 20+
- [Hermes Agent](https://hermes-agent.nousresearch.com) installed and configured
- PostgreSQL (optional, for session persistence)

### Recommended: gbrain (Personal Knowledge Base)

Dashboardium works best with [gbrain](https://github.com/nousresearch/gbrain) — a personal knowledge base that stores project docs, QA reports, and deployment history. When gbrain is connected, the dashboard can surface relevant context from past work.

**Check if gbrain is already installed:**
```bash
curl -s http://localhost:7333/mcp/health 2>/dev/null && echo "✅ gbrain already running" || echo "❌ gbrain not found"
```

**If not installed, set it up:**
```bash
# See: https://github.com/nousresearch/gbrain#quick-start
```

**Then add to every Hermes profile config:**
```bash
for profile in default orchestrator backend frontend devops qa seo devsecops rag; do
  hermes config set mcp_servers.gbrain.url "http://localhost:7333/mcp" --profile "$profile"
  hermes config set mcp_servers.gbrain.headers.Authorization "Bearer your-gbrain-token" --profile "$profile"
  hermes config set mcp_servers.gbrain.timeout 60 --profile "$profile"
done
```

### Quick Start

```bash
# Clone the repository
git clone https://github.com/zcat7449/dashboardium.git
cd dashboardium

# Install backend dependencies
cd backend && npm install && cd ..

# Configure environment
cp .env.example .env
# Edit .env with your settings (see Configuration below)

# Enable pre-commit hooks (checks that new features have tests)
git config core.hooksPath .githooks

# Auto-configure gbrain for all Hermes profiles (recommended)
node setup.js

# Start the server
npm start
```

The dashboard will be available at **http://localhost:3010**.

---

## Configuration

All configuration is done via environment variables. Copy `.env.example` to `.env` and adjust as needed.

| Variable | Default | Description |
|---|---|---|
| `PORT` | `3010` | HTTP server port |
| `HOST` | `0.0.0.0` | Bind address |
| `AUTH_USERNAME` | `admin` | HTTP Basic Auth username |
| `AUTH_PASSWORD` | *(required)* | HTTP Basic Auth password |
| `PROFILES_DIR` | `$HOME/.hermes/profiles` | Path to Hermes profiles directory |
| `KANBAN_BOARDS_DIR` | `$HOME/.hermes/kanban/boards` | Path to Kanban boards directory |
| `HERMES_BIN` | `hermes` | Hermes CLI binary name or path |
| `DATABASE_URL` | *(optional)* | PostgreSQL connection string for session persistence |
| `FRONTEND_ORIGIN` | `http://localhost:3010` | Allowed CORS origin for the frontend |
| `TELEGRAM_TARGET` | `telegram` | Telegram forwarding target (optional) |

---

## Architecture

```
┌─────────────────────────────────────────────────────┐
│                    Browser                           │
│  (Vanilla JS + WebSocket Client + i18n)             │
└──────────────────────┬──────────────────────────────┘
                       │ HTTP / WebSocket
                       ▼
┌─────────────────────────────────────────────────────┐
│              Express Server (Node.js)                │
│  ┌──────────┐  ┌──────────┐  ┌──────────────────┐  │
│  │ Auth     │  │ REST API │  │ WebSocket Server  │  │
│  │ Middleware│  │ Routes   │  │ (ws)              │  │
│  └──────────┘  └──────────┘  └──────────────────┘  │
└──────────────────────┬──────────────────────────────┘
                       │
        ┌──────────────┼──────────────┐
        ▼              ▼              ▼
┌──────────────┐ ┌──────────┐ ┌──────────────┐
│ Hermes       │ │ Kanban   │ │ PostgreSQL   │
│ Profiles     │ │ Boards   │ │ (optional)   │
│ (File System)│ │ (SQLite) │ │              │
└──────────────┘ └──────────┘ └──────────────┘
```

- **Frontend**: Vanilla JavaScript served as static files. Communicates with the backend via REST and WebSocket.
- **Backend**: Express.js server with HTTP Basic Auth middleware, REST API routes, and a WebSocket server for real-time updates.
- **Data Sources**: Reads Hermes profiles from the filesystem, Kanban boards from SQLite files, and optionally persists sessions to PostgreSQL.

---

## Development

### Project Structure

```
dashboardium/
├── backend/
│   ├── server.js          # Express entry point
│   ├── routes/            # REST API route handlers
│   ├── websocket/         # WebSocket event handlers
│   ├── middleware/         # Auth and other middleware
│   ├── services/          # Business logic (profiles, kanban, etc.)
│   └── package.json       # Backend dependencies
├── frontend/
│   ├── public/            # Static assets (CSS, JS, locales)
│   │   ├── css/           # Stylesheets
│   │   ├── js/            # Frontend JavaScript
│   │   └── locales/       # i18n translation files (ru.json, en.json)
│   └── views/             # EJS templates
├── .env.example           # Environment variable template
├── package.json           # Root package.json (start / test scripts)
├── setup.js               # gbrain auto-configuration
└── README.md              # This file
```

### Running in Development

```bash
# Start with auto-reload (requires nodemon)
npx nodemon backend/server.js
```

### Running Tests

```bash
npm test
```

---

## License

MIT License — see [LICENSE](LICENSE) for details.

---

## Contact

Created by [CTAC TEPEXOB](https://t.me/zcat7449) — feel free to reach out on Telegram.

---

*Built for [Hermes Agent](https://hermes-agent.nousresearch.com) by Nous Research.*
