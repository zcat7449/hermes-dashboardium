# Contributing to Dashboardium

## Code Style

- **Backend**: Node.js/Express, CommonJS modules (`require`/`module.exports`)
- **Frontend**: Vanilla JS IIFE modules (`(function(){ ... })()`), no frameworks
- **i18n**: All user-facing strings go through `window.Dashboard.I18n.t()`. Add new keys to `frontend/views/i18n.js` (both `ru` and `en` sections)
- **CSS**: Inline in `frontend/views/index.html` (`<style>` block), CSS custom properties for theming

## Git Discipline

Every change must be committed and pushed immediately:

```bash
git add -A
git commit -m "краткое описание: что сделано"
git push origin master
```

No uncommitted modifications should remain at the end of a session.

## Project Structure

```
dashboardium/
├── backend/
│   ├── server.js          # Express entry point
│   ├── routes/            # REST API route handlers
│   ├── services/          # Business logic (profiles, kanban, hermes-cli)
│   ├── middleware/         # Auth, rate-limit, audit
│   └── package.json       # Backend dependencies
├── frontend/
│   └── views/
│       ├── index.html     # Main HTML + CSS + script tags
│       ├── i18n.js        # Translations (ru/en)
│       ├── config.js      # Auth overlay, language switcher
│       ├── utils.js       # Helpers (normProfile, fmtUptime, esc)
│       ├── state.js       # Global state (Data object)
│       ├── render.js      # DOM rendering (cards, sessions, chat)
│       ├── api.js         # REST + WebSocket client
│       ├── drag-drop.js   # Leader reordering
│       ├── modal.js       # Profile selection modal
│       ├── task-modal.js  # Task detail modal
│       └── actions.js     # Event handlers
├── .env.example           # Environment variable template
├── package.json           # Root package.json
├── setup.js               # gbrain auto-configuration
└── README.md              # This file
```

## Testing

```bash
cd backend && npm test
```

Tests cover session listing, export, parsing, and HTTP endpoints. Add new tests in `backend/test-*.js`.

## Adding a New Language

1. Add translations to `frontend/views/i18n.js` under a new key (e.g., `de`)
2. Add `<option value="de">Deutsch</option>` to the `<select id="langSwitcher">` in `index.html`
3. Test by switching the language selector in the UI

## Pull Requests

1. Fork the repo
2. Create a feature branch
3. Make your changes
4. Run tests
5. Submit a PR with a clear description of what and why

## License

By contributing, you agree that your contributions will be licensed under the MIT License.
