# Changelog

## [1.0.0] — 2026-07-06

### Added
- Real-time profile monitoring dashboard (4 leader slots + up to 12 watched)
- WebSocket delta polling for live updates
- Chat interface per leader profile (Hermes CLI integration)
- Task management: view details, block/unblock/archive, reassign
- PostgreSQL session persistence with SQLite import
- HTTP Basic Auth with rate limiting
- i18n support (ru, en, de, zh)
- Dark theme UI with responsive grid layout
- Structured logging (JSON to stdout/stderr)
- CI pipeline (GitLab CI) with test coverage gate

### Security
- All user input HTML-escaped (XSS prevention)
- Secrets via environment variables only, never committed
- Input validation on all API endpoints
- Global IP and per-profile chat rate limits
