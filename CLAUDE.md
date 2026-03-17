# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Build & Run Commands

```bash
# All commands run in WSL2 (Debian). Prefix with nvm setup:
# export NVM_DIR="$HOME/.nvm"; [ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"

# Start PostgreSQL (requires root)
wsl -u root -e bash -c "pg_ctlcluster 17 main start"

# Build server (TypeScript -> dist/)
cd server && npx tsc

# Build client (React -> client/dist/)
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

1. **Fixture ingestion** (`cron/fixtureIngestion.ts`): Scrapes prosoccer.gr via axios, sends stripped HTML to Claude API (`claudeService.ts`) which extracts structured match data (teams, probabilities, odds, tips). **Filters**: must have odds + 70%+ probability + tipped odds 1.50-1.99. Matches without odds are excluded. Falls back to Claude-generated fixtures if scraper fails.

2. **Prediction storage** (`predictionEngine.ts`): Computes EV, Poisson agreement score, league hit ratio. Selects Pick of the Day via weighted composite: 30% EV, 25% league hit ratio, 20% consistency, 15% Poisson, 10% line movement. POTD reasoning stored in `predictions.reasoning` column.

3. **Result sync** (`cron/resultSync.ts`): Fetches from livescore.com CDN API (`prod-cdn-public-api.livescore.com/v1/api/app/date/soccer/{YYYYMMDD}/1?MD=1`), falls back to sofascore API (`api.sofascore.com/api/v1/sport/football/scheduled-events/{date}`). Fuzzy team name matching with home-only fallback for ambiguous names.

4. **Odds sync** (`cron/oddsSync.ts`): Optional 1xBet Puppeteer scraper; prosoccer.gr odds are primary.

### Key Design Decisions

- **Raw pg instead of Knex query builder**: Knex's tarn.js pool hangs on WSL2 `/mnt/c/` filesystem. All models use `query()` from `config/database.ts` with parameterized SQL and `ON CONFLICT DO UPDATE` upserts.
- **Claude as HTML parser**: prosoccer.gr doesn't have a structured API. The scraper fetches HTML, strips tags, sends text to Claude to extract JSON. The prompt asks Claude to also extract final scores from past match pages.
- **Auto-ingest on date select**: `routes/matches.ts` triggers `ingestFixtures(date)` when no data exists for a requested date, using prosoccer.gr's date-specific URLs.
- **Server serves frontend**: Express serves the Vite build from `client/dist/` — single port 3001 for LAN access.
- **Matches without odds excluded**: If prosoccer.gr doesn't provide odds for a match, it's filtered out at ingestion time.

### Database (5 tables + 1 added column)

`tournaments` -> `teams` -> `matches` (1:many). `predictions` is 1:1 with `matches` (includes `reasoning` TEXT column added via ALTER TABLE). `odds_history` is many:1 with `matches` (time-series snapshots from prosoccer/1xbet/claude_estimate/implied).

### Environment Variables (.env)

Required: `CLAUDE_API_KEY`. Optional: `GEMINI_API_KEY`, `API_FOOTBALL_KEY`. Database connects via `pg.Pool` to `127.0.0.1:5432` with hardcoded credentials in `config/database.ts`.

### Cron Schedule

- `0 6 * * *` — fixture ingestion
- `*/15 * * * *` — odds sync
- `*/10 14-23,0-3 * * *` — result sync (peak match hours)

### Frontend

React Query hooks in `hooks/useMatches.ts` wrap axios calls (`120s timeout`). Match table shows all matches in one unified table — value bets first with tier accent colors, non-value below. Accumulator endpoint returns one best combo per fold size (2, 3, 4). Toast notifications via context provider. InfoTip component uses `position: fixed` with JS-calculated coords to escape overflow containers. Odds in 1.50-2.00 highlighted green. Settled results polled every 30s with win/loss flash animations.

### prosoccer.gr URL Pattern

- Today: `/en/football/predictions`
- Yesterday: `/en/football/predictions/yesterday.html`
- Tomorrow: `/en/football/predictions/tomorrow.html`
- Other days: `/en/football/predictions/{DayName}.html` (e.g., `Saturday.html`)

### livescore.com API

- URL: `https://prod-cdn-public-api.livescore.com/v1/api/app/date/soccer/{YYYYMMDD}/1?MD=1`
- Structure: `Stages[].Events[]` with `T1[0].Nm`, `T2[0].Nm`, `Tr1`, `Tr2`, `Eps` (FT/AET/AP)
- No API key needed. Returns 100-160+ matches per day.

### WSL2 Networking

Uses `networkingMode=mirrored` in `~/.wslconfig` so WSL shares the host's LAN IP. Server binds to `0.0.0.0:3001`.
