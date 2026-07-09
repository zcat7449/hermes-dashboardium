# Dashboardium

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Node.js](https://img.shields.io/badge/Node.js-18+-green.svg)](https://nodejs.org)

**Панель управления профилями Hermes Agent** — мониторинг, чат и Kanban-задачи в реальном времени.

![Dashboardium Screenshot](screenshot.png)

## Что это

Dashboardium — веб-дашборд для [Hermes Agent](https://hermes-agent.nousresearch.com). Если у вас запущено несколько профилей (orchestrator, backend, frontend, devops, qa...), дашборд даёт единое окно для:

- **Мониторинга** — статус, usage контекста, текущая задача, таймер
- **Чата** — отправка сообщений профилю через браузер, ответ через WebSocket
- **Kanban** — просмотр и управление задачами (блокировка, переназначение, архивация)
- **Сессий** — список, переименование, удаление, создание новых

## Быстрый старт

```bash
git clone https://github.com/zcat7449/hermes-dashboardium.git
cd hermes-dashboardium/backend
npm install
cp ../.env.example ../.env
# отредактируйте .env: задайте AUTH_PASSWORD и DATABASE_URL (опционально)
node server.js
```

Открывайте **http://localhost:3010** — логин и пароль из `.env`.

## Требования

- **Node.js** 18+
- **Hermes Agent** (любая версия) — дашборд читает `~/.hermes/profiles/` и `~/.hermes/kanban/boards/`
- **PostgreSQL** 14+ (опционально — для хранения сессий; без него сессии только в памяти)

## Конфигурация

Все настройки через `.env` (поддерживается [dotenv](https://github.com/motdotla/dotenv)):

| Переменная | По умолчанию | Назначение |
|---|---|---|
| `PORT` | `3010` | Порт HTTP-сервера |
| `HOST` | `0.0.0.0` | Адрес для bind |
| `AUTH_USERNAME` | — | Логин для Basic Auth |
| `AUTH_PASSWORD` | — | Пароль (если не задан — auth отключена, dev-режим) |
| `PROFILES_DIR` | `~/.hermes/profiles` | Где лежат профили Hermes |
| `KANBAN_BOARDS_DIR` | `~/.hermes/kanban/boards` | Где лежат Kanban-доски |
| `HERMES_BIN` | `hermes` | Путь к бинарнику Hermes CLI |
| `DATABASE_URL` | — | PostgreSQL-строка для хранения сессий |
| `FRONTEND_ORIGIN` | `http://localhost:3010` | CORS origin |
| `TELEGRAM_TARGET` | — | Куда пересылать ответы чата (формат: `telegram:-1001234567890`) |

## Аутентификация

HTTP Basic Auth. Если `AUTH_USERNAME` и `AUTH_PASSWORD` заданы — все `/api/*` требуют авторизации. Если не заданы — auth отключена (dev-режим).

Brute-force защита: 10 неудачных попыток с одного IP за 60 секунд → 429.

## API

Все эндпоинты `/api/*` требуют Basic Auth (кроме `/api/health`).

| Метод | Путь | Назначение |
|---|---|---|
| `GET` | `/api/health` | Health check (без авторизации) |
| `GET` | `/api/profiles` | Список профилей с метаданными, задачами, usage |
| `GET` | `/api/profiles/:profile/sessions` | Сессии профиля |
| `POST` | `/api/profiles/:profile/sessions` | Создать сессию |
| `PATCH` | `/api/profiles/:profile/sessions/:id` | Переименовать сессию |
| `DELETE` | `/api/profiles/:profile/sessions/:id` | Удалить сессию |
| `GET` | `/api/profiles/:profile/sessions/:id/messages` | История сообщений |
| `POST` | `/api/chat/:profile` | Отправить сообщение в чат |
| `POST` | `/api/optimize/:profile` | Очистка контекста |
| `GET` | `/api/tasks/:board/:taskId` | Детали задачи |
| `POST` | `/api/tasks/:board/:taskId/block` | Заблокировать задачу |
| `POST` | `/api/tasks/:board/:taskId/unblock` | Разблокировать |
| `POST` | `/api/tasks/:board/:taskId/reassign` | Переназначить |
| `POST` | `/api/tasks/:board/:taskId/archive` | Архивировать |
| `GET` | `/api/user-role` | Список watched-профилей |
| `POST` | `/api/user-role` | Установить watched-профили |
| `DELETE` | `/api/user-role/:profile` | Убрать из watched |

## WebSocket

Сервер поднимает WebSocket на том же порту (`/ws`). Аутентификация через `?token=base64(user:pass)` в URL.

**События от сервера:**

| Тип | Когда | Данные |
|---|---|---|
| `profiles` | При подключении + каждые 10с (delta) | Полный список профилей |
| `chat_response` | Пришёл ответ от Hermes | `{ profile, response, session_id, new_session }` |
| `chat_update` | Частичное обновление чата | `{ profile, role, text, session_id }` |
| `chat_error` | Ошибка чата | `{ profile, error }` |

**События от клиента:**

| Тип | Назначение |
|---|---|
| `chat` | Отправить сообщение: `{ type:'chat', profile, message, session_id? }` |
| `optimize` | Очистить контекст: `{ type:'optimize', profile }` |
| `ping` | Keep-alive: `{ type:'ping', ts }` |

## Кэширование

Бэкенд кэширует в памяти:

| Что | TTL | Инвалидация |
|---|---|---|
| Список профилей | 1 сек | По TTL |
| Задачи (Kanban) | 1 сек | По TTL |
| Сессии профиля | 30 сек | При создании/удалении сессии |
| Usage (agent.log) | 30 сек | По TTL |
| Context limit (Ollama API) | 1 час | По TTL |

## Структура проекта

```
hermes-dashboardium/
├── backend/
│   ├── server.js              # Express + WebSocket, точка входа
│   ├── config.js              # Конфигурация (env, пути, лимиты)
│   ├── db.js                  # PostgreSQL pool, миграции, persistence
│   ├── models.json            # Лимиты контекста моделей
│   ├── routes/                # REST-обработчики
│   │   ├── profiles.js        # GET /api/profiles
│   │   ├── sessions.js        # CRUD сессий
│   │   ├── chat.js            # Чат + optimize
│   │   ├── tasks.js           # Kanban-задачи
│   │   └── user-role.js       # Watched-профили
│   ├── middleware/             # Auth, CORS, rate-limit, audit, path-guard
│   ├── services/              # Бизнес-логика
│   │   ├── hermes-cli.js      # Обёртка над Hermes CLI
│   │   ├── cache.js           # In-memory кэш
│   │   ├── profiles.js        # Чтение ~/.hermes/profiles/
│   │   ├── sqlite.js           # Чтение Kanban SQLite
│   │   ├── ollama-context.js  # Context limit из Ollama API
│   │   ├── pg-import.js       # Импорт SQLite → PostgreSQL
│   │   └── websocket.js       # WebSocket-сервер
│   └── test-*.js              # Тесты
├── frontend/
│   ├── public/                # Статика (иконки, manifest)
│   └── views/                 # SPA (index.html + JS-модули)
├── docs/
│   └── swagger.yaml           # OpenAPI 3.0 спецификация
├── .env.example               # Шаблон конфигурации
├── .editorconfig
├── .nvmrc                     # Node.js 18
├── eslint.config.mjs
├── .prettierrc
└── README.md
```

## Разработка

```bash
cd backend
npm test          # тесты
npx eslint .      # линтер
npx prettier --write '**/*.js'  # форматтер
```

Pre-commit hook (`.githooks/pre-commit`) проверяет покрытие тестами:

```bash
git config core.hooksPath .githooks
```

## Деплой

### systemd

```ini
# /etc/systemd/system/dashboardium.service
[Unit]
Description=Dashboardium
After=network.target

[Service]
Type=simple
User=root
WorkingDirectory=/opt/dashboardium/backend
Environment="PORT=3010"
Environment="AUTH_USERNAME=admin"
Environment="AUTH_PASSWORD=your-password"
Environment="DATABASE_URL=postgresql://dashboardium:***@localhost:5432/dashboardium"
Environment="HOST=0.0.0.0"
Environment="HOME=/root"
Environment="PROFILES_DIR=/root/.hermes/profiles"
Environment="KANBAN_BOARDS_DIR=/root/.hermes/kanban/boards"
Environment="HERMES_BIN=/usr/local/bin/hermes"
ExecStart=/usr/bin/node server.js
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now dashboardium
```

### За nginx

```nginx
server {
    listen 80;
    server_name dashboardium.example.com;

    location / {
        proxy_pass http://127.0.0.1:3010;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    }
}
```

`proxy_set_header Upgrade/Connection` обязательны — без них WebSocket не работает.

## Решение проблем

### Сервер не запускается

```bash
node -v                    # должно быть 18+
lsof -i :3010              # порт не занят?
```

### Профили не отображаются

```bash
ls ~/.hermes/profiles/     # профили существуют?
hermes profile list        # Hermes CLI работает?
```

### Чат не отвечает

```bash
hermes chat --profile orchestrator --message "ping"   # CLI работает?
journalctl -u dashboardium -f                          # смотрите логи
```

### WebSocket не подключается

1. nginx должен пробрасывать заголовки `Upgrade` и `Connection`
2. Basic Auth передаётся через `?token=base64(user:pass)` в URL (браузерный `WebSocket` не поддерживает кастомные заголовки)

## Лицензия

MIT — [LICENSE](LICENSE)

Создано [CTAC TEPEXOB](https://t.me/zcat7449) для [Hermes Agent](https://hermes-agent.nousresearch.com) by Nous Research.
