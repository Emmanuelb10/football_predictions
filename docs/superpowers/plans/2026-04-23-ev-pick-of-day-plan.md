# EV Pick of the Day Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an "EV Pick of the Day" feature — a second daily pick selected by highest Expected Value (>20%), with a daily card and history table styled in blue/indigo.

**Architecture:** New `is_ev_pick` boolean column on `predictions` table. New `selectEvPick()` function called alongside `selectPickOfDay()`. New API endpoints mirror POTD pattern. New React components mirror existing POTD card/history with blue accent.

**Tech Stack:** PostgreSQL 17, Express + TypeScript, React 19 + TailwindCSS 4, React Query

---

## File Map

| Action | File | Responsibility |
|--------|------|---------------|
| Create | `server/src/db/migrations/007_add_ev_pick_to_predictions.ts` | Add `is_ev_pick` column |
| Modify | `server/src/models/Prediction.ts` | Add `findEvPick()`, `clearEvPick()` |
| Modify | `server/src/services/predictionEngine.ts` | Add `selectEvPick()` |
| Modify | `server/src/routes/predictions.ts` | Add `/ev-pick` and `/ev-pick-history` endpoints |
| Modify | `server/src/routes/index.ts` | Add `/trigger/ev-pick` manual trigger |
| Modify | `server/src/cron/fixtureIngestion.ts` | Call `selectEvPick()` after `selectPickOfDay()` |
| Modify | `client/src/api/client.ts` | Add `fetchEvPick()`, `fetchEvPickHistory()` |
| Modify | `client/src/hooks/useMatches.ts` | Add `useEvPick()`, `useEvPickHistory()` |
| Create | `client/src/components/EvPickCard.tsx` | Daily EV pick card (blue accent) |
| Create | `client/src/components/EvPickHistory.tsx` | EV pick history table (blue accent, Martingale) |
| Modify | `client/src/pages/PredictionsPage.tsx` | Wire in new components |

---

### Task 1: Database Migration

**Files:**
- Create: `server/src/db/migrations/007_add_ev_pick_to_predictions.ts`

- [ ] **Step 1: Create migration file**

```typescript
import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  const hasColumn = await knex.schema.hasColumn('predictions', 'is_ev_pick');
  if (!hasColumn) {
    await knex.schema.alterTable('predictions', (t) => {
      t.boolean('is_ev_pick').defaultTo(false);
    });
  }
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.alterTable('predictions', (t) => {
    t.dropColumn('is_ev_pick');
  });
}
```

- [ ] **Step 2: Run the migration**

```bash
cd server && npx knex migrate:latest --knexfile knexfile.ts
```

Expected: Migration `007_add_ev_pick_to_predictions` applied successfully.

- [ ] **Step 3: Commit**

```bash
git add server/src/db/migrations/007_add_ev_pick_to_predictions.ts
git commit -m "feat: add is_ev_pick column to predictions table"
```

---

### Task 2: Prediction Model — `findEvPick` and `clearEvPick`

**Files:**
- Modify: `server/src/models/Prediction.ts:3` (interface), `server/src/models/Prediction.ts:64-72` (after `clearPickOfDay`)

- [ ] **Step 1: Add `is_ev_pick` to the Prediction interface**

In `server/src/models/Prediction.ts`, add after the `is_pick_of_day: boolean;` line (line 13):

```typescript
  is_ev_pick: boolean;
```

- [ ] **Step 2: Add `findEvPick` function**

Add after the `clearPickOfDay` function (after line 72):

```typescript
export async function findEvPick(date: string) {
  const res = await query(
    `SELECT m.id as match_id, m.kickoff, m.status, m.home_score, m.away_score,
            ht.name as home_team, ht.logo_url as home_logo,
            at2.name as away_team, at2.logo_url as away_logo,
            t.name as tournament, p.*,
            oh.home_odds, oh.draw_odds, oh.away_odds
     FROM predictions p
     JOIN matches m ON p.match_id = m.id
     JOIN teams ht ON m.home_team_id = ht.id
     JOIN teams at2 ON m.away_team_id = at2.id
     JOIN tournaments t ON m.tournament_id = t.id
     LEFT JOIN LATERAL (SELECT * FROM odds_history WHERE match_id = m.id ORDER BY scraped_at DESC, id DESC LIMIT 1) oh ON true
     WHERE p.is_ev_pick = true
       AND DATE(m.kickoff AT TIME ZONE 'Africa/Nairobi') = $1
     LIMIT 1`,
    [date]
  );
  return res.rows[0] || null;
}

export async function clearEvPick(date: string) {
  return query(
    `UPDATE predictions SET is_ev_pick = false
     WHERE match_id IN (SELECT id FROM matches WHERE DATE(kickoff AT TIME ZONE 'Africa/Nairobi') = $1)`,
    [date]
  );
}
```

- [ ] **Step 3: Commit**

```bash
git add server/src/models/Prediction.ts
git commit -m "feat: add findEvPick and clearEvPick model methods"
```

---

### Task 3: Selection Logic — `selectEvPick`

**Files:**
- Modify: `server/src/services/predictionEngine.ts:178` (after `selectPickOfDay`)

- [ ] **Step 1: Add `selectEvPick` function**

Add after the closing brace of `selectPickOfDay` (after line 178):

```typescript
export async function selectEvPick(date: string) {
  const res = await query(
    `SELECT p.*, ht.name as home_team, at2.name as away_team, t.name as league,
            TO_CHAR(m.kickoff AT TIME ZONE 'Africa/Nairobi', 'HH24:MI') as kickoff_time,
            oh.home_odds, oh.draw_odds, oh.away_odds
     FROM predictions p
     JOIN matches m ON p.match_id = m.id
     JOIN teams ht ON m.home_team_id = ht.id
     JOIN teams at2 ON m.away_team_id = at2.id
     JOIN tournaments t ON m.tournament_id = t.id
     LEFT JOIN LATERAL (SELECT * FROM odds_history WHERE match_id = m.id ORDER BY scraped_at DESC, id DESC LIMIT 1) oh ON true
     WHERE DATE(m.kickoff AT TIME ZONE 'Africa/Nairobi') = $1`,
    [date]
  );

  // Same candidate pool as POTD: must pass qualifiesByOdds
  const qualified = res.rows.filter((c: any) => qualifiesByOdds(
    c.tip as Tip,
    c.home_odds != null ? Number(c.home_odds) : null,
    c.draw_odds != null ? Number(c.draw_odds) : null,
    c.away_odds != null ? Number(c.away_odds) : null,
    Number(c.confidence),
  ));

  // Additional filter: EV > 20%
  const candidates = qualified.filter((c: any) => Number(c.expected_value) >= 0.20);

  await PredictionModel.clearEvPick(date);

  if (candidates.length === 0) {
    logger.info(`No EV pick candidates (EV >= 20%) for ${date}`);
    return null;
  }

  // Sort by EV descending, tiebreak by confidence
  candidates.sort((a: any, b: any) => {
    const evDiff = Number(b.expected_value) - Number(a.expected_value);
    if (evDiff !== 0) return evDiff;
    return (Number(b.confidence) || 0) - (Number(a.confidence) || 0);
  });

  const winner = candidates[0];
  const tipOdds = winner.tip === '1' ? Number(winner.home_odds) :
                  winner.tip === 'X' ? Number(winner.draw_odds) : Number(winner.away_odds);
  const tipLabel = winner.tip === '1' ? 'Home Win' : winner.tip === '2' ? 'Away Win' : 'Draw';
  const reasoning = `${winner.home_team} vs ${winner.away_team}: ${tipLabel} at ${(Number(winner.confidence) * 100).toFixed(0)}% confidence, odds ${tipOdds?.toFixed(2) || 'N/A'}. ` +
    `EV: ${Number(winner.expected_value) > 0 ? '+' : ''}${(Number(winner.expected_value) * 100).toFixed(1)}%. ` +
    `Selected as EV Pick: highest expected value (${(Number(winner.expected_value) * 100).toFixed(1)}%) from ${candidates.length} candidates with EV above 20%.`;

  await query(
    'UPDATE predictions SET is_ev_pick = true, reasoning = CASE WHEN reasoning = $2 OR reasoning = \'\' THEN $2 ELSE reasoning END WHERE id = $1',
    [winner.id, reasoning]
  );

  logger.info(`EV Pick for ${date}: ${winner.home_team} vs ${winner.away_team} (EV: ${(Number(winner.expected_value) * 100).toFixed(1)}%)`);
  return winner;
}
```

Note: The reasoning UPDATE uses a conditional to avoid overwriting POTD reasoning if the same match is both POTD and EV Pick. If the match already has POTD reasoning, we keep it. If it's empty or matches the EV reasoning, we set the EV reasoning.

- [ ] **Step 2: Commit**

```bash
git add server/src/services/predictionEngine.ts
git commit -m "feat: add selectEvPick selection logic (EV >= 20%)"
```

---

### Task 4: API Routes — `/ev-pick` and `/ev-pick-history`

**Files:**
- Modify: `server/src/routes/predictions.ts:27` (after pick-of-day route) and `server/src/routes/predictions.ts:218` (after potd-history route)

- [ ] **Step 1: Add `/ev-pick` endpoint**

Add after the `/pick-of-day` route (after line 27):

```typescript
router.get('/ev-pick', async (req: Request, res: Response) => {
  try {
    const date = (req.query.date as string) || dayjs().tz('Africa/Nairobi').format('YYYY-MM-DD');
    if (!isValidDateString(date)) {
      res.status(400).json({ error: 'Invalid date', date });
      return;
    }
    const pick = await PredictionModel.findEvPick(date);
    res.json({ date, pick: pick || null });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});
```

- [ ] **Step 2: Add `/ev-pick-history` endpoint**

Add after the `/potd-history` route (after the closing of that route handler):

```typescript
router.get('/ev-pick-history', async (req: Request, res: Response) => {
  try {
    const days = parseInt(req.query.days as string) || 30;
    const result = await query(
      `SELECT DATE(m.kickoff AT TIME ZONE 'Africa/Nairobi') as date,
              TO_CHAR(m.kickoff AT TIME ZONE 'Africa/Nairobi', 'HH24:MI') as kickoff_time,
              ht.name as home_team, at2.name as away_team,
              t.name as tournament,
              p.tip, p.confidence, p.expected_value,
              p.potd_rank_score, p.reasoning,
              m.status, m.home_score, m.away_score,
              oh.home_odds, oh.draw_odds, oh.away_odds
       FROM predictions p
       JOIN matches m ON p.match_id = m.id
       JOIN teams ht ON m.home_team_id = ht.id
       JOIN teams at2 ON m.away_team_id = at2.id
       JOIN tournaments t ON m.tournament_id = t.id
       LEFT JOIN LATERAL (SELECT * FROM odds_history WHERE match_id = m.id ORDER BY scraped_at DESC LIMIT 1) oh ON true
       WHERE p.is_ev_pick = true AND DATE(m.kickoff AT TIME ZONE 'Africa/Nairobi') >= $2
       ORDER BY m.kickoff DESC
       LIMIT $1`,
      [days, LAUNCH_DATE]
    );

    const picksByDate = new Map<string, any>();
    for (const r of result.rows) {
      const dateStr = dayjs(r.date).format('YYYY-MM-DD');
      const tipOdds = r.tip === '1' ? Number(r.home_odds) : r.tip === 'X' ? Number(r.draw_odds) : Number(r.away_odds);
      let outcome: 'pending' | 'won' | 'lost' = 'pending';
      if (r.status === 'finished') {
        const actual = r.home_score > r.away_score ? '1' : r.home_score < r.away_score ? '2' : 'X';
        outcome = r.tip === actual ? 'won' : 'lost';
      }
      picksByDate.set(dateStr, {
        date: dateStr,
        kickoffTime: r.kickoff_time || '',
        homeTeam: r.home_team,
        awayTeam: r.away_team,
        tournament: r.tournament,
        tip: r.tip,
        confidence: Number(r.confidence),
        odds: tipOdds || 0,
        ev: Number(r.expected_value),
        score: r.status === 'finished' ? `${r.home_score}-${r.away_score}` : null,
        outcome,
        status: r.status,
        reasoning: r.reasoning || '',
        profit: outcome === 'won' ? +(tipOdds - 1).toFixed(2) : outcome === 'lost' ? -1 : 0,
      });
    }

    const history = Array.from(picksByDate.values())
      .sort((a, b) => b.date.localeCompare(a.date))
      .slice(0, days);

    const withPicks = history.filter((h: any) => h.outcome !== 'none');
    const settled = withPicks.filter((h: any) => h.outcome === 'won' || h.outcome === 'lost');
    const wins = settled.filter((h: any) => h.outcome === 'won').length;
    const totalProfit = settled.reduce((sum: number, h: any) => sum + h.profit, 0);

    res.json({
      history,
      summary: {
        total: withPicks.length,
        settled: settled.length,
        wins,
        losses: settled.length - wins,
        hitRatio: settled.length > 0 ? +(wins / settled.length).toFixed(4) : 0,
        totalProfit: +totalProfit.toFixed(2),
      },
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});
```

- [ ] **Step 3: Commit**

```bash
git add server/src/routes/predictions.ts
git commit -m "feat: add /ev-pick and /ev-pick-history API endpoints"
```

---

### Task 5: Hook `selectEvPick` into Pipeline

**Files:**
- Modify: `server/src/cron/fixtureIngestion.ts:217`
- Modify: `server/src/routes/index.ts:44-58`

- [ ] **Step 1: Call `selectEvPick` in fixture ingestion**

In `server/src/cron/fixtureIngestion.ts`, after line 217 (`await predictionEngine.selectPickOfDay(today);`), add:

```typescript
    await predictionEngine.selectEvPick(today);
```

- [ ] **Step 2: Add manual trigger route for EV pick**

In `server/src/routes/index.ts`, after the `/trigger/potd` route block (after line 58), add:

```typescript
router.post('/trigger/ev-pick', async (req: Request, res: Response) => {
  try {
    const { selectEvPick } = await import('../services/predictionEngine');
    const date = req.query.date as string || new Date().toISOString().slice(0, 10);
    if (!isValidDateString(date)) {
      res.status(400).json({ error: 'Invalid date', date });
      return;
    }
    const result = await selectEvPick(date);
    res.json({ status: 'ok', date, pick: result?.id || null });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});
```

- [ ] **Step 3: Commit**

```bash
git add server/src/cron/fixtureIngestion.ts server/src/routes/index.ts
git commit -m "feat: hook selectEvPick into ingestion pipeline and add manual trigger"
```

---

### Task 6: Client API and Hooks

**Files:**
- Modify: `client/src/api/client.ts:61` (after `fetchPotdHistory`)
- Modify: `client/src/hooks/useMatches.ts:72` (after `usePotdHistory`)

- [ ] **Step 1: Add API client functions**

In `client/src/api/client.ts`, add after the `fetchPotdHistory` function (after line 61):

```typescript
export async function fetchEvPick(date: string) {
  const { data } = await api.get(`/predictions/ev-pick?date=${date}`);
  return data;
}

export async function fetchEvPickHistory(days: number = 30) {
  const { data } = await api.get(`/predictions/ev-pick-history?days=${days}`);
  return data;
}
```

- [ ] **Step 2: Add React Query hooks**

In `client/src/hooks/useMatches.ts`, add after the `usePotdHistory` function (after line 72):

First, update the import on line 1 to include the new functions:

```typescript
import { fetchMatches, fetchPickOfDay, fetchPerformance, fetchDailyPL, fetchAccumulators, fetchSettled, fetchPotdHistory, fetchEvPick, fetchEvPickHistory } from '../api/client';
```

Then add after `usePotdHistory`:

```typescript
export function useEvPick(date: string) {
  return useQuery({
    queryKey: ['ev-pick', date],
    queryFn: () => fetchEvPick(date),
    enabled: !!date,
    refetchInterval: 90000,
    staleTime: 600000,
    placeholderData: keepPreviousData,
  });
}

export function useEvPickHistory() {
  return useQuery({
    queryKey: ['ev-pick-history'],
    queryFn: () => fetchEvPickHistory(30),
    refetchInterval: 300000,
  });
}
```

- [ ] **Step 3: Commit**

```bash
git add client/src/api/client.ts client/src/hooks/useMatches.ts
git commit -m "feat: add EV pick API client functions and React Query hooks"
```

---

### Task 7: EvPickCard Component

**Files:**
- Create: `client/src/components/EvPickCard.tsx`

- [ ] **Step 1: Create the EvPickCard component**

Create `client/src/components/EvPickCard.tsx`:

```tsx
import InfoTip from './InfoTip';

interface EvPickCardProps {
  data: any;
  loading: boolean;
}

function OddsCell({ label, value, isTipped }: { label: string; value: number | string | null | undefined; isTipped: boolean }) {
  if (value == null) {
    return (
      <div className="text-center">
        <div className="text-xs" style={{ color: 'var(--text-secondary)' }}>{label}</div>
        <div className="font-mono text-sm" style={{ color: 'var(--text-secondary)' }}>-</div>
      </div>
    );
  }
  const n = Number(value);
  const isValueRange = n >= 1.50 && n <= 1.99;
  const bg = isTipped
    ? 'rgba(99,102,241,0.18)'
    : isValueRange
    ? 'rgba(34,197,94,0.12)'
    : 'transparent';
  const color = isTipped
    ? 'var(--accent-blue)'
    : isValueRange
    ? 'var(--accent-green)'
    : 'var(--text-primary)';
  return (
    <div
      className="text-center"
      style={{
        background: bg,
        borderRadius: 4,
        padding: '2px 4px',
      }}
    >
      <div className="text-xs" style={{ color: 'var(--text-secondary)' }}>{label}</div>
      <div className="font-mono text-sm font-bold" style={{ color }}>
        {n.toFixed(2)}
      </div>
    </div>
  );
}

export default function EvPickCard({ data, loading }: EvPickCardProps) {
  if (loading) {
    return (
      <div className="card animate-pulse" style={{ borderColor: '#6366f1', borderWidth: '2px' }}>
        <div className="h-24 rounded" style={{ background: 'var(--bg-primary)' }}></div>
      </div>
    );
  }

  const pick = data?.pick;

  if (!pick) {
    return (
      <div className="card" style={{ borderColor: 'var(--border)' }}>
        <div className="text-center py-4">
          <h2 className="text-lg font-bold mb-1" style={{ color: 'var(--text-secondary)' }}>
            EV Pick of the Day
          </h2>
          <p style={{ color: 'var(--text-secondary)' }}>
            No matches with EV above 20% found for this date.
          </p>
          <p className="text-sm mt-1" style={{ color: 'var(--text-secondary)' }}>
            Requires qualifying value bet with expected value &gt;= 20%.
          </p>
        </div>
      </div>
    );
  }

  const tipLabel = pick.tip === '1' ? 'Home Win' : pick.tip === '2' ? 'Away Win' : 'Draw';
  const confidence = (Number(pick.confidence) * 100).toFixed(1);
  const ev = (Number(pick.expected_value) * 100).toFixed(1);
  const kickoff = new Date(pick.kickoff).toLocaleTimeString('en-US', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    timeZone: 'Africa/Nairobi',
  });

  return (
    <div className="card relative overflow-hidden" style={{ borderColor: '#6366f1', borderWidth: '2px' }}>
      <div
        className="absolute top-0 left-0 right-0 h-1"
        style={{ background: 'linear-gradient(90deg, #6366f1, #818cf8)' }}
      ></div>

      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <span className="text-xl">&#128200;</span>
          <h2 className="text-lg font-bold" style={{ color: '#6366f1' }}>
            EV Pick of the Day<InfoTip text="The match with the highest Expected Value (EV >= 20%) from today's qualifying value bets" />
          </h2>
        </div>
        <span className="badge badge-green">{tipLabel}</span>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="flex flex-col items-center md:items-start">
          <p className="text-sm mb-1" style={{ color: 'var(--text-secondary)' }}>
            {pick.tournament} &middot; {kickoff} EAT
          </p>
          <div className="flex items-center gap-3">
            <span className="text-lg font-bold">{pick.home_team}</span>
            <span style={{ color: 'var(--text-secondary)' }}>vs</span>
            <span className="text-lg font-bold">{pick.away_team}</span>
          </div>
          {pick.status === 'finished' && (() => {
            const actual = pick.home_score > pick.away_score ? '1' : pick.home_score < pick.away_score ? '2' : 'X';
            const won = pick.tip === actual;
            return (
              <p className="text-xl font-bold mt-1" style={{ color: won ? 'var(--accent-green)' : 'var(--accent-red)' }}>
                {pick.home_score} - {pick.away_score} {won ? '\u2713' : '\u2717'}
              </p>
            );
          })()}
        </div>

        <div className="flex flex-col gap-3">
          <div className="grid grid-cols-2 gap-3">
            <div className="text-center">
              <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>Win Prob<InfoTip text="The estimated probability of the tipped outcome winning" /></p>
              <p className="text-2xl font-bold" style={{ color: 'var(--accent-green)' }}>
                {confidence}%
              </p>
            </div>
            <div className="text-center">
              <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>Expected Value<InfoTip text="EV = (probability x odds) - 1. This pick was selected for having the highest EV (>= 20%)" /></p>
              <p
                className="text-2xl font-bold"
                style={{ color: Number(pick.expected_value) > 0 ? 'var(--accent-green)' : 'var(--accent-red)' }}
              >
                {Number(pick.expected_value) > 0 ? '+' : ''}{ev}%
              </p>
            </div>
          </div>
          <div>
            <p className="text-sm text-center" style={{ color: 'var(--text-secondary)' }}>
              Odds (H / D / A)<InfoTip text="Decimal odds for Home / Draw / Away. Blue = tipped side. Green highlight = value range 1.50-1.99" />
            </p>
            <div className="grid grid-cols-3 gap-2 mt-1">
              <OddsCell label="H" value={pick.home_odds} isTipped={pick.tip === '1'} />
              <OddsCell label="D" value={pick.draw_odds} isTipped={pick.tip === 'X'} />
              <OddsCell label="A" value={pick.away_odds} isTipped={pick.tip === '2'} />
            </div>
          </div>
        </div>

      </div>

      {pick.reasoning && (
        <div className="mt-3 pt-3" style={{ borderTop: '1px solid var(--border)' }}>
          <p className="text-xs" style={{ color: 'var(--text-secondary)' }}>
            <span className="font-semibold" style={{ color: '#6366f1' }}>EV Analysis: </span>
            {pick.reasoning}
          </p>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add client/src/components/EvPickCard.tsx
git commit -m "feat: add EvPickCard component with blue/indigo accent"
```

---

### Task 8: EvPickHistory Component

**Files:**
- Create: `client/src/components/EvPickHistory.tsx`

- [ ] **Step 1: Create the EvPickHistory component**

Create `client/src/components/EvPickHistory.tsx`:

```tsx
import { useMemo } from 'react';
import dayjs from 'dayjs';
import InfoTip from './InfoTip';

interface EvPickEntry {
  date: string;
  kickoffTime: string;
  homeTeam: string;
  awayTeam: string;
  tournament: string;
  tip: string;
  confidence: number;
  odds: number;
  ev: number;
  score: string | null;
  outcome: 'pending' | 'won' | 'lost';
  status?: string;
  reasoning: string;
  profit: number;
}

interface EvPickHistoryProps {
  data: {
    history: EvPickEntry[];
    summary: {
      total: number;
      settled: number;
      wins: number;
      losses: number;
      hitRatio: number;
      totalProfit: number;
    };
  } | undefined;
}

interface EntryWithStake extends EvPickEntry {
  stake: number;
  plKes: number;
  balanceKes: number;
}

interface MonthGroup {
  month: string;
  label: string;
  entries: EntryWithStake[];
  total: number;
  settled: number;
  wins: number;
  losses: number;
  hitRatio: number;
  totalPLKes: number;
}

const BASE_STAKE = 1000;
const LOSS_MULTIPLIER = 3;

const tipLabel = (t: string) => (t === '1' ? 'H' : t === '2' ? 'A' : 'D');

function formatAmount(amount: number): string {
  const abs = Math.abs(amount);
  const formatted = abs >= 1000
    ? abs.toLocaleString('en-KE', { minimumFractionDigits: 0, maximumFractionDigits: 0 })
    : abs.toFixed(0);
  if (amount > 0) return `+${formatted}`;
  if (amount < 0) return `-${formatted}`;
  return '0';
}

function groupByMonth(history: EvPickEntry[]): MonthGroup[] {
  const map = new Map<string, EvPickEntry[]>();
  for (const h of history) {
    const key = dayjs(h.date).format('YYYY-MM');
    if (!map.has(key)) map.set(key, []);
    map.get(key)!.push(h);
  }

  const groups: MonthGroup[] = [];
  for (const [month, rawEntries] of map.entries()) {
    const sorted = [...rawEntries].sort((a, b) => a.date.localeCompare(b.date));

    let stake = BASE_STAKE;
    let runningPL = 0;
    const entries: EntryWithStake[] = sorted.map((e) => {
      const isVoid = e.outcome === 'pending' && (e.status === 'cancelled' || e.status === 'postponed');

      if (e.outcome === 'won') {
        const pl = Math.round(stake * (e.odds - 1));
        runningPL += pl;
        const entry: EntryWithStake = { ...e, stake, plKes: pl, balanceKes: runningPL };
        stake = BASE_STAKE;
        return entry;
      } else if (e.outcome === 'lost') {
        const pl = -stake;
        runningPL += pl;
        const entry: EntryWithStake = { ...e, stake, plKes: pl, balanceKes: runningPL };
        stake = stake * LOSS_MULTIPLIER;
        return entry;
      } else if (isVoid) {
        return { ...e, stake: 0, plKes: 0, balanceKes: runningPL };
      } else {
        return { ...e, stake, plKes: 0, balanceKes: runningPL };
      }
    });

    entries.reverse();

    const settledEntries = entries.filter(e => e.outcome === 'won' || e.outcome === 'lost');
    const wins = settledEntries.filter(e => e.outcome === 'won').length;
    const losses = settledEntries.length - wins;
    const hitRatio = settledEntries.length > 0 ? wins / settledEntries.length : 0;

    groups.push({
      month,
      label: dayjs(month + '-01').format('MMMM YYYY'),
      entries,
      total: rawEntries.length,
      settled: settledEntries.length,
      wins,
      losses,
      hitRatio,
      totalPLKes: runningPL,
    });
  }

  groups.sort((a, b) => b.month.localeCompare(a.month));
  return groups;
}

export default function EvPickHistory({ data }: EvPickHistoryProps) {
  const history = data?.history ?? [];
  const monthGroups = useMemo(() => groupByMonth(history), [history]);

  if (!data || history.length === 0) return null;

  const { summary } = data;
  const totalPLKes = monthGroups.reduce((sum, g) => sum + g.totalPLKes, 0);

  return (
    <div className="card">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-bold" style={{ color: 'var(--text-primary)' }}>
          &#128200; EV Pick History
          <InfoTip text="Martingale staking: KSh 1,000 base stake. On loss, next stake is 3x. On win, reset to KSh 1,000. Resets each month." />
        </h2>
        {summary.settled > 0 && (
          <div className="flex items-center gap-4 text-sm">
            <span>
              <span style={{ color: 'var(--accent-green)', fontWeight: 700 }}>{summary.wins}W</span>
              <span style={{ color: 'var(--text-secondary)' }}> - </span>
              <span style={{ color: 'var(--accent-red)', fontWeight: 700 }}>{summary.losses}L</span>
            </span>
            <span style={{ color: 'var(--text-secondary)' }}>
              Hit: <span style={{ color: summary.hitRatio >= 0.6 ? 'var(--accent-green)' : 'var(--accent-red)', fontWeight: 700 }}>
                {(summary.hitRatio * 100).toFixed(0)}%
              </span>
            </span>
            <span style={{ color: totalPLKes >= 0 ? 'var(--accent-green)' : 'var(--accent-red)', fontWeight: 700 }}>
              {formatAmount(totalPLKes)}
            </span>
          </div>
        )}
      </div>

      <div className="flex flex-col gap-2">
        {monthGroups.map((g) => (
          <details key={g.month} style={{ border: '1px solid var(--border)', borderRadius: 6 }}>
            <summary
              className="cursor-pointer px-3 py-2 flex items-center justify-between flex-wrap gap-2"
              style={{ background: 'var(--bg-primary)', listStyle: 'none' }}
            >
              <span className="font-semibold text-sm">{g.label}</span>
              <span className="flex items-center gap-3 text-xs" style={{ color: 'var(--text-secondary)' }}>
                <span>{g.total} pick{g.total !== 1 ? 's' : ''}</span>
                {g.settled > 0 && (
                  <>
                    <span>
                      <span style={{ color: 'var(--accent-green)', fontWeight: 700 }}>{g.wins}W</span>
                      <span> - </span>
                      <span style={{ color: 'var(--accent-red)', fontWeight: 700 }}>{g.losses}L</span>
                    </span>
                    <span>
                      Hit: <span style={{ color: g.hitRatio >= 0.6 ? 'var(--accent-green)' : 'var(--accent-red)', fontWeight: 700 }}>
                        {(g.hitRatio * 100).toFixed(0)}%
                      </span>
                    </span>
                    <span style={{ color: g.totalPLKes >= 0 ? 'var(--accent-green)' : 'var(--accent-red)', fontWeight: 700 }}>
                      {formatAmount(g.totalPLKes)}
                    </span>
                  </>
                )}
              </span>
            </summary>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr style={{ color: 'var(--text-secondary)', fontSize: 12, borderBottom: '1px solid var(--border)' }}>
                    <th className="text-left py-2 px-2 font-medium">Date</th>
                    <th className="text-center py-2 px-2 font-medium">Time</th>
                    <th className="text-left py-2 px-2 font-medium">Match</th>
                    <th className="text-left py-2 px-2 font-medium">League</th>
                    <th className="text-center py-2 px-2 font-medium">Tip</th>
                    <th className="text-center py-2 px-2 font-medium">Odds</th>
                    <th className="text-center py-2 px-2 font-medium">EV</th>
                    <th className="text-center py-2 px-2 font-medium">Score</th>
                    <th className="text-center py-2 px-2 font-medium">Result</th>
                    <th className="text-right py-2 px-2 font-medium">Stake</th>
                    <th className="text-right py-2 px-2 font-medium">P&L</th>
                    <th className="text-right py-2 px-2 font-medium">Balance</th>
                  </tr>
                </thead>
                <tbody>
                  {g.entries.map((h, i) => {
                    const isVoid = h.outcome === 'pending' && (h.status === 'cancelled' || h.status === 'postponed');
                    const voidLabel = h.status === 'cancelled' ? 'CAN' : 'PPD';
                    const outcomeColor = h.outcome === 'won' ? 'var(--accent-green)'
                      : h.outcome === 'lost' ? 'var(--accent-red)'
                      : isVoid ? (h.status === 'cancelled' ? 'var(--text-secondary)' : '#f59e0b')
                      : 'var(--text-secondary)';
                    const dateStr = new Date(h.date + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
                    const dayStr = new Date(h.date + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'short' });
                    const isSettled = h.outcome === 'won' || h.outcome === 'lost';
                    return (
                      <tr
                        key={i}
                        style={{
                          borderBottom: '1px solid var(--border)',
                          background: h.outcome === 'won' ? 'rgba(34,197,94,0.04)' : h.outcome === 'lost' ? 'rgba(239,68,68,0.04)' : 'transparent',
                        }}
                      >
                        <td className="py-2.5 px-2">
                          <div className="text-xs font-medium">{dateStr}</div>
                          <div className="text-xs" style={{ color: 'var(--text-secondary)' }}>{dayStr}</div>
                        </td>
                        <td className="py-2.5 px-2 text-center text-xs" style={{ color: 'var(--text-secondary)' }}>
                          {h.kickoffTime || '-'}
                        </td>
                        <td className="py-2.5 px-2 font-medium text-sm">
                          {h.homeTeam} vs {h.awayTeam}
                        </td>
                        <td className="py-2.5 px-2 text-xs" style={{ color: 'var(--text-secondary)' }}>
                          {h.tournament}
                        </td>
                        <td className="py-2.5 px-2 text-center">
                          <span className="badge badge-green">{tipLabel(h.tip)}</span>
                        </td>
                        <td className="py-2.5 px-2 text-center font-mono text-xs"
                          style={{ color: h.odds >= 1.5 && h.odds <= 2.0 ? 'var(--accent-green)' : 'var(--text-secondary)', fontWeight: h.odds >= 1.5 && h.odds <= 2.0 ? 700 : 400 }}>
                          {h.odds.toFixed(2)}
                        </td>
                        <td className="py-2.5 px-2 text-center">
                          <span style={{ color: h.ev > 0 ? 'var(--accent-green)' : 'var(--accent-red)', fontSize: 12, fontWeight: 600 }}>
                            {h.ev > 0 ? '+' : ''}{(h.ev * 100).toFixed(1)}%
                          </span>
                        </td>
                        <td className="py-2.5 px-2 text-center font-bold" style={{ color: outcomeColor }}>
                          {isVoid ? voidLabel : (h.score || '-')}
                        </td>
                        <td className="py-2.5 px-2 text-center">
                          <span
                            className="px-2 py-0.5 rounded-full text-xs font-bold"
                            style={{
                              background: h.outcome === 'won' ? 'rgba(34,197,94,0.15)'
                                : h.outcome === 'lost' ? 'rgba(239,68,68,0.15)'
                                : isVoid ? (h.status === 'cancelled' ? 'rgba(148,163,184,0.15)' : 'rgba(245,158,11,0.15)')
                                : 'rgba(148,163,184,0.15)',
                              color: outcomeColor,
                            }}
                          >
                            {h.outcome === 'won' ? 'WON' : h.outcome === 'lost' ? 'LOST' : isVoid ? voidLabel : 'PENDING'}
                          </span>
                        </td>
                        <td className="py-2.5 px-2 text-right font-mono text-xs" style={{ color: h.stake > BASE_STAKE ? 'var(--accent-red)' : 'var(--text-secondary)' }}>
                          {isVoid ? '-' : h.stake.toLocaleString('en-KE')}
                        </td>
                        <td className="py-2.5 px-2 text-right font-bold text-sm" style={{ color: outcomeColor }}>
                          {isSettled ? formatAmount(h.plKes) : '-'}
                        </td>
                        <td className="py-2.5 px-2 text-right font-bold text-sm" style={{ color: h.balanceKes >= 0 ? 'var(--accent-green)' : 'var(--accent-red)' }}>
                          {isSettled || isVoid ? formatAmount(h.balanceKes) : '-'}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </details>
        ))}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add client/src/components/EvPickHistory.tsx
git commit -m "feat: add EvPickHistory component with blue accent and Martingale staking"
```

---

### Task 9: Wire Components into PredictionsPage

**Files:**
- Modify: `client/src/pages/PredictionsPage.tsx`

- [ ] **Step 1: Add imports**

In `client/src/pages/PredictionsPage.tsx`, update the imports:

After line 8 (`import PotdHistory from '../components/PotdHistory';`), add:

```typescript
import EvPickCard from '../components/EvPickCard';
import EvPickHistory from '../components/EvPickHistory';
```

Update the hooks import on line 11 to include the new hooks:

```typescript
import { useMatches, usePickOfDay, useAccumulators, useSettled, usePotdHistory, useEvPick, useEvPickHistory } from '../hooks/useMatches';
```

- [ ] **Step 2: Add hook calls**

After line 31 (`const { data: potdHistoryData } = usePotdHistory();`), add:

```typescript
  const { data: evPickData, isLoading: evPickLoading } = useEvPick(
    matchData?.matches?.length !== undefined ? date : ''
  );
  const { data: evPickHistoryData } = useEvPickHistory();
```

- [ ] **Step 3: Add components to the JSX**

After the `<PickOfDayCard>` line (line 86), add:

```tsx
        <EvPickCard data={evPickData} loading={evPickLoading} />
```

After the `<PotdHistory>` line (line 96), add:

```tsx
        <EvPickHistory data={evPickHistoryData} />
```

- [ ] **Step 4: Commit**

```bash
git add client/src/pages/PredictionsPage.tsx
git commit -m "feat: wire EvPickCard and EvPickHistory into PredictionsPage"
```

---

### Task 10: Build and Verify

- [ ] **Step 1: Build server**

```bash
cd server && npx tsc
```

Expected: No TypeScript errors.

- [ ] **Step 2: Build client**

```bash
cd client && npx vite build
```

Expected: Build succeeds with no errors.

- [ ] **Step 3: Commit build if any generated files changed**

If the build produces changes to tracked files, commit them. Otherwise skip.
