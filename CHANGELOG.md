# Changelog

## v1.0.0 (2026-07-07)

### 🚀 Первый публичный релиз

Dashboardium — панель управления профилями Hermes Agent: мониторинг, чат и Kanban-задачи в реальном времени.

### ✨ Возможности

- **Мониторинг профилей** — статус, использование контекста, активные задачи
- **Чат с профилями** — отправка сообщений через WebSocket, ответы в реальном времени
- **Kanban-задачи** — просмотр, блокировка, переназначение, архивация
- **Watched-профили** — избранные профили всегда сверху
- **Drag & Drop** — перестановка лидер-профилей
- **i18n** — русский и английский интерфейс
- **HTTP Basic Auth** — простая защита панели
- **PostgreSQL** — опциональное хранение сессий
- **WebSocket** — дельта-обновления без перезагрузки страницы

### 🛠️ Технологии

- **Бэкенд:** Node.js 20+, Express, WebSocket (ws)
- **Фронтенд:** Vanilla JS, CSS Grid
- **БД:** SQLite (Kanban), PostgreSQL (опционально)
- **Интеграция:** Hermes CLI, Telegram

### 📦 Установка

```bash
git clone https://github.com/zcat7449/hermes-dashboardium.git
cd hermes-dashboardium
cd backend && npm install && cd ..
cp .env.example .env
npm start
```

### 🔗 Ссылки

- [Hermes Agent](https://hermes-agent.nousresearch.com)
- [GitHub](https://github.com/zcat7449/hermes-dashboardium)
