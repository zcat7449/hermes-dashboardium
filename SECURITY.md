# Security Policy

## Supported Versions

| Version | Supported          |
| ------- | ------------------ |
| 1.0.x   | :white_check_mark: |

## Reporting a Vulnerability

**Do NOT open a public issue.**  
Email: `security@dashboardium.dev` (or open a private security advisory on GitHub).

We will respond within 48 hours and aim to patch within 7 days.

## Security Model

- **Authentication:** HTTP Basic Auth over HTTPS (or reverse proxy). Credentials via environment variables only.
- **Input validation:** All API inputs are validated against allowlists. No raw user input reaches the shell.
- **Secrets:** Never committed. `.env` and `*.log` are in `.gitignore`.
- **Dependencies:** Audited via `npm audit` on every CI run. Zero known vulnerabilities.
- **XSS:** All user-controlled data rendered via `innerHTML` is HTML-escaped.
- **Rate limiting:** Global IP-based and per-profile chat rate limits.

## Disclosure Timeline

- Report received → acknowledged within 48h
- Fix developed → tested → released
- CVE requested if applicable
- Public disclosure 30 days after fix
