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

# Docker (builds app + PostgreSQL, runs migrations/seeds, serves on port 3001)
docker compose up -d --build
```

There are no tests or linting configured.

## Architecture

**Monorepo** with `server/` (Express + TypeScript) and `client/` (React 19 + Vite + TailwindCSS 4). PostgreSQL 17 via raw `pg` Pool (not Knex query builder — Knex is only used for migrations/seeds due to a tarn.js pool hang issue on WSL2).

**No AI APIs** — the app scrapes prediction sites directly and uses livescore.com + sofascore.com for fixtures and results. No paid API keys required.

### Data Pipeline

1. **Fixture ingestion** (`cron/fixtureIngestion.ts`): Scrapes prediction sites (prosoccer.gr via cheerio, zulubet.com via cheerio) for matches with **70%+ probability AND tipped odds 1.50-1.99 AND opposing-side odds >= 5.00**. Three-step gate before a match enters the DB:
   - **Filter**: 70%+ probability AND tipped odds 1.50-1.99 AND opposing-side odds >= 5.00 (heavy underdog confirmation — e.g. `1.55 / 3.70 / 5.70` with tip "1" passes because the away side is priced at 5.70). For draw tips, both home and away odds must be >= 5.00.
   - **Verify**: Cross-check against ESPN API + livescore.com (±1 day). Requires BOTH home AND away team to match (no home-only fallback — prevents false positives like Sheffield/Sheffield United W or Toulouse/Toulon). Unverified matches are logged and rejected.
   - **Dedup**: Skip if same home+away teams exist within ±7 days OR already finished (catches prosoccer.gr page recycling).

   Matches stored as `status: 'scheduled'` with null scores. Today and tomorrow are always re-scraped every hour regardless of staleness.

2. **Prediction storage** (`predictionEngine.ts`): Computes EV (`probability * odds - 1`), Poisson agreement score, league hit ratio. Value bet = confidence >= 70% AND odds > 1.50. Selects Pick of the Day via deterministic weighted composite: 30% EV, 25% league hit ratio, 20% confidence, 15% Poisson, 10% odds attractiveness (peaks at 1.72). POTD reasoning generated from template string using match stats. Falls back to top confidence picks (>= 55%) if no value bets exist.

3. **Result sync** (`cron/resultSync.ts`): Three sources merged via `fetchAllResults()`: livescore.com (primary) → sofascore.com → ESPN API. All fetched including adjacent dates (±1 day) for timezone mismatches. Fuzzy team name matching with home-only fallback for results (`teamsMatch()` in `livescoreFetcher.ts`) — includes `TEAM_ALIASES` map for transliteration mismatches (Sachtor/Shakhtar, Lyon/Olympique Lyonnais, Miami FC/Inter Miami, etc.). Detects postponed/cancelled/abandoned matches (livescore `Postp`/`Canc`/`Abn`). Two sync paths: cron `syncResults()` every 5 min, and `syncResultsForDate(date)` on-demand when user opens past dates. Settled endpoint also triggers sync when matches should have finished (kickoff > 105 min ago).

4. **Auto result sync on page view** (`routes/matches.ts`): When a user opens a past date with unfinished matches, `syncResultsForDate(date)` runs automatically before returning data — fetching from both livescore and sofascore across adjacent dates. Guarded against duplicate concurrent syncs per date via `syncingDates` Set.

5. **Odds sync** (`cron/oddsSync.ts`): Supplementary odds refresh. Primary odds come from prediction sites during fixture ingestion.

### Key Design Decisions

- **No AI APIs**: All data comes from scraping prediction sites (prosoccer.gr, zulubet.com) and free APIs (livescore.com, sofascore.com). No paid API keys required.
- **Strict match filter + verification**: Only matches with 70%+ probability AND tipped odds 1.50-1.99 AND opposing-side odds >= 5.00 AND verified on ESPN/livescore are ingested and displayed. Verification requires BOTH home AND away team to match — home-only fallback caused false positives (e.g. "SHEFFIELD UNI" matching "Sheffield United W", "TOULOUSE" matching "SC Toulon").
- **Team name aliases** (`TEAM_ALIASES` in `livescoreFetcher.ts`): Scrapers abbreviate or transliterate team names differently from livescore/sofascore. The alias map covers: Eastern European transliterations (Sachtor/Shakhtar, Dynamo/Dinamo), German umlauts (Munchen/Munich, Monchengladbach/M'gladbach), and MLS abbreviations (Miami FC/Inter Miami, Sporting KC/Sporting Kansas, Nashville/Nashville SC). New aliases should be added here when result sync fails to match a known team.
- **Cheerio HTML parsing**: prosoccer.gr and zulubet.com parsed directly with cheerio (no AI). prosoccer.gr columns: league code, time, teams, probabilities, tip, odds. Zulubet cells: 0=time, 1=league flag (img title, separate cell), 2=teams, 3-5=probs, 6=tip, 7-9=odds, 10=score.
- **Scores only from livescore.com + sofascore.com**: Ingestion never stores scraped scores — matches inserted as `scheduled` with null scores. The `Match.upsert` ON CONFLICT does not update score columns. Only `resultSync` writes scores via direct UPDATE.
- **Cross-date deduplication**: prosoccer.gr rotates pages and shows the same match on multiple day views. Ingestion checks if same home/away teams exist within ±7 days before inserting. Also explicitly skips matches where the same matchup is already `finished` in the DB (logs "Skipping recycled match"). Some dates may show zero matches if all qualifying fixtures were captured on an earlier scrape.
- **Adjacent-date result lookup**: Result sync checks ±1 day on both livescore and sofascore because scraper kickoff times can differ from API dates due to timezone mismatches (e.g. prosoccer lists a 19:45 UTC match as "tomorrow" but livescore has it on "today").
- **Postponed/cancelled detection**: Result sync checks livescore for `Postp`/`Canc`/`Abn` status and updates match status accordingly. Frontend shows **PPD** (amber) or **CAN** (gray) in the result column.
- **Raw pg instead of Knex query builder**: Knex's tarn.js pool hangs on WSL2 `/mnt/c/` filesystem. All models use `query()` from `config/database.ts` with parameterized SQL and `ON CONFLICT DO UPDATE` upserts.
- **Auto-ingest on date select**: `routes/matches.ts` triggers `ingestFixtures(date)` when no data exists for a requested date.
- **Server serves frontend**: Express serves the Vite build from `client/dist/` — single port 3001 for LAN access.
- **Helmet with LAN-safe defaults**: `helmet()` runs with `contentSecurityPolicy`, `crossOriginOpenerPolicy`, and `originAgentCluster` disabled so the app works over plain HTTP on LAN IPs.

### Database (5 tables + 1 added column)

`tournaments` -> `teams` -> `matches` (1:many). `predictions` is 1:1 with `matches` (includes `reasoning` TEXT column). `odds_history` is many:1 with `matches` (time-series snapshots from scraped sources).

### Environment Variables (.env)

No API keys required. Database connects via `pg.Pool` using env vars `DB_HOST`, `DB_PORT`, `DB_NAME`, `DB_USER`, `DB_PASS` (defaults to `127.0.0.1:5432` with `football_app`/`football_pass` in `config/database.ts`). `DATABASE_URL` is also supported (takes priority in knexfile).

### Cron Schedule

- `0 * * * *` — full-week fixture ingestion (hourly; covers current Sun-Sat week + next 3 days; skips dates ingested within the last hour except today/tomorrow which always re-scrape)
- `*/30 * * * *` — fast sync for today + tomorrow only (catches zulubet/prosoccer updates throughout the day)
- `*/15 * * * *` — odds sync
- `*/5 * * * *` — result sync (24/7). Also triggered on-demand by the `/settled` polling endpoint when matches should have finished (kickoff > 105 min ago). Three sources: livescore.com → sofascore.com → ESPN API.

### Frontend

React Query hooks in `hooks/useMatches.ts` wrap axios calls (`120s timeout`). Only matches with 70%+ probability AND tipped odds 1.50-1.99 are displayed. All times displayed in **Africa/Nairobi (EAT, UTC+3)** via `timeZone: 'Africa/Nairobi'` in `toLocaleTimeString()`. Match table shows matches in one unified table — value bets first with tier accent colors (HIGH >=90% amber, STRONG 80-89% green, VALUE 70-79% blue). Accumulator endpoint returns one best combo per fold size (2, 3, 4). Toast notifications via context provider. Odds in 1.50-2.00 highlighted green. Settled results polled every 30s with win/loss flash animations. Result column shows: score (green=win, red=loss), **PPD** (amber for postponed), **CAN** (gray for cancelled), **vs** (pending). Daily P/L counts postponed/cancelled as void (not wins/losses).

### Scraper Data Sources

**prosoccer.gr** (`fixtureScraper.ts`):
- Today: `/en/football/predictions`
- Yesterday: `/en/football/predictions/yesterday.html`
- Tomorrow: `/en/football/predictions/tomorrow.html`
- Other days: `/en/football/predictions/{DayName}.html` (e.g., `Saturday.html`)
- Parsed with cheerio. Columns: league code (mapped via `LEAGUE_CODE_MAP`), time, teams, probabilities (%), tip, odds. Predicted scores in columns 10-11 are ignored.
- **Page rotation**: prosoccer.gr does not keep historical pages. Once a day passes, matches rotate off. `{DayName}.html` always points to the NEXT occurrence of that day, not the previous one. The same matches often appear on multiple day pages (e.g. "yesterday" and "today" show overlapping fixtures). The ±7 day dedup guard + ESPN verification handles this — recycled matches that already finished are blocked.

**zulubet.com** (`zulubetScraper.ts`):
- URL: `https://www.zulubet.com/tips-{DD-MM-YYYY}.html`
- Parsed with cheerio. Selector: `$('.main_table tr')`. 17 cells per data row: 0=time (with JS prefix), 1=league+teams, 2=combined probs min, 3-5=probs ("1: 65%"), 6-8=probs full, 9=tip, 10=empty, 11=combined odds min, 12-14=odds full, 15=score, 16=empty.
- Zulubet updates matches throughout the day — fast sync runs every 30 minutes for today/tomorrow.
- **Conservative probabilities**: Zulubet rarely exceeds 60% probability — it's primarily a supplementary odds source, not an independent prediction source. prosoccer.gr is the primary source for meeting the 70% threshold.

### Result Sources

**livescore.com API** (primary):
- URL: `https://prod-cdn-public-api.livescore.com/v1/api/app/date/soccer/{YYYYMMDD}/1?MD=1`
- Structure: `Stages[].Events[]` with `T1[0].Nm`, `T2[0].Nm`, `Tr1`, `Tr2`, `Eps` (FT/AET/AP/Postp/Canc/Abn), `Esd` (kickoff as YYYYMMDDHHmm)
- No API key needed. Returns 100-160+ matches per day.
- Used for fixture ingestion (scheduled matches filtered to target leagues) and result sync.

**sofascore.com API** (fallback for results):
- URL: `https://api.sofascore.com/api/v1/sport/football/scheduled-events/{YYYY-MM-DD}`
- Structure: `events[]` with `homeTeam.name`, `awayTeam.name`, `homeScore.current`, `awayScore.current`, `status.type`, `tournament.name`
- No API key needed. Always fetched alongside livescore and merged for broader coverage.

**ESPN API** (verification + results):
- URL: `https://site.api.espn.com/apis/site/v2/sports/soccer/all/scoreboard?dates={YYYYMMDD}&limit=500`
- Structure: `events[].competitions[].competitors[]` with `team.displayName`, `score`, `homeAway`, `status.type.name`
- No API key needed. Returns up to 500 matches per day. Covers leagues livescore/sofascore miss (Nigerian NPFL, etc.).
- **Two functions**: `fetchEspnAllMatches()` returns all statuses (used for fixture verification — confirms a match truly exists on a date). `fetchEspnResults()` returns only finished matches (used for result sync).

### Docker

Multi-stage `Dockerfile` (server build -> client build -> production image). `docker-compose.yml` runs PostgreSQL 17 + app with auto-migration via `env_file: .env`. PostgreSQL port bound to `127.0.0.1:5432` only (not exposed to subnet). App port `3001` exposed on all interfaces for LAN access. Windows Firewall rule "Football Predictions API" allows inbound TCP 3001 on Private profile.

### WSL2 Networking

Uses `networkingMode=mirrored` in `~/.wslconfig` so WSL shares the host's LAN IP. Server binds to `0.0.0.0:3001`.
