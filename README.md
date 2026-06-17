# Dashboardium

**Свободный дашборд к Hermes.**

## Установка (3 шага)

```bash
git clone <repo> dashboardium
cd dashboardium
npm install
node backend/server.js
```

Откройте `http://localhost:3002`

## Быстрый старт

1. **Назначьте лидеров** — кнопка `+` в блоке "ЛИДЕРЫ"
2. **Выберите роль** — лидер или подчинённый (в разработке)
3. **Следите за контекстом** — % заполненности для каждого профиля

## Структура

```
dashboardium/
├── backend/
│   └── server.js        # API-сервер
├── frontend/
│   └── views/
│       └── index.html   # Интерфейс
└── README.md
```

## Требования

- Node.js 18+
- Hermes Agent (для получения данных о профилях и сессиях)
