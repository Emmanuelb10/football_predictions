# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Build & Run Commands

```bash
# All commands run in WSL2 (Debian). Prefix with nvm setup:
# export NVM_DIR="$HOME/.nvm"; [ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"

# Start PostgreSQL (requires root)
wsl -u root -e bash -c "pg_ctlcluster 17 main start"

# Build server (TypeScript → dist/)
cd server && npx tsc

# Build client (React → client/dist/)
cd client && npx vite build

# Run server (serves API + client build on port 3001)
cd server && node dist/index.js

# Run client dev server with hot reload (port 3000, proxies /api to 3001)
cd client && npm run dev

# Database migrations
cd server && npx knex migrate:latest --knexfile knexfile.ts
cd server && npx knex seed:run --knexfile knexfile.ts
```

There are no tests or linting configured.

## Architecture

**Monorepo** with `server/` (Express + TypeScript) and `client/` (React 19 + Vite + TailwindCSS 4). PostgreSQL 17 via raw `pg` Pool (not Knex query builder — Knex is only used for migrations/seeds due to a tarn.js pool hang issue on WSL2).

### Data Pipeline

1. **Fixture ingestion** (`cron/fixtureIngestion.ts`): Scrapes prosoccer.gr via axios, sends stripped HTML to Claude API (`claudeService.ts`) which extracts structured match data (teams, probabilities, odds, tips). Filters to matches with **70%+ probability AND odds 1.50-1.99**. Falls back to Claude-generated fixtures if scraper fails.

2. **Prediction storage** (`predictionEngine.ts`): Computes EV, Poisson agreement score, league hit ratio. Selects Pick of the Day via weighted composite: 30% EV, 25% league hit ratio, 20% consistency, 15% Poisson, 10% line movement.

3. **Result sync** (`cron/resultSync.ts`): Fetches from livescore.com CDN API (`prod-cdn-public-api.livescore.com`), falls back to sofascore API. Fuzzy team name matching strips FC/SK suffixes and numbers.

4. **Odds sync** (`cron/oddsSync.ts`): Optional 1xBet Puppeteer scraper; Claude-estimated odds used as fallback.

### Key Design Decisions

- **Raw pg instead of Knex query builder**: Knex's tarn.js pool hangs on WSL2 `/mnt/c/` filesystem. All models use `query()` from `config/database.ts` with parameterized SQL and `ON CONFLICT DO UPDATE` upserts.
- **Claude as HTML parser**: prosoccer.gr doesn't have a structured API. The scraper fetches HTML, strips tags, sends text to Claude to extract JSON.
- **Auto-ingest on date select**: `routes/matches.ts` triggers `ingestFixtures(date)` when no data exists for a requested date, using prosoccer.gr's date-specific URLs (`yesterday.html`, `tomorrow.html`, `Saturday.html`).
- **Server serves frontend**: In all modes, Express serves the Vite build from `client/dist/` — single port 3001 for LAN access.

### Database (5 tables)

`tournaments` → `teams` → `matches` (1:many). `predictions` is 1:1 with `matches`. `odds_history` is many:1 with `matches` (time-series snapshots). The `reasoning` column on `predictions` stores the POTD explanation text.

### Environment Variables (.env)

Required: `CLAUDE_API_KEY`. Optional: `GEMINI_API_KEY`, `API_FOOTBALL_KEY`. Database defaults to `postgresql://football_app:football_pass@127.0.0.1:5432/football_predictions`.

### Cron Schedule

- `0 6 * * *` — fixture ingestion
- `*/15 * * * *` — odds sync
- `*/10 14-23,0-3 * * *` — result sync (peak match hours)

### Frontend

React Query hooks in `hooks/useMatches.ts` wrap axios calls. Match table groups by confidence tiers (90%+, 80-89%, 70-79%). Toast notifications via context provider. Odds in 1.50-2.00 highlighted green.

### prosoccer.gr URL Pattern

- Today: `/en/football/predictions`
- Yesterday: `/en/football/predictions/yesterday.html`
- Tomorrow: `/en/football/predictions/tomorrow.html`
- Other days: `/en/football/predictions/{DayName}.html` (e.g., `Saturday.html`)

### WSL2 Networking

Uses `networkingMode=mirrored` in `~/.wslconfig` so WSL shares the host's LAN IP. Server binds to `0.0.0.0:3001`.
