# Football Predictions — AI-Powered Value Bet Finder

A full-stack sports analytics platform that identifies value bets across Europe's top football leagues using Claude AI for predictions and free web data for fixtures.

## Architecture

```
┌─────────────┐     ┌──────────────┐     ┌─────────────┐
│ TheSportsDB │────▶│  Node.js API │◀───▶│ PostgreSQL  │
│  (fixtures) │     │  (Express)   │     │   17        │
└─────────────┘     └──────┬───────┘     └─────────────┘
                           │
┌─────────────┐            │         ┌─────────────────┐
│ Claude API  │◀───────────┤────────▶│ React Frontend  │
│(predictions)│            │         │ (Vite + Tailwind)│
└─────────────┘     ┌──────┴───────┐ └─────────────────┘
                    │  Cron Jobs   │
┌─────────────┐     │ - Fixtures   │
│ 1xBet       │◀────│ - Odds       │
│ (optional)  │     │ - Results    │
└─────────────┘     └──────────────┘
```

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Runtime | Node.js 22 (NVM) on WSL2 |
| Backend | Express + TypeScript |
| Frontend | React 19, Vite 6, TailwindCSS 4, Recharts |
| Database | PostgreSQL 17 |
| AI | Claude API (predictions + odds estimation) |
| Data | TheSportsDB free API (fixtures + results) |
| Scraping | Puppeteer + Stealth (optional, for 1xBet odds) |
| Process Mgr | PM2 |

## Tracked Leagues

Premier League, La Liga, Serie A, Bundesliga, Ligue 1, Primeira Liga, Eredivisie, Champions League, Europa League, Conference League

## Setup

### Prerequisites
- Windows 11 with WSL2 (Debian/Ubuntu)
- Claude API key ([console.anthropic.com](https://console.anthropic.com))

### 1. Install WSL dependencies
```bash
# Install NVM + Node.js
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.3/install.sh | bash
source ~/.bashrc
nvm install 22

# Install PostgreSQL
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
# Build server
cd server && npx tsc

# Start server (port 3001)
node dist/index.js

# In a new terminal — start frontend (port 3000)
cd client && npm run dev
```

### 6. Ingest first data
```bash
curl -X POST http://localhost:3001/api/trigger/ingest
```

## API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/health` | Server status, AI key status |
| GET | `/api/matches?date=YYYY-MM-DD` | Matches with predictions + odds |
| GET | `/api/predictions/pick-of-day?date=YYYY-MM-DD` | Pick of the Day |
| GET | `/api/performance?days=30` | Hit ratio, ROI, Brier score, log loss |
| POST | `/api/trigger/ingest` | Manual fixture + prediction ingestion |
| POST | `/api/trigger/odds` | Manual odds sync |
| POST | `/api/trigger/results` | Manual result sync |

## Automated Schedule (Cron)

| Time (UTC) | Job | Description |
|-----------|-----|-------------|
| 06:00 daily | Fixture ingestion | Scrape fixtures, Claude predictions |
| Every 15 min | Odds sync | 1xBet scraper or Claude estimates |
| Every 30 min (14:00–03:00) | Result sync | Update final scores |

## How Predictions Work

1. **Fixtures** scraped from TheSportsDB (free, no API key)
2. **Claude AI** analyzes each match and returns:
   - Home/Draw/Away probabilities
   - Recommended tip (1, X, or 2)
   - Estimated 1X2 betting odds
3. **Value bet** flagged when: probability ≥ 70% AND odds > 1.50
4. **Pick of the Day** selected by composite score:
   - 30% Expected Value
   - 25% League hit ratio
   - 20% Team consistency (1/std deviation)
   - 15% Poisson model agreement
   - 10% Line movement

## Production (PM2)

```bash
npm run build
pm2 start ecosystem.config.js
pm2 save && pm2 startup
```

## License

MIT
