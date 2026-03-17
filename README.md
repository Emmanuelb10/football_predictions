# Football Predictions — AI-Powered Betting Helper

A full-stack sports analytics platform that identifies value bets with deep analytics, live result tracking, and accumulator suggestions. Scrapes real fixtures and odds from prosoccer.gr, syncs results from livescore.com and sofascore, and uses Claude AI for predictions.

## Architecture

```
┌──────────────┐     ┌──────────────┐     ┌─────────────┐
│ prosoccer.gr │────▶│  Node.js API │◀───▶│ PostgreSQL  │
│(fixtures+odds)│     │  (Express)   │     │   17        │
└──────────────┘     └──────┬───────┘     └─────────────┘
                            │
┌──────────────┐            │         ┌──────────────────┐
│ Claude API   │◀───────────┤────────▶│  React Frontend  │
│(HTML parsing │            │         │ (Vite + Tailwind) │
│+ predictions)│     ┌──────┴───────┐ └──────────────────┘
└──────────────┘     │  Cron Jobs   │
                     │ - Fixtures   │
┌──────────────┐     │ - Odds       │
│ livescore.com│◀────│ - Results    │
│ + sofascore  │     └──────────────┘
└──────────────┘
```

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Runtime | Node.js 22 (NVM) on WSL2 |
| Backend | Express + TypeScript |
| Frontend | React 19, Vite 6, TailwindCSS 4, Recharts |
| Database | PostgreSQL 17 (raw pg, not ORM) |
| AI | Claude API (HTML parsing + predictions) |
| Fixtures & Odds | prosoccer.gr (scraped via Claude) |
| Results | livescore.com CDN API + sofascore API |
| Process Mgr | PM2 |

## Features

- **Value bet detection**: Only shows matches with 70%+ win probability AND odds 1.50-1.99
- **Pick of the Day**: AI-selected best bet with reasoning explanation
- **Accumulator builder**: Best 2-fold, 3-fold, 4-fold combos with results tracking
- **Confidence tiers**: Matches grouped by HIGH (90%+), STRONG (80-89%), VALUE (70-79%)
- **Live result sync**: Scores from livescore.com + sofascore every 10 minutes
- **Daily P&L banner**: Today's wins/losses, profit in units, current streak
- **Performance analytics**: Hit ratio, ROI, Brier score, log loss, league breakdown
- **Info tooltips**: Hover (i) icons for all betting terms (EV, POTD, ROI, etc.)
- **Toast notifications**: Loading feedback when fetching/ingesting data
- **Auto-ingest**: Selecting any date in the calendar auto-fetches data if not cached
- **LAN access**: Accessible from any device on the local network

## Setup

### Prerequisites
- Windows 11 with WSL2 (Debian/Ubuntu)
- Claude API key ([console.anthropic.com](https://console.anthropic.com))

### 1. Install WSL dependencies
```bash
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.3/install.sh | bash
source ~/.bashrc
nvm install 22
sudo apt-get install -y postgresql postgresql-contrib
```

### 2. Setup database
```bash
sudo pg_ctlcluster 17 main start
sudo -u postgres psql -c "CREATE USER football_app WITH PASSWORD 'football_pass';"
sudo -u postgres psql -c "CREATE DATABASE football_predictions OWNER football_app;"
sudo -u postgres psql -c "GRANT ALL PRIVILEGES ON DATABASE football_predictions TO football_app;"
sudo -u postgres psql -d football_predictions -c "GRANT ALL ON SCHEMA public TO football_app;"
```

Enable TCP connections (required for Node.js):
```bash
sudo bash -c "echo \"listen_addresses = 'localhost'\" >> /etc/postgresql/17/main/postgresql.conf"
sudo pg_ctlcluster 17 main restart
```

### 3. Configure environment
```bash
cp .env.example .env
# Edit .env and add your Claude API key:
#   CLAUDE_API_KEY=sk-ant-...
```

### 4. Install dependencies & migrate
```bash
npm install
cd server && npm install && cd ../client && npm install && cd ..
cd server && npx knex migrate:latest --knexfile knexfile.ts
npx knex seed:run --knexfile knexfile.ts
```

### 5. Build & run
```bash
cd server && npx tsc && node dist/index.js
```

The server serves both the API and frontend on port 3001.

## API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/health` | Server status, AI key status |
| GET | `/api/matches?date=YYYY-MM-DD` | Matches with predictions + odds (auto-ingests if empty) |
| GET | `/api/predictions/pick-of-day?date=YYYY-MM-DD` | Pick of the Day with AI reasoning |
| GET | `/api/predictions/accumulators?date=YYYY-MM-DD` | Best 2/3/4-fold combos with results |
| GET | `/api/performance?days=30` | Hit ratio, ROI, Brier score, log loss, league breakdown |
| GET | `/api/performance/daily?date=YYYY-MM-DD` | Daily P&L, wins/losses, streak |
| GET | `/api/matches/settled?since=ISO` | Recently settled matches (for live polling) |
| POST | `/api/trigger/ingest?date=YYYY-MM-DD` | Manual fixture ingestion |
| POST | `/api/trigger/odds` | Manual odds sync |
| POST | `/api/trigger/results` | Manual result sync |

## Automated Schedule (Cron)

| Time (UTC) | Job | Description |
|-----------|-----|-------------|
| 06:00 daily | Fixture ingestion | Scrape prosoccer.gr, Claude predictions |
| Every 15 min | Odds sync | Optional 1xBet scraper |
| Every 10 min (14:00-03:00) | Result sync | livescore.com + sofascore |

## How It Works

1. **prosoccer.gr** scraped for fixtures with probabilities and real bookmaker odds
2. **Claude API** parses the HTML and extracts structured match data
3. **Filtered** to matches with 70%+ probability AND tipped odds 1.50-1.99
4. Matches without odds are excluded
5. **Pick of the Day** selected by composite score (EV, Poisson, league hit ratio)
6. **Results** synced from livescore.com CDN API with sofascore fallback
7. Fuzzy team name matching handles naming differences between sources

## LAN Access

Uses WSL2 mirrored networking (`~/.wslconfig: networkingMode=mirrored`). Server binds to `0.0.0.0:3001`, accessible at `http://<host-ip>:3001` from any device on the network.

## License

MIT
