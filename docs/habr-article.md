# Статья на Habr: «Решил упростить себе работу с профилями в Hermes Agent»

**Теги:** Hermes Agent, dashboard, open source, Node.js, мониторинг

> **Аннотация:** Когда у вас десяток AI-агентов работают одновременно, а мониторить их приходится через терминал — это бесит. Я написал веб-панель Dashboardium: все профили Hermes Agent на одном экране, чат с любым профилем в реальном времени, Kanban-задачи и drag-and-drop. Open source, Node.js, 5 минут на установку. Рассказываю, как устроено и как запустить у себя.

---

## Проблема

У меня запущено 10+ профилей [Hermes Agent](https://hermes-agent.nousresearch.com) — orchestrator, backend, frontend, devops, qa, seo, devsecops, rag и другие. Каждый профиль работает в своём процессе, у каждого свои задачи в Kanban, свои сессии, свой контекст.

Чтобы посмотреть что происходит, приходилось:
- `hermes profile list` — кто активен
- `hermes kanban --board dashboardium list` — какие задачи висят
- `hermes sessions list --profile orchestrator` — что там в чате
- И так для каждого профиля

Это быстро надоело. Решил сделать единую панель.

## Решение: Dashboardium

**Dashboardium** — веб-панель, которая показывает все профили Hermes в реальном времени.

![Скриншот дашборда](screenshot.png)

### Что умеет

- **Мониторинг** — видно все профили, их статус, использование контекста, активные задачи
- **Чат** — можно написать любому профилю прямо из браузера, ответ приходит по WebSocket
- **Kanban** — просмотр задач, блокировка, переназначение, архивация
- **Watched-профили** — избранные всегда сверху, остальные скрыты
- **Drag & Drop** — перестановка лидер-профилей мышкой
- **i18n** — русский и английский интерфейс

### Как работает

Бэкенд на Node.js + Express читает профили Hermes из `~/.hermes/profiles/` и Kanban-доски из `~/.hermes/kanban/boards/`. Фронтенд на Vanilla JS общается с бэкендом через REST API и WebSocket.

Обновления приходят по WebSocket в реальном времени — не нужно жать F5.

### Установка

```bash
git clone https://github.com/zcat7449/hermes-dashboardium.git
cd hermes-dashboardium
cd backend && npm install && cd ..
cp .env.example .env
# отредактируйте AUTH_PASSWORD
npm start
```

Открываете `http://localhost:3010` — и всё готово.

### Технологии

- **Бэкенд:** Node.js 20+, Express, WebSocket (ws)
- **Фронтенд:** Vanilla JS, CSS Grid
- **БД:** SQLite (Kanban), PostgreSQL (опционально)
- **Интеграция:** Hermes CLI, Telegram

### Планы

- PWA-режим (установка как приложение)
- Тёмная/светлая тема
- Мобильная версия
- Экспорт метрик в Prometheus

### Ссылки

- [GitHub](https://github.com/zcat7449/hermes-dashboardium)
- [Hermes Agent](https://hermes-agent.nousresearch.com)

---

*Если у вас тоже запущено несколько профилей Hermes — попробуйте Dashboardium. Буду рад звёздам, issues и pull requests.*
