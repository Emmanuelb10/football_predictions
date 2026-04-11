# Predictions Page Refinements Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement five bundled refinements to the predictions page: rules enforcement consistency + DB cleanup, POTD card full H/D/A odds, collapsible monthly POTD history, collapsible glossary, and date-in-URL routing.

**Architecture:** Six sequential phases. Phases 1–2 are server-side correctness fixes (shared qualifier, filter call-site updates, one-time DB cleanup). Phases 3–5 are isolated client component changes. Phase 6 adds client-side routing via react-router-dom. Each phase is independently reviewable and produces a working app.

**Tech Stack:** TypeScript, Express, PostgreSQL 17 via raw `pg` (transactions via `getClient()`), React 19, Vite, TailwindCSS 4, React Query 5, `react-router-dom@^6` (new), `dayjs` with `customParseFormat`/`utc`/`timezone` plugins.

**Reference spec:** `docs/superpowers/specs/2026-04-11-date-url-routing-design.md`

**Verification model:** The repo has no test framework (`CLAUDE.md`: "There are no tests or linting configured"). Each task uses curl or UI observation for before/after comparison instead of automated tests. Each phase ends with an explicit verification step.

---

## Phase 0 — Pre-flight baseline

Capture the current behavior before any code change. These snapshots become the "before" in our before/after comparisons.

### Task 0.1: Create baseline directory and capture API snapshots

**Files:**
- Create: `.baselines/README.md`
- Create: `.baselines/` (directory for JSON captures, git-ignored)

- [ ] **Step 1: Create the baseline directory**

```bash
mkdir -p .baselines
```

- [ ] **Step 2: Add to `.gitignore`**

Modify: `.gitignore` — add the line `/.baselines/` near the top.

- [ ] **Step 3: Capture today's key endpoints**

Run each command from the repo root:

```bash
curl -s 'http://localhost:3001/api/predictions/pick-of-day?date=2026-04-11' > .baselines/potd-2026-04-11.json
curl -s 'http://localhost:3001/api/matches?date=2026-04-11' > .baselines/matches-2026-04-11.json
curl -s 'http://localhost:3001/api/predictions/accumulators?date=2026-04-11' > .baselines/acca-2026-04-11.json
curl -s 'http://localhost:3001/api/predictions/potd-history?days=90' > .baselines/potd-history.json
```

- [ ] **Step 4: Verify the snapshots contain data**

Run:
```bash
wc -c .baselines/*.json
```

Expected: every file is > 100 bytes (non-empty JSON). If any is empty, the server is not running — start it before proceeding.

- [ ] **Step 5: Confirm today's broken POTD**

Run:
```bash
cat .baselines/potd-2026-04-11.json | grep -o '"home_team":"[^"]*"'
```

Expected output: `"home_team":"Cercle Brugge"` — confirms we're snapshotting the pre-fix state where today's POTD is the non-conforming Cercle Brugge pick.

---

## Phase 1 — Rules enforcement code-path fix

Introduce the shared `qualifiesByOdds` helper, delete `isValueBet`, rewire all filter sites, remove the POTD fallback, and add server-side date validation. No DB data changes in this phase — only code.

### Task 1.1: Create the shared qualification helper

**Files:**
- Create: `server/src/utils/qualification.ts`

- [ ] **Step 1: Create the file**

Write to `server/src/utils/qualification.ts`:

```ts
export const TIP_ODDS_MIN = 1.50;
export const TIP_ODDS_MAX = 1.99;
export const OPPOSING_ODDS_MIN = 5.00;
export const MIN_PROBABILITY = 0.70;

export type Tip = '1' | 'X' | '2';

/**
 * The single source of truth for "is this match a qualifying pick".
 *
 * Rules:
 * - probability >= 0.70
 * - tipped-side odds in [1.50, 1.99] (inclusive)
 * - opposing side odds >= 5.00
 *   - For home tips (1), opposing = away_odds
 *   - For away tips (2), opposing = home_odds
 *   - For draw tips (X), opposing = min(home_odds, away_odds) — both must be >= 5.00
 *
 * Returns false if any odds value is null (cannot assess without data).
 */
export function qualifiesByOdds(
  tip: Tip,
  homeOdds: number | null,
  drawOdds: number | null,
  awayOdds: number | null,
  probability: number
): boolean {
  if (probability < MIN_PROBABILITY) return false;
  if (homeOdds == null || drawOdds == null || awayOdds == null) return false;

  let tipOdds: number;
  let opposingOdds: number;

  if (tip === '1') {
    tipOdds = homeOdds;
    opposingOdds = awayOdds;
  } else if (tip === '2') {
    tipOdds = awayOdds;
    opposingOdds = homeOdds;
  } else {
    tipOdds = drawOdds;
    opposingOdds = Math.min(homeOdds, awayOdds);
  }

  if (tipOdds < TIP_ODDS_MIN || tipOdds > TIP_ODDS_MAX) return false;
  if (opposingOdds < OPPOSING_ODDS_MIN) return false;
  return true;
}
```

- [ ] **Step 2: Compile**

Run:
```bash
cd server && npx tsc
```

Expected: no output, exit code 0.

### Task 1.2: Wire qualifier into fixture ingestion

**Files:**
- Modify: `server/src/cron/fixtureIngestion.ts:71-87`

- [ ] **Step 1: Read the current filter**

Read `server/src/cron/fixtureIngestion.ts` lines 71-87. Note the inline filter that computes `tip`, `tipOdds`, and `opposingOdds`.

- [ ] **Step 2: Replace the inline filter**

Replace the block at lines 68-87:

```ts
    // Only process matches with 70%+ probability AND tipped odds 1.50-1.99
    // AND opposing side odds >= 5.00 (heavy underdog — the weaker team is priced
    // as a long shot, confirming the market agrees with the high-confidence pick).
    const withPredictions = fixtures.filter(f => {
      if (!f.homeOdds || !f.drawOdds || !f.awayOdds) return false;
      if (!f.homeWinProb || !f.drawProb || !f.awayWinProb) return false;

      const maxProb = Math.max(f.homeWinProb, f.drawProb, f.awayWinProb);
      if (maxProb < 0.70) return false;

      const tip = f.tip || (f.homeWinProb >= f.drawProb && f.homeWinProb >= f.awayWinProb ? '1' :
        f.drawProb >= f.awayWinProb ? 'X' : '2');
      const tipOdds = tip === '1' ? f.homeOdds : tip === '2' ? f.awayOdds : f.drawOdds;
      if (tipOdds < 1.50 || tipOdds > 1.99) return false;

      // Opposing side must be a heavy underdog (>= 5.00). For home/away tips, the
      // opposing side is the other team. For draw tips, both sides must be >= 5.00.
      const opposingOdds = tip === '1' ? f.awayOdds : tip === '2' ? f.homeOdds : Math.min(f.homeOdds, f.awayOdds);
      return opposingOdds >= 5.00;
    });
```

with:

```ts
    // Only process matches that satisfy the shared qualification rule.
    const withPredictions = fixtures.filter(f => {
      if (!f.homeWinProb || !f.drawProb || !f.awayWinProb) return false;
      const maxProb = Math.max(f.homeWinProb, f.drawProb, f.awayWinProb);
      const tip: Tip = (f.tip as Tip) ||
        (f.homeWinProb >= f.drawProb && f.homeWinProb >= f.awayWinProb ? '1' :
         f.drawProb >= f.awayWinProb ? 'X' : '2');
      return qualifiesByOdds(
        tip,
        f.homeOdds ?? null,
        f.drawOdds ?? null,
        f.awayOdds ?? null,
        maxProb,
      );
    });
```

- [ ] **Step 3: Add the import at the top of the file**

Add to the imports block (after the existing `* as OddsModel` line around line 16):

```ts
import { qualifiesByOdds, type Tip } from '../utils/qualification';
```

- [ ] **Step 4: Compile**

Run:
```bash
cd server && npx tsc
```

Expected: no errors.

### Task 1.3: Wire qualifier into the matches route

**Files:**
- Modify: `server/src/routes/matches.ts:85-94`

- [ ] **Step 1: Add import**

At the top of `server/src/routes/matches.ts`, add:

```ts
import { qualifiesByOdds, type Tip } from '../utils/qualification';
```

- [ ] **Step 2: Replace the inline filter at lines 85-94**

Replace the block:

```ts
    // Filter: 70%+ probability AND tipped odds 1.50-1.99 AND opposing side >= 5.00
    const filtered = enriched.filter((m: any) => {
      const conf = Number(m.confidence) || 0;
      if (conf < 0.70) return false;
      if (!m.odds || m.odds.length === 0) return false;
      const o = m.odds[0];
      const tipOdds = m.tip === '1' ? o.home : m.tip === '2' ? o.away : o.draw;
      if (tipOdds < 1.50 || tipOdds > 1.99) return false;
      const opposingOdds = m.tip === '1' ? o.away : m.tip === '2' ? o.home : Math.min(o.home, o.away);
      return opposingOdds >= 5.00;
    });
```

with:

```ts
    // Filter by the shared qualification rule.
    const filtered = enriched.filter((m: any) => {
      if (!m.tip || !m.odds || m.odds.length === 0) return false;
      const o = m.odds[0];
      return qualifiesByOdds(
        m.tip as Tip,
        o.home ?? null,
        o.draw ?? null,
        o.away ?? null,
        Number(m.confidence) || 0,
      );
    });
```

- [ ] **Step 3: Compile**

```bash
cd server && npx tsc
```

Expected: no errors.

### Task 1.4: Wire qualifier into `storePrediction` (replaces `isValueBet`)

**Files:**
- Modify: `server/src/services/predictionEngine.ts:44-58`

- [ ] **Step 1: Add imports**

At the top of `server/src/services/predictionEngine.ts`, change the import line that reads:

```ts
import { calculateEV, isValueBet } from '../utils/expectedValue';
```

to:

```ts
import { calculateEV } from '../utils/expectedValue';
import { qualifiesByOdds, type Tip } from '../utils/qualification';
```

- [ ] **Step 2: Replace the value-bet computation in `storePrediction`**

Locate lines 44-58 (the function body from `async function storePrediction` through `valueBet = isValueBet(...)`). Replace the block:

```ts
async function storePrediction(matchId: number, pred: PredictionInput, matchApiId: number, source: string) {
  const { homeWinProb, drawProb, awayWinProb, tip, confidence } = pred;

  const odds = await OddsModel.getLatestOdds(matchId);
  let ev = 0;
  let valueBet = false;

  if (odds) {
    const tipOdds =
      tip === '1' ? Number(odds.home_odds) :
      tip === 'X' ? Number(odds.draw_odds) :
      Number(odds.away_odds);
    ev = calculateEV(confidence, tipOdds);
    valueBet = isValueBet(confidence, tipOdds);
  }
```

with:

```ts
async function storePrediction(matchId: number, pred: PredictionInput, matchApiId: number, source: string) {
  const { homeWinProb, drawProb, awayWinProb, tip, confidence } = pred;

  const odds = await OddsModel.getLatestOdds(matchId);
  let ev = 0;
  let valueBet = false;

  if (odds) {
    const tipOdds =
      tip === '1' ? Number(odds.home_odds) :
      tip === 'X' ? Number(odds.draw_odds) :
      Number(odds.away_odds);
    ev = calculateEV(confidence, tipOdds);
    valueBet = qualifiesByOdds(
      tip as Tip,
      odds.home_odds != null ? Number(odds.home_odds) : null,
      odds.draw_odds != null ? Number(odds.draw_odds) : null,
      odds.away_odds != null ? Number(odds.away_odds) : null,
      confidence,
    );
  }
```

- [ ] **Step 3: Compile**

```bash
cd server && npx tsc
```

Expected: no errors. If you see "Cannot find name 'isValueBet'" elsewhere, note the file and move on — those call sites are addressed in Task 1.6.

### Task 1.5: Update `selectPickOfDay` to enforce the rule and remove the fallback

**Files:**
- Modify: `server/src/services/predictionEngine.ts:107-148`

- [ ] **Step 1: Replace the `selectPickOfDay` candidate-loading block**

Replace lines 107-148 (from `export async function selectPickOfDay(date: string)` through the end of the candidates loading / fallback). The new version:
1. Runs the same SELECT to fetch value-bet candidates with all three odds.
2. Filters the result set in JS using `qualifiesByOdds`.
3. Removes the `confidence >= 0.55` fallback entirely.

Replace:

```ts
export async function selectPickOfDay(date: string) {
  // First try value bets; if none, fall back to top confidence picks
  let res = await query(
    `SELECT p.*, ht.name as home_team, at2.name as away_team, t.name as league,
            TO_CHAR(m.kickoff AT TIME ZONE 'Africa/Nairobi', 'HH24:MI') as kickoff_time,
            oh.home_odds, oh.draw_odds, oh.away_odds
     FROM predictions p
     JOIN matches m ON p.match_id = m.id
     JOIN teams ht ON m.home_team_id = ht.id
     JOIN teams at2 ON m.away_team_id = at2.id
     JOIN tournaments t ON m.tournament_id = t.id
     LEFT JOIN LATERAL (SELECT * FROM odds_history WHERE match_id = m.id ORDER BY scraped_at DESC LIMIT 1) oh ON true
     WHERE p.is_value_bet = true AND DATE(m.kickoff AT TIME ZONE 'Africa/Nairobi') = $1`,
    [date]
  );
  let candidates = res.rows;

  // Fallback: pick from top confidence instead
  if (candidates.length === 0) {
    logger.info(`No value bets for ${date}, selecting POTD from top confidence picks`);
    res = await query(
      `SELECT p.*, ht.name as home_team, at2.name as away_team, t.name as league,
              TO_CHAR(m.kickoff AT TIME ZONE 'Africa/Nairobi', 'HH24:MI') as kickoff_time,
              oh.home_odds, oh.draw_odds, oh.away_odds
       FROM predictions p
       JOIN matches m ON p.match_id = m.id
       JOIN teams ht ON m.home_team_id = ht.id
       JOIN teams at2 ON m.away_team_id = at2.id
       JOIN tournaments t ON m.tournament_id = t.id
       LEFT JOIN LATERAL (SELECT * FROM odds_history WHERE match_id = m.id ORDER BY scraped_at DESC LIMIT 1) oh ON true
       WHERE p.confidence >= 0.55 AND DATE(m.kickoff AT TIME ZONE 'Africa/Nairobi') = $1
       ORDER BY p.confidence DESC
       LIMIT 10`,
      [date]
    );
    candidates = res.rows;
  }

  if (candidates.length === 0) {
    logger.info(`No qualifying picks for ${date}`);
    return null;
  }
```

with:

```ts
export async function selectPickOfDay(date: string) {
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
     WHERE p.is_value_bet = true AND DATE(m.kickoff AT TIME ZONE 'Africa/Nairobi') = $1`,
    [date]
  );

  // Post-filter in JS using the shared qualifier. This catches stale is_value_bet
  // flags and any edge case the SQL filter alone cannot express.
  const candidates = res.rows.filter((c: any) => qualifiesByOdds(
    c.tip as Tip,
    c.home_odds != null ? Number(c.home_odds) : null,
    c.draw_odds != null ? Number(c.draw_odds) : null,
    c.away_odds != null ? Number(c.away_odds) : null,
    Number(c.confidence),
  ));

  if (candidates.length === 0) {
    logger.info(`No qualifying picks for ${date}`);
    await PredictionModel.clearPickOfDay(date);
    return null;
  }
```

- [ ] **Step 2: Compile**

```bash
cd server && npx tsc
```

Expected: no errors.

### Task 1.6: Delete `isValueBet` from `expectedValue.ts`

**Files:**
- Modify: `server/src/utils/expectedValue.ts`

- [ ] **Step 1: Verify no other call sites remain**

```bash
cd server && grep -rn "isValueBet" src/
```

Expected: zero matches (Task 1.4 was the only call site). If any match is found, stop and fix that call site to use `qualifiesByOdds` first.

- [ ] **Step 2: Remove `isValueBet` from the file**

Open `server/src/utils/expectedValue.ts`. Delete lines 18-24 (the `isValueBet` export and its JSDoc). The file should now only contain `calculateEV`, `impliedProbability`, and `determineTip`.

Expected final file content:

```ts
/**
 * Calculate expected value for a bet.
 * EV = (probability * odds) - 1
 * Positive EV means profitable in the long run.
 */
export function calculateEV(probability: number, odds: number): number {
  return probability * odds - 1;
}

/**
 * Convert decimal odds to implied probability.
 * impliedProb = 1 / odds
 */
export function impliedProbability(odds: number): number {
  return 1 / odds;
}

/**
 * Determine the tip based on probabilities.
 */
export function determineTip(homeProb: number, drawProb: number, awayProb: number): string {
  if (homeProb >= drawProb && homeProb >= awayProb) return '1';
  if (drawProb >= homeProb && drawProb >= awayProb) return 'X';
  return '2';
}
```

- [ ] **Step 3: Compile**

```bash
cd server && npx tsc
```

Expected: no errors.

### Task 1.7: Wire qualifier into accumulator builder

**Files:**
- Modify: `server/src/routes/predictions.ts:27-71`

- [ ] **Step 1: Add import**

At the top of `server/src/routes/predictions.ts`, add:

```ts
import { qualifiesByOdds, type Tip } from '../utils/qualification';
```

- [ ] **Step 2: Add JS post-filter after the query**

Find the block around line 46 that ends with `const picks = result.rows.map((r: any) => {`. Insert a post-filter immediately before the map:

```ts
    const conformingRows = result.rows.filter((r: any) => qualifiesByOdds(
      r.tip as Tip,
      r.home_odds != null ? Number(r.home_odds) : null,
      r.draw_odds != null ? Number(r.draw_odds) : null,
      r.away_odds != null ? Number(r.away_odds) : null,
      Number(r.confidence),
    ));

    const picks = conformingRows.map((r: any) => {
```

(The original `const picks = result.rows.map(...)` becomes `const picks = conformingRows.map(...)`.)

- [ ] **Step 3: Add secondary sort to the SQL LATERAL join for determinism**

In the SELECT at lines 32-45, change:

```sql
       LEFT JOIN LATERAL (SELECT * FROM odds_history WHERE match_id = m.id ORDER BY scraped_at DESC LIMIT 1) oh ON true
```

to:

```sql
       LEFT JOIN LATERAL (SELECT * FROM odds_history WHERE match_id = m.id ORDER BY scraped_at DESC, id DESC LIMIT 1) oh ON true
```

(This ensures deterministic "latest odds" when two odds rows share a `scraped_at` timestamp.)

- [ ] **Step 4: Compile**

```bash
cd server && npx tsc
```

Expected: no errors.

### Task 1.8: Add server-side date validation helper

**Files:**
- Create: `server/src/utils/dateValidation.ts`

- [ ] **Step 1: Create the file**

Write to `server/src/utils/dateValidation.ts`:

```ts
import dayjs from 'dayjs';
import customParseFormat from 'dayjs/plugin/customParseFormat';

dayjs.extend(customParseFormat);

export const LAUNCH_DATE = '2026-03-16';
export const DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Returns true if the string is a valid YYYY-MM-DD date on or after the launch date.
 * Used at API boundaries to reject malformed or pre-launch date params.
 */
export function isValidDateString(str: unknown): str is string {
  if (typeof str !== 'string') return false;
  if (!DATE_REGEX.test(str)) return false;
  if (!dayjs(str, 'YYYY-MM-DD', true).isValid()) return false;
  return str >= LAUNCH_DATE;
}
```

- [ ] **Step 2: Compile**

```bash
cd server && npx tsc
```

Expected: no errors.

### Task 1.9: Apply server-side date validation to routes

**Files:**
- Modify: `server/src/routes/matches.ts:21-30`
- Modify: `server/src/routes/predictions.ts` (three endpoints: pick-of-day, accumulators, potd-history)

- [ ] **Step 1: Update `routes/matches.ts` root GET**

At the top, add:
```ts
import { isValidDateString } from '../utils/dateValidation';
```

In the `router.get('/', ...)` handler around lines 21-29, after the existing `if (date < LAUNCH_DATE)` check, replace:

```ts
    const date = (req.query.date as string) || dayjs().tz('Africa/Nairobi').format('YYYY-MM-DD');

    // Block dates before launch
    if (date < LAUNCH_DATE) {
      res.json({ date, matches: [] });
      return;
    }
```

with:

```ts
    const date = (req.query.date as string) || dayjs().tz('Africa/Nairobi').format('YYYY-MM-DD');

    if (!isValidDateString(date)) {
      res.status(400).json({ error: 'Invalid date', date });
      return;
    }
```

(The `LAUNCH_DATE` import at the top of the file can remain — it's still used if referenced elsewhere.)

- [ ] **Step 2: Update `routes/predictions.ts` endpoints**

Add the import at the top:

```ts
import { isValidDateString } from '../utils/dateValidation';
```

For each of the three handlers (`/pick-of-day`, `/accumulators`, `/potd-history`), find the `const date = (req.query.date as string) || ...` line and add a validation check immediately after. Example for `pick-of-day`:

Replace:

```ts
    const date = (req.query.date as string) || dayjs().tz('Africa/Nairobi').format('YYYY-MM-DD');
    if (date < LAUNCH_DATE) { res.json({ date, pick: null }); return; }
```

with:

```ts
    const date = (req.query.date as string) || dayjs().tz('Africa/Nairobi').format('YYYY-MM-DD');
    if (!isValidDateString(date)) {
      res.status(400).json({ error: 'Invalid date', date });
      return;
    }
```

Apply the same pattern to `/accumulators`. The `/potd-history` endpoint takes `days` not `date`, so skip it.

- [ ] **Step 3: Compile**

```bash
cd server && npx tsc
```

Expected: no errors.

### Task 1.10: Build, restart, and verify the code-path fix

- [ ] **Step 1: Rebuild the server**

```bash
cd server && npx tsc
```

- [ ] **Step 2: Restart the running server**

If using `docker compose`:
```bash
docker compose restart app
```

If running via `node dist/index.js` directly, stop and restart it.

- [ ] **Step 3: Verify today's POTD changed AND conforms to the rule**

```bash
curl -s 'http://localhost:3001/api/predictions/pick-of-day?date=2026-04-11' > /tmp/potd_after_phase1.json
cat /tmp/potd_after_phase1.json | grep -o '"home_team":"[^"]*"'
```

Expected: **NOT** `"home_team":"Cercle Brugge"`. It should be either a different team (one of the 9 conforming matches) or absent (null).

Then verify the returned POTD actually conforms to the rule (not just "different from before"):

```bash
cat /tmp/potd_after_phase1.json | python3 -c '
import sys, json
data = json.load(sys.stdin)
pick = data.get("pick")
if not pick:
    print("OK: no POTD (acceptable — no qualifying matches)")
    sys.exit(0)
conf = float(pick["confidence"])
tip = pick["tip"]
home = float(pick["home_odds"])
draw = float(pick["draw_odds"])
away = float(pick["away_odds"])
assert conf >= 0.70, f"FAIL: confidence {conf} < 0.70"
if tip == "1":
    assert 1.50 <= home <= 1.99, f"FAIL: home odds {home} not in [1.50,1.99]"
    assert away >= 5.00, f"FAIL: away odds {away} < 5.00"
elif tip == "2":
    assert 1.50 <= away <= 1.99, f"FAIL: away odds {away} not in [1.50,1.99]"
    assert home >= 5.00, f"FAIL: home odds {home} < 5.00"
elif tip == "X":
    assert 1.50 <= draw <= 1.99, f"FAIL: draw odds {draw} not in [1.50,1.99]"
    assert min(home, away) >= 5.00, f"FAIL: min(home,away) {min(home,away)} < 5.00"
print(f"OK: POTD satisfies rule (tip={tip}, conf={conf}, H={home}, D={draw}, A={away})")
'
```

Expected: `OK: ...` output. Any `AssertionError` means the POTD leak isn't fully fixed — stop and debug.

- [ ] **Step 4: Verify matches count unchanged**

```bash
curl -s 'http://localhost:3001/api/matches?date=2026-04-11' | grep -o '"id":[0-9]*' | wc -l
```

Expected: 9 (same as baseline — the code-path fix doesn't change the matches list for today, only the POTD selection and the `is_value_bet` flag).

- [ ] **Step 5: Verify accumulator endpoint still returns**

```bash
curl -s 'http://localhost:3001/api/predictions/accumulators?date=2026-04-11' | head -c 200
```

Expected: JSON starting with `{"date":"2026-04-11","accumulators":[`. Non-empty.

- [ ] **Step 6: Verify server-side date validation**

```bash
curl -s -w '%{http_code}\n' -o /dev/null 'http://localhost:3001/api/matches?date=notadate'
curl -s -w '%{http_code}\n' -o /dev/null 'http://localhost:3001/api/matches?date=2025-01-01'
curl -s -w '%{http_code}\n' -o /dev/null 'http://localhost:3001/api/matches?date=2026-04-11'
```

Expected: `400`, `400`, `200`.

### Task 1.11: Commit Phase 1

- [ ] **Step 1: Stage the changes**

```bash
git add server/src/utils/qualification.ts server/src/utils/dateValidation.ts server/src/utils/expectedValue.ts server/src/cron/fixtureIngestion.ts server/src/routes/matches.ts server/src/routes/predictions.ts server/src/services/predictionEngine.ts
```

- [ ] **Step 2: Review the diff**

```bash
git diff --cached --stat
```

Expected: 7 files changed. No other files in the staged set.

- [ ] **Step 3: Commit**

```bash
git commit -m "$(cat <<'EOF'
Enforce qualification rule in all server filter sites

Introduce shared qualifiesByOdds helper and rewire every filter
site (ingestion, matches route, storePrediction, selectPickOfDay,
accumulator endpoint) to use it. Delete isValueBet (which used a
strict > 1.50 lower bound inconsistent with the other filters).
Remove the POTD fallback to confidence >= 0.55. Add server-side
date validation at every route that accepts a date parameter.

After this change, today's POTD no longer shows Cercle Brugge
(opposing odds 3.60 < 5.00). Stale rows in the DB remain hidden
by the matches filter but will be cleaned up in Phase 2.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Phase 2 — Database cleanup

Delete matches from the DB whose latest odds + prediction do not satisfy `qualifiesByOdds`. Recompute POTDs for affected dates. This phase is destructive but idempotent — running it twice is safe.

### Task 2.1: Create the cleanup script

**Files:**
- Create: `server/src/scripts/cleanupNonConformingMatches.ts`

- [ ] **Step 1: Create the scripts directory**

```bash
mkdir -p server/src/scripts
```

- [ ] **Step 2: Write the script**

Write to `server/src/scripts/cleanupNonConformingMatches.ts`:

```ts
import { getClient, query } from '../config/database';
import { qualifiesByOdds, type Tip } from '../utils/qualification';
import * as PredictionModel from '../models/Prediction';
import { selectPickOfDay } from '../services/predictionEngine';
import logger from '../config/logger';

const DRY_RUN = process.argv.includes('--dry-run');

interface NonConforming {
  id: number;
  date: string;
  home: string;
  away: string;
  tip: string;
  homeOdds: number | null;
  drawOdds: number | null;
  awayOdds: number | null;
  confidence: number;
  reason: string;
}

function describeReason(row: NonConforming): string {
  if (row.confidence < 0.70) return `confidence ${row.confidence.toFixed(2)} < 0.70`;
  if (row.homeOdds == null || row.drawOdds == null || row.awayOdds == null) return 'missing odds';
  const tipOdds = row.tip === '1' ? row.homeOdds : row.tip === '2' ? row.awayOdds : row.drawOdds;
  if (tipOdds < 1.50 || tipOdds > 1.99) return `tipped odds ${tipOdds.toFixed(2)} outside [1.50, 1.99]`;
  const opposingOdds = row.tip === '1' ? row.awayOdds : row.tip === '2' ? row.homeOdds : Math.min(row.homeOdds, row.awayOdds);
  return `opposing odds ${opposingOdds.toFixed(2)} < 5.00`;
}

async function main() {
  console.log(`Cleanup starting (${DRY_RUN ? 'DRY-RUN' : 'REAL'} mode)`);

  const client = await getClient();
  try {
    await client.query('BEGIN');
    // Set a lock timeout so we fail fast if another connection holds matches
    // instead of hanging. Cron should be paused before running this script;
    // the timeout is a defensive backstop.
    await client.query("SET LOCAL lock_timeout = '10s'");
    // Block concurrent ingests/result-syncs during the scan+delete window.
    await client.query('LOCK TABLE matches IN SHARE ROW EXCLUSIVE MODE');

    const res = await client.query(`
      SELECT m.id,
             TO_CHAR(m.kickoff AT TIME ZONE 'Africa/Nairobi', 'YYYY-MM-DD') AS nairobi_date,
             ht.name AS home, at2.name AS away,
             p.tip, p.confidence,
             oh.home_odds, oh.draw_odds, oh.away_odds
      FROM matches m
      JOIN predictions p ON p.match_id = m.id
      JOIN teams ht ON m.home_team_id = ht.id
      JOIN teams at2 ON m.away_team_id = at2.id
      LEFT JOIN LATERAL (
        SELECT home_odds, draw_odds, away_odds
        FROM odds_history
        WHERE match_id = m.id
        ORDER BY scraped_at DESC, id DESC
        LIMIT 1
      ) oh ON true
    `);

    const nonConforming: NonConforming[] = [];
    for (const row of res.rows) {
      const tip = row.tip as Tip;
      const probability = Number(row.confidence);
      const homeOdds = row.home_odds != null ? Number(row.home_odds) : null;
      const drawOdds = row.draw_odds != null ? Number(row.draw_odds) : null;
      const awayOdds = row.away_odds != null ? Number(row.away_odds) : null;
      const ok = qualifiesByOdds(tip, homeOdds, drawOdds, awayOdds, probability);
      if (!ok) {
        const nc: NonConforming = {
          id: row.id,
          date: row.nairobi_date,
          home: row.home,
          away: row.away,
          tip: row.tip,
          homeOdds,
          drawOdds,
          awayOdds,
          confidence: probability,
          reason: '',
        };
        nc.reason = describeReason(nc);
        nonConforming.push(nc);
      }
    }

    console.log(`Found ${nonConforming.length} non-conforming matches`);
    for (const nc of nonConforming) {
      console.log(`  match_id=${nc.id} date=${nc.date} ${nc.home} vs ${nc.away} (tip=${nc.tip}): ${nc.reason}`);
    }
    const affectedDates = Array.from(new Set(nonConforming.map(n => n.date))).sort();
    console.log(`Affected dates (${affectedDates.length}): ${affectedDates.join(', ')}`);

    if (DRY_RUN) {
      console.log('DRY-RUN: rolling back, no changes committed.');
      await client.query('ROLLBACK');
      return;
    }

    if (nonConforming.length > 0) {
      const ids = nonConforming.map(n => n.id);
      // Deleting matches cascades to predictions and odds_history via ON DELETE CASCADE.
      const del = await client.query('DELETE FROM matches WHERE id = ANY($1)', [ids]);
      console.log(`Deleted ${del.rowCount} matches (cascade cleaned predictions + odds_history)`);
    }

    await client.query('COMMIT');
    console.log('Deletion transaction committed.');

    // Recompute POTD for affected dates. Each date is independent; failures are
    // logged but do not roll back earlier successes. The script is idempotent,
    // so re-running after a partial failure will continue where it stopped.
    for (const date of affectedDates) {
      try {
        await PredictionModel.clearPickOfDay(date);
        const result = await selectPickOfDay(date);
        // selectPickOfDay returns the winning candidate row from the predictions
        // SELECT, which has both `id` (prediction id) and `match_id`. Log match_id
        // since that's what the rest of the system references.
        const matchId = result ? (result as any).match_id : null;
        console.log(`  ${date}: ${matchId != null ? `new POTD match_id=${matchId}` : 'no POTD'}`);
      } catch (err: any) {
        console.error(`  ${date}: recomputation failed: ${err.message}`);
      }
    }

    console.log('Cleanup complete.');
  } catch (err) {
    console.error('Cleanup failed, rolling back:', err);
    try { await client.query('ROLLBACK'); } catch { /* ignore */ }
    throw err;
  } finally {
    client.release();
  }
}

main().catch(err => { console.error(err); process.exit(1); });
```

- [ ] **Step 3: Compile**

```bash
cd server && npx tsc
```

Expected: no errors. The script will be emitted to `server/dist/scripts/cleanupNonConformingMatches.js`.

- [ ] **Step 4: Verify the compiled file exists**

```bash
ls server/dist/scripts/cleanupNonConformingMatches.js
```

Expected: file listed.

### Task 2.2: Take a database backup

- [ ] **Step 1: Create backup directory**

```bash
mkdir -p backups
```

- [ ] **Step 2: Check how the DB is currently running**

```bash
docker compose ps
```

Decide based on output:
- If `app` and `db` containers are up → use `docker compose exec` path below.
- If running natively via `wsl -u root pg_ctlcluster` → use the WSL path below.

- [ ] **Step 3a: Backup via Docker (if applicable)**

```bash
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
docker compose exec -T db pg_dump -U football_app football_predictions > "backups/football_backup_${TIMESTAMP}.sql"
```

- [ ] **Step 3b: Backup via WSL native Postgres (if applicable)**

```bash
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
wsl -u root -e bash -c "PGPASSWORD=football_pass pg_dump -h 127.0.0.1 -U football_app football_predictions" > "backups/football_backup_${TIMESTAMP}.sql"
```

- [ ] **Step 4: Verify backup is non-empty**

```bash
ls -la backups/
wc -l backups/football_backup_*.sql
```

Expected: file is > 100 lines (contains schema + data).

### Task 2.3: Pause cron and run the first dry-run

- [ ] **Step 1: Stop the app container or server process**

```bash
docker compose stop app
```

(If running natively, Ctrl+C the `node dist/index.js` process.)

This halts all cron jobs so they cannot insert new non-conforming rows during the cleanup.

- [ ] **Step 2: Run first dry-run**

```bash
cd server && node dist/scripts/cleanupNonConformingMatches.js --dry-run 2>&1 | tee ../backups/cleanup_dryrun_1.log
```

Expected output pattern:
```
Cleanup starting (DRY-RUN mode)
Found N non-conforming matches
  match_id=279 date=2026-04-11 Cercle Brugge vs Raal La Louviere (tip=1): opposing odds 3.60 < 5.00
  ...
Affected dates (M): 2026-04-05, 2026-04-06, ...
DRY-RUN: rolling back, no changes committed.
```

Note `N` (total count) and `M` (affected dates count) for the next step.

### Task 2.4: Verify dry-run idempotency with a second dry-run

- [ ] **Step 1: Run the same dry-run again**

```bash
cd server && node dist/scripts/cleanupNonConformingMatches.js --dry-run 2>&1 | tee ../backups/cleanup_dryrun_2.log
```

- [ ] **Step 2: Compare the two dry-run logs**

```bash
diff backups/cleanup_dryrun_1.log backups/cleanup_dryrun_2.log
```

Expected: **no differences** (empty diff output). If the two logs differ, the dry-run is not actually non-destructive — STOP and investigate before proceeding.

### Task 2.5: Run the real cleanup

- [ ] **Step 1: Run the real cleanup**

```bash
cd server && node dist/scripts/cleanupNonConformingMatches.js 2>&1 | tee ../backups/cleanup_real.log
```

Expected output pattern:
```
Cleanup starting (REAL mode)
Found N non-conforming matches
  ...
Affected dates (M): ...
Deleted N matches (cascade cleaned predictions + odds_history)
Deletion transaction committed.
  2026-04-05: new POTD match_id=... | no POTD
  ...
Cleanup complete.
```

- [ ] **Step 2: Assert deleted count equals dry-run count**

```bash
DRYRUN_N=$(grep -oE 'Found [0-9]+ non-conforming' backups/cleanup_dryrun_1.log | grep -oE '[0-9]+')
REAL_N=$(grep -oE 'Deleted [0-9]+ matches' backups/cleanup_real.log | grep -oE '[0-9]+')
echo "dry-run predicted: $DRYRUN_N, real deleted: $REAL_N"
[ "$DRYRUN_N" = "$REAL_N" ] && echo "MATCH" || { echo "MISMATCH — STOP and investigate"; exit 1; }
```

Expected output: `dry-run predicted: N, real deleted: N` followed by `MATCH`. A mismatch indicates a race condition or a bug — stop and investigate before proceeding.

### Task 2.6: Verify idempotency with a third dry-run

- [ ] **Step 1: Run the dry-run a third time**

```bash
cd server && node dist/scripts/cleanupNonConformingMatches.js --dry-run 2>&1 | tee ../backups/cleanup_dryrun_3.log
```

Expected output:
```
Cleanup starting (DRY-RUN mode)
Found 0 non-conforming matches
Affected dates (0):
DRY-RUN: rolling back, no changes committed.
```

If the count is not zero, something is wrong — STOP and investigate.

### Task 2.7: Orphan check

- [ ] **Step 1: Start the DB-only container or verify native DB is running**

If using Docker, the `db` container should still be running (we only stopped `app`). Verify:
```bash
docker compose ps db
```

- [ ] **Step 2: Query for orphan rows**

Via Docker:
```bash
docker compose exec -T db psql -U football_app football_predictions -c "SELECT COUNT(*) FROM predictions WHERE match_id NOT IN (SELECT id FROM matches);"
docker compose exec -T db psql -U football_app football_predictions -c "SELECT COUNT(*) FROM odds_history WHERE match_id NOT IN (SELECT id FROM matches);"
```

Via WSL:
```bash
wsl -u root -e bash -c "PGPASSWORD=football_pass psql -h 127.0.0.1 -U football_app football_predictions -c \"SELECT COUNT(*) FROM predictions WHERE match_id NOT IN (SELECT id FROM matches);\""
wsl -u root -e bash -c "PGPASSWORD=football_pass psql -h 127.0.0.1 -U football_app football_predictions -c \"SELECT COUNT(*) FROM odds_history WHERE match_id NOT IN (SELECT id FROM matches);\""
```

Expected: both counts = 0.

### Task 2.8: Restart the app

- [ ] **Step 1: Restart**

```bash
docker compose start app
```

(Or restart the native `node dist/index.js` process.)

- [ ] **Step 2: Verify the server is reachable**

```bash
curl -s http://localhost:3001/api/health
```

Expected: `{"status":"ok",...}`.

### Task 2.9: Post-cleanup verification

- [ ] **Step 1: Check today's POTD**

```bash
curl -s 'http://localhost:3001/api/predictions/pick-of-day?date=2026-04-11' | head -c 500
```

Expected: either a valid POTD JSON (different team from Cercle Brugge) or `{"date":"2026-04-11","pick":null}`.

- [ ] **Step 2: If POTD exists, verify it conforms to the rule**

Extract tip, and odds:
```bash
curl -s 'http://localhost:3001/api/predictions/pick-of-day?date=2026-04-11' | grep -oE '"(tip|home_odds|draw_odds|away_odds)":"?[^",}]*'
```

Manually verify: tipped odds in [1.50, 1.99], opposing odds >= 5.00.

- [ ] **Step 3: Matches list is unchanged (today's 9 were already conforming)**

```bash
curl -s 'http://localhost:3001/api/matches?date=2026-04-11' | grep -o '"id":[0-9]*' | wc -l
```

Expected: 9 (matches baseline).

- [ ] **Step 4: Save a post-cleanup history snapshot**

```bash
curl -s 'http://localhost:3001/api/predictions/potd-history?days=90' > .baselines/potd-history-post-cleanup.json
```

- [ ] **Step 5: Diff summary counts**

```bash
cat .baselines/potd-history.json | grep -o '"total":[0-9]*'
cat .baselines/potd-history-post-cleanup.json | grep -o '"total":[0-9]*'
```

Expected: post-cleanup total <= baseline total. Document the difference (this is the count of days that no longer have a POTD).

### Task 2.10: Commit Phase 2

- [ ] **Step 1: Stage the cleanup script**

```bash
git add server/src/scripts/cleanupNonConformingMatches.ts
```

- [ ] **Step 2: Commit**

```bash
git commit -m "$(cat <<'EOF'
Add one-time DB cleanup script for non-conforming matches

Deletes matches whose latest odds + prediction fail qualifiesByOdds.
ON DELETE CASCADE on predictions.match_id and odds_history.match_id
handles dependent rows. Dry-run mode (--dry-run) reports counts and
rolls back. After deletion, POTDs for affected dates are recomputed
from the remaining matches; some days will have no POTD.

Cleanup was executed against the live DB. Backup saved to
backups/football_backup_*.sql. Logs in backups/cleanup_*.log.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Phase 3 — POTD card full H/D/A odds display

Replace the single tipped-side odds stat in the POTD card with a three-column H/D/A subgroup.

### Task 3.1: Update `PickOfDayCard.tsx`

**Files:**
- Modify: `client/src/components/PickOfDayCard.tsx`

- [ ] **Step 1: Replace the file**

Open `client/src/components/PickOfDayCard.tsx`. Replace the entire file contents with:

```tsx
import InfoTip from './InfoTip';

interface PickOfDayCardProps {
  data: any;
  loading: boolean;
}

function OddsCell({ label, value, isTipped }: { label: string; value: number | null | undefined; isTipped: boolean }) {
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
    ? 'rgba(245,158,11,0.18)'
    : isValueRange
    ? 'rgba(34,197,94,0.12)'
    : 'transparent';
  const color = isTipped
    ? 'var(--accent-gold)'
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

export default function PickOfDayCard({ data, loading }: PickOfDayCardProps) {
  if (loading) {
    return (
      <div className="card animate-pulse" style={{ borderColor: 'var(--accent-gold)', borderWidth: '2px' }}>
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
            Pick of the Day
          </h2>
          <p style={{ color: 'var(--text-secondary)' }}>
            No qualifying value bets found for this date.
          </p>
          <p className="text-sm mt-1" style={{ color: 'var(--text-secondary)' }}>
            Picks require 70%+ win probability, tipped odds 1.50-1.99, and opposing side &gt;= 5.00.
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
    <div className="card relative overflow-hidden" style={{ borderColor: 'var(--accent-gold)', borderWidth: '2px' }}>
      <div
        className="absolute top-0 left-0 right-0 h-1"
        style={{ background: 'linear-gradient(90deg, var(--accent-gold), var(--accent-green))' }}
      ></div>

      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <span className="text-xl">&#127942;</span>
          <h2 className="text-lg font-bold" style={{ color: 'var(--accent-gold)' }}>
            Pick of the Day<InfoTip text="The single best value bet ranked by a composite score of EV, Poisson model, league hit ratio, and line movement" />
          </h2>
        </div>
        <span className="badge badge-green">{tipLabel}</span>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="flex flex-col items-center md:items-start">
          <p className="text-sm mb-1" style={{ color: 'var(--text-secondary)' }}>
            {pick.tournament} &middot; {kickoff} EAT
          </p>
          <div className="flex items-center gap-3">
            <span className="text-lg font-bold">{pick.home_team}</span>
            <span style={{ color: 'var(--text-secondary)' }}>vs</span>
            <span className="text-lg font-bold">{pick.away_team}</span>
          </div>
          {pick.status === 'finished' && (
            <p className="text-xl font-bold mt-1" style={{ color: 'var(--accent-blue)' }}>
              {pick.home_score} - {pick.away_score}
            </p>
          )}
        </div>

        <div className="flex flex-col gap-3">
          <div className="grid grid-cols-2 gap-3">
            <div className="text-center">
              <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>Win Prob<InfoTip text="The AI's estimated probability of the tipped outcome winning" /></p>
              <p className="text-2xl font-bold" style={{ color: 'var(--accent-green)' }}>
                {confidence}%
              </p>
            </div>
            <div className="text-center">
              <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>Expected Value<InfoTip text="EV = (probability x odds) - 1. Positive EV means profitable long-term" /></p>
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
              Odds (H / D / A)<InfoTip text="Decimal odds for Home / Draw / Away. Gold = tipped side. Green highlight = value range 1.50-1.99" />
            </p>
            <div className="grid grid-cols-3 gap-2 mt-1">
              <OddsCell label="H" value={pick.home_odds} isTipped={pick.tip === '1'} />
              <OddsCell label="D" value={pick.draw_odds} isTipped={pick.tip === 'X'} />
              <OddsCell label="A" value={pick.away_odds} isTipped={pick.tip === '2'} />
            </div>
          </div>
        </div>

        <div className="flex flex-col justify-center">
          <p className="text-sm mb-1" style={{ color: 'var(--text-secondary)' }}>Confidence</p>
          <div className="w-full rounded-full h-3" style={{ background: 'var(--bg-primary)' }}>
            <div
              className="h-3 rounded-full transition-all"
              style={{
                width: `${confidence}%`,
                background: 'linear-gradient(90deg, var(--accent-gold), var(--accent-green))',
              }}
            ></div>
          </div>
          <div className="flex justify-between mt-1">
            <span className="text-xs" style={{ color: 'var(--text-secondary)' }}>0%</span>
            <span className="text-xs" style={{ color: 'var(--text-secondary)' }}>100%</span>
          </div>
        </div>
      </div>

      {pick.reasoning && (
        <div className="mt-3 pt-3" style={{ borderTop: '1px solid var(--border)' }}>
          <p className="text-xs" style={{ color: 'var(--text-secondary)' }}>
            <span className="font-semibold" style={{ color: 'var(--accent-blue)' }}>AI Analysis: </span>
            {pick.reasoning}
          </p>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Build the client**

```bash
cd client && npx vite build
```

Expected: build completes without errors, output in `client/dist/`.

### Task 3.2: Verify in browser

- [ ] **Step 1: Load the app**

Visit `http://localhost:3001/` in a browser (or the LAN IP if testing from another device).

- [ ] **Step 2: Confirm POTD card renders (visual + DOM inspection)**

If a POTD exists for today:
1. The card shows the H / D / A row with three values.
2. The tipped side has a gold background tint and gold text.
3. Any odds in [1.50, 1.99] have a green background tint.
4. Win Prob and Expected Value are still shown.

**DOM inspection** (catches silent regressions where the layout collapses vertically):

Open DevTools → Elements. Find the POTD card. Locate the new H/D/A subgroup. Verify:
- Three sibling `<div>` elements exist inside a `grid grid-cols-3` parent.
- Each has a label child (`H`, `D`, `A`) and a value child (`1.90`, `3.45`, etc.).
- The tipped-side div has `background: rgba(245, 158, 11, 0.18)` applied via inline style.
- The three cells are laid out horizontally (not stacked) on desktop viewport.

If no POTD exists for today:
- The empty state card shows the new rule text "Picks require 70%+ win probability, tipped odds 1.50-1.99, and opposing side >= 5.00."

- [ ] **Step 3: Navigate to an older date via the date picker**

Pick a date where a POTD exists (e.g. 2026-04-08). Verify the card updates and H/D/A are rendered correctly.

- [ ] **Step 4: Mobile layout check**

Open DevTools, toggle device toolbar, select iPhone 14 viewport. Verify the POTD card stacks vertically and the H/D/A cells remain readable.

### Task 3.3: Commit Phase 3

- [ ] **Step 1: Stage and commit**

```bash
git add client/src/components/PickOfDayCard.tsx
git commit -m "$(cat <<'EOF'
Show full H/D/A odds on POTD card

Replace the single tipped-side odds stat with a three-cell H/D/A
subgroup. Tipped side gets gold emphasis; odds in the 1.50-1.99
range get the green value-range highlight. Null odds render as -
without suppressing the rest of the block.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Phase 4 — Collapsible monthly POTD history

Group POTD history entries by calendar month, render each month as a native `<details>` collapsible section with a summary row showing aggregate stats.

### Task 4.1: Update `PotdHistory.tsx`

**Files:**
- Modify: `client/src/components/PotdHistory.tsx`

- [ ] **Step 1: Replace the file**

Open `client/src/components/PotdHistory.tsx`. Replace the entire file contents with:

```tsx
import { useMemo } from 'react';
import dayjs from 'dayjs';
import InfoTip from './InfoTip';

interface PotdEntry {
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
  reasoning: string;
  profit: number;
}

interface PotdHistoryProps {
  data: {
    history: PotdEntry[];
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

interface MonthGroup {
  month: string;        // YYYY-MM
  label: string;        // "April 2026"
  entries: PotdEntry[];
  total: number;
  settled: number;
  wins: number;
  losses: number;
  hitRatio: number;
  totalProfit: number;
}

const tipLabel = (t: string) => (t === '1' ? 'H' : t === '2' ? 'A' : 'D');

function groupByMonth(history: PotdEntry[]): MonthGroup[] {
  const map = new Map<string, PotdEntry[]>();
  for (const h of history) {
    const key = dayjs(h.date).format('YYYY-MM');
    if (!map.has(key)) map.set(key, []);
    map.get(key)!.push(h);
  }
  const groups: MonthGroup[] = [];
  for (const [month, entries] of map.entries()) {
    const settledEntries = entries.filter(e => e.outcome === 'won' || e.outcome === 'lost');
    const wins = settledEntries.filter(e => e.outcome === 'won').length;
    const losses = settledEntries.length - wins;
    const hitRatio = settledEntries.length > 0 ? wins / settledEntries.length : 0;
    const totalProfit = settledEntries.reduce((sum, e) => sum + e.profit, 0);
    groups.push({
      month,
      label: dayjs(month + '-01').format('MMMM YYYY'),
      entries,
      total: entries.length,
      settled: settledEntries.length,
      wins,
      losses,
      hitRatio,
      totalProfit: +totalProfit.toFixed(2),
    });
  }
  groups.sort((a, b) => b.month.localeCompare(a.month));
  return groups;
}

export default function PotdHistory({ data }: PotdHistoryProps) {
  if (!data || data.history.length === 0) return null;

  const { history, summary } = data;
  const monthGroups = useMemo(() => groupByMonth(history), [history]);

  return (
    <div className="card">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-bold" style={{ color: 'var(--text-primary)' }}>
          &#127942; Pick of the Day History
          <InfoTip text="Track record of every day's Pick of the Day selection and its result. Grouped by month — click a month to expand." />
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
            <span style={{ color: summary.totalProfit >= 0 ? 'var(--accent-green)' : 'var(--accent-red)', fontWeight: 700 }}>
              {summary.totalProfit >= 0 ? '+' : ''}{summary.totalProfit}u
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
                    <span style={{ color: g.totalProfit >= 0 ? 'var(--accent-green)' : 'var(--accent-red)', fontWeight: 700 }}>
                      {g.totalProfit >= 0 ? '+' : ''}{g.totalProfit}u
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
                    <th className="text-center py-2 px-2 font-medium">Prob</th>
                    <th className="text-center py-2 px-2 font-medium">Odds</th>
                    <th className="text-center py-2 px-2 font-medium">EV</th>
                    <th className="text-center py-2 px-2 font-medium">Score</th>
                    <th className="text-center py-2 px-2 font-medium">Result</th>
                    <th className="text-center py-2 px-2 font-medium">P&L</th>
                  </tr>
                </thead>
                <tbody>
                  {g.entries.map((h, i) => {
                    const outcomeColor = h.outcome === 'won' ? 'var(--accent-green)' : h.outcome === 'lost' ? 'var(--accent-red)' : 'var(--text-secondary)';
                    const dateStr = new Date(h.date + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
                    const dayStr = new Date(h.date + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'short' });
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
                        <td className="py-2.5 px-2 text-center font-semibold" style={{ color: 'var(--accent-green)' }}>
                          {(h.confidence * 100).toFixed(0)}%
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
                          {h.score || '-'}
                        </td>
                        <td className="py-2.5 px-2 text-center">
                          <span
                            className="px-2 py-0.5 rounded-full text-xs font-bold"
                            style={{
                              background: h.outcome === 'won' ? 'rgba(34,197,94,0.15)' : h.outcome === 'lost' ? 'rgba(239,68,68,0.15)' : 'rgba(148,163,184,0.15)',
                              color: outcomeColor,
                            }}
                          >
                            {h.outcome === 'won' ? 'WON' : h.outcome === 'lost' ? 'LOST' : 'PENDING'}
                          </span>
                        </td>
                        <td className="py-2.5 px-2 text-center font-bold text-sm" style={{ color: outcomeColor }}>
                          {h.outcome === 'pending' ? '-' : `${h.profit > 0 ? '+' : ''}${h.profit.toFixed(2)}u`}
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

- [ ] **Step 2: Build**

```bash
cd client && npx vite build
```

Expected: build completes without errors.

### Task 4.2: Verify in browser

- [ ] **Step 1: Hard refresh the app**

`Ctrl+Shift+R` in the browser.

- [ ] **Step 2: Scroll to the POTD History card**

Observe:
- Global summary bar at top (unchanged).
- Monthly groups below, each in a bordered box.
- Every month is CLOSED by default.

- [ ] **Step 3: Click the first month summary**

Expands to show the table rows for that month. The table columns match the previous flat layout.

- [ ] **Step 4: Click a second month**

Both are simultaneously open.

- [ ] **Step 5: Verify month summary stats**

Expand a month, manually count wins/losses in the rows, and compare to the summary line.

- [ ] **Step 6: Verify state persists across refetch**

Expand a month. Open React Query DevTools (if available) or wait 5 minutes for the automatic refetch. The expanded month should remain expanded. The `key={g.month}` ensures React reuses the same DOM node.

Quick manual test: expand a month, then in the browser console run:
```js
// Trigger a refetch manually
document.dispatchEvent(new Event('visibilitychange'));
```

Wait 1-2 seconds, confirm the month is still expanded.

- [ ] **Step 7: Refresh the page**

All months should be closed again (no persistence).

- [ ] **Step 8: Verify month boundary correctness**

If the history data includes a pick near a month boundary (e.g., 2026-03-31 or 2026-04-01), open DevTools → Network, find the `/api/predictions/potd-history?days=30` request, and inspect the response. Each entry has a `date` field in `YYYY-MM-DD` format — verify:

- A pick with `date: "2026-03-31"` appears in the "March 2026" group, not April.
- A pick with `date: "2026-04-01"` appears in the "April 2026" group, not March.

If a date appears in the wrong group, the timezone assumption in `groupByMonth` is broken — investigate whether the API is returning UTC-normalized dates instead of Africa/Nairobi-normalized dates.

### Task 4.3: Commit Phase 4

- [ ] **Step 1: Commit**

```bash
git add client/src/components/PotdHistory.tsx
git commit -m "$(cat <<'EOF'
Group POTD history by month with collapsible sections

Replace flat 30-row table with native <details> sections, one per
calendar month in Africa/Nairobi. Each month summary row shows
pick count, W-L, hit ratio, and total profit. All months closed
by default; no persistence. key={month} preserves open state
across React Query refetches.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Phase 5 — Collapsible glossary

Wrap the glossary card in a `<details>` element; collapsed by default.

### Task 5.1: Update `Glossary.tsx`

**Files:**
- Modify: `client/src/components/Glossary.tsx`

- [ ] **Step 1: Replace the file**

Open `client/src/components/Glossary.tsx`. Replace the entire contents with:

```tsx
export default function Glossary() {
  const terms = [
    { term: 'Tip', def: 'Predicted outcome: 1 = Home Win, X = Draw, 2 = Away Win.' },
    { term: 'Prob', def: 'The AI\'s estimated probability (%) of the tipped outcome winning.' },
    { term: 'Odds (H/D/A)', def: 'Decimal betting odds for Home / Draw / Away from bookmakers. Lower odds = more likely outcome. Green highlight = value range (1.50-1.99).' },
    { term: 'EV (Expected Value)', def: 'EV = (probability x odds) - 1. Positive EV means the bet is profitable long-term. Higher is better.' },
    { term: 'Value Bet', def: 'A match where probability is 70%+ AND the tipped odds are between 1.50-1.99 AND the opposing side is priced at 5.00 or higher (heavy underdog).' },
    { term: 'POTD (Pick of the Day)', def: 'The single best value bet each day, selected by a composite score combining EV, league reliability, team consistency, and Poisson model agreement.' },
    { term: 'W / L / P', def: 'Wins / Losses / Pending. W = tip was correct, L = tip was wrong, P = match not yet finished.' },
    { term: 'Units (u)', def: 'Standard bet sizing. 1 unit = your base stake (e.g. $10). Profit/loss shown in units for consistency. A win at 1.80 odds = +0.80u profit. A loss = -1.00u.' },
    { term: 'Streak', def: 'Consecutive wins (W) or losses (L) across recent settled value bets. e.g. W5 = five wins in a row.' },
    { term: 'Hit Ratio', def: 'Percentage of correct predictions out of total settled picks. e.g. 7 wins out of 10 = 70% hit ratio.' },
    { term: 'ROI (Return on Investment)', def: 'Total profit divided by total amount staked, as a percentage. Positive ROI = profitable system.' },
    { term: 'Brier Score', def: 'Measures prediction accuracy on a 0-1 scale. 0 = perfect predictions, lower is better. Penalizes overconfident wrong predictions.' },
    { term: 'Log Loss', def: 'Cross-entropy metric that penalizes confident wrong predictions more heavily than uncertain ones. Lower is better.' },
    { term: 'Confidence Tiers', def: 'Matches grouped by win probability: HIGH (90%+, gold), STRONG (80-89%, green), VALUE (70-79%, blue).' },
    { term: 'Accumulator (Acca)', def: 'A multi-bet combining 2-4 picks. ALL legs must win for the acca to pay out. Combined odds = individual odds multiplied together.' },
    { term: '2-Fold / 3-Fold / 4-Fold', def: 'The number of legs in an accumulator. A 3-fold combines 3 picks. Higher folds = bigger payout but lower chance of winning.' },
    { term: 'Profit/Loss Banner', def: '"Today: 3W - 1L - 2P" means 3 wins, 1 loss, 2 matches still pending. "+1.40 units" is the net profit for the day.' },
    { term: 'Result Column', def: 'Shows the final score (e.g. 2-1) with a green checkmark (\u2713) if the tip was correct, or red cross (\u2717) if wrong.' },
  ];

  return (
    <details className="card" style={{ marginTop: 16 }}>
      <summary
        className="cursor-pointer flex items-center gap-2"
        style={{ listStyle: 'none' }}
      >
        <h2 className="text-lg font-bold inline-flex items-center gap-2" style={{ color: 'var(--text-primary)' }}>
          <span className="inline-block transition-transform" style={{ transform: 'rotate(0deg)' }}>&#9656;</span>
          &#128218; Glossary
          <span className="text-xs font-normal" style={{ color: 'var(--text-secondary)' }}>(click to expand)</span>
        </h2>
      </summary>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-3 mt-4">
        {terms.map((t) => (
          <div key={t.term} style={{ borderBottom: '1px solid var(--border)', paddingBottom: 8 }}>
            <span className="text-sm font-semibold" style={{ color: 'var(--accent-blue)' }}>
              {t.term}
            </span>
            <p className="text-xs mt-0.5" style={{ color: 'var(--text-secondary)', lineHeight: 1.5 }}>
              {t.def}
            </p>
          </div>
        ))}
      </div>
      <style>{`
        details[open] summary h2 span:first-child {
          transform: rotate(90deg);
        }
        summary::-webkit-details-marker {
          display: none;
        }
      `}</style>
    </details>
  );
}
```

Note the updated "Value Bet" definition now includes the opposing-side rule.

- [ ] **Step 2: Build**

```bash
cd client && npx vite build
```

Expected: build completes.

### Task 5.2: Verify in browser

- [ ] **Step 1: Hard refresh**

`Ctrl+Shift+R`.

- [ ] **Step 2: Scroll to the bottom**

Glossary card visible. Heading: "▶ 📚 Glossary (click to expand)". Terms are NOT visible.

- [ ] **Step 3: Click the heading**

Terms expand into the two-column grid. Chevron rotates to ▼.

- [ ] **Step 4: Click again**

Collapses.

- [ ] **Step 5: Refresh**

Closed again (no persistence).

### Task 5.3: Commit Phase 5

```bash
git add client/src/components/Glossary.tsx
git commit -m "$(cat <<'EOF'
Make glossary collapsible, closed by default

Wrap the glossary grid in a <details> element with a chevron-
decorated summary. Updates the 'Value Bet' definition to include
the opposing-side >= 5.00 rule that's now enforced server-side.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Phase 6 — Date-in-URL routing

Add `react-router-dom`, move the `App.tsx` body into a `PredictionsPage` component, introduce a `NotFound` page, refactor `DatePicker` to distinguish arrow-click vs explicit navigation. This is the largest structural change; saved for last to avoid conflicts with Phases 3–5.

### Task 6.1: Install react-router-dom

**Files:**
- Modify: `client/package.json`
- Modify: `client/package-lock.json`

- [ ] **Step 1: Install**

```bash
cd client && npm install react-router-dom@^6
```

- [ ] **Step 2: Verify**

```bash
grep react-router-dom client/package.json
```

Expected: `"react-router-dom": "^6.x.x"` under dependencies.

### Task 6.2: Create `client/src/lib/routing.ts`

**Files:**
- Create: `client/src/lib/routing.ts`

- [ ] **Step 1: Create the directory**

```bash
mkdir -p client/src/lib
```

- [ ] **Step 2: Write the file**

Write to `client/src/lib/routing.ts`:

```ts
import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc';
import timezone from 'dayjs/plugin/timezone';
import customParseFormat from 'dayjs/plugin/customParseFormat';

dayjs.extend(utc);
dayjs.extend(timezone);
dayjs.extend(customParseFormat);

export const LAUNCH_DATE = '2026-03-16';
export const SERVER_TZ = 'Africa/Nairobi';
const DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Returns the current date in the server's timezone, formatted as YYYY-MM-DD.
 * This must match how the server computes "today" so the client never
 * redirects to a date that has no data.
 */
export function todayString(): string {
  return dayjs().tz(SERVER_TZ).format('YYYY-MM-DD');
}

export function todayPath(): string {
  return `/${todayString()}`;
}

export type DateValidationResult =
  | { valid: true; date: string }
  | { valid: false; reason: 'invalid-format' | 'pre-launch' };

/**
 * Strict validator for the `:date` URL param. Checks format, calendar validity,
 * and that the date is on or after the launch date. Returns a structured
 * failure reason so NotFound can customize its message.
 */
export function isValidDateParam(str: string | undefined): DateValidationResult {
  if (!str || !DATE_REGEX.test(str)) {
    return { valid: false, reason: 'invalid-format' };
  }
  if (!dayjs(str, 'YYYY-MM-DD', true).isValid()) {
    return { valid: false, reason: 'invalid-format' };
  }
  if (str < LAUNCH_DATE) {
    return { valid: false, reason: 'pre-launch' };
  }
  return { valid: true, date: str };
}
```

- [ ] **Step 3: Build (no errors expected even though nothing uses it yet)**

```bash
cd client && npx vite build
```

Expected: build completes.

### Task 6.3: Create `client/src/pages/NotFound.tsx`

**Files:**
- Create: `client/src/pages/NotFound.tsx`

- [ ] **Step 1: Create the directory**

```bash
mkdir -p client/src/pages
```

- [ ] **Step 2: Write the file**

Write to `client/src/pages/NotFound.tsx`:

```tsx
import { useNavigate, useParams } from 'react-router-dom';
import { LAUNCH_DATE, todayPath } from '../lib/routing';

interface NotFoundProps {
  reason?: 'invalid-format' | 'pre-launch';
}

export default function NotFound({ reason }: NotFoundProps = {}) {
  const navigate = useNavigate();
  const params = useParams();
  const invalidPath = params.date;
  const effectiveReason = reason ?? 'invalid-format';

  return (
    <div className="min-h-screen flex items-center justify-center p-4" style={{ background: 'var(--bg-primary)' }}>
      <div className="card max-w-md text-center">
        <h1 className="text-2xl font-bold mb-2" style={{ color: 'var(--text-primary)' }}>
          This date isn&apos;t available
        </h1>
        {effectiveReason === 'pre-launch' ? (
          <p className="mb-4" style={{ color: 'var(--text-secondary)' }}>
            The app tracks predictions starting <strong>{LAUNCH_DATE}</strong>. Please pick a date on or after launch.
          </p>
        ) : (
          <p className="mb-4" style={{ color: 'var(--text-secondary)' }}>
            The URL <code style={{ color: 'var(--accent-red)' }}>{invalidPath ?? '(missing)'}</code> is not a valid date. Use <code>YYYY-MM-DD</code>.
          </p>
        )}
        <button
          onClick={() => navigate(todayPath())}
          className="px-4 py-2 rounded-lg text-sm font-medium"
          style={{ background: 'var(--accent-blue)', color: 'white' }}
        >
          Back to today
        </button>
      </div>
    </div>
  );
}
```

Note: the offending path is rendered via React's default text interpolation inside a `<code>` tag — no `dangerouslySetInnerHTML`.

### Task 6.4: Create `client/src/pages/PredictionsPage.tsx`

**Files:**
- Create: `client/src/pages/PredictionsPage.tsx`

- [ ] **Step 1: Write the file**

This file moves the entire current `App.tsx` body into a new page component that reads the date from `useParams()` and validates it. Write to `client/src/pages/PredictionsPage.tsx`:

```tsx
import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import dayjs from 'dayjs';
import DatePicker from '../components/DatePicker';
import PickOfDayCard from '../components/PickOfDayCard';
import MatchTable from '../components/MatchTable';
import DailyPLBanner from '../components/DailyPLBanner';
import AccumulatorCard from '../components/AccumulatorCard';
import PotdHistory from '../components/PotdHistory';
import Glossary from '../components/Glossary';
import { useToast } from '../components/ToastContainer';
import { useMatches, usePickOfDay, useDailyPL, useAccumulators, useSettled, usePotdHistory } from '../hooks/useMatches';
import { isValidDateParam } from '../lib/routing';
import NotFound from './NotFound';

export default function PredictionsPage() {
  const navigate = useNavigate();
  const { date: dateParam } = useParams();
  const validation = useMemo(() => isValidDateParam(dateParam), [dateParam]);

  // All hooks below MUST run unconditionally to preserve hook order across
  // valid/invalid renders. When validation fails, we pass an empty string so
  // React Query is disabled via `!!date` checks.
  const date = validation.valid ? validation.date : '';
  const { data: matchData, isLoading: matchesLoading, isFetching } = useMatches(date);
  const { data: pickData, isLoading: pickLoading } = usePickOfDay(
    matchData?.matches?.length !== undefined ? date : ''
  );
  const { data: dailyPL } = useDailyPL(date);
  const { data: accData } = useAccumulators(matchData?.matches?.length ? date : '');
  const { data: settledData } = useSettled();
  const { data: potdHistoryData } = usePotdHistory();
  const { addToast } = useToast();

  const settledIds = useMemo(() => {
    const ids = new Set<number>();
    settledData?.settled?.forEach((s: any) => ids.add(s.id));
    return ids;
  }, [settledData]);

  // Removed the "Fetching predictions for..." in-progress toast — it fires
  // on every date change, including rapid arrow-click navigation, which
  // produced visual spam. Keep only the success toast, which fires once per
  // date when data lands with value bets present.
  const [prevDate, setPrevDate] = useState('');
  useEffect(() => {
    if (date && date !== prevDate) {
      setPrevDate(date);
    }
  }, [date, prevDate]);

  useEffect(() => {
    if (date && matchData?.matches?.length && !isFetching && date === prevDate) {
      const valueBets = matchData.matches.filter((m: any) => m.is_value_bet).length;
      if (valueBets > 0) {
        addToast(`${matchData.matches.length} matches loaded, ${valueBets} value bets found`, 'success');
      }
    }
  }, [matchData?.matches?.length, isFetching]);

  if (!validation.valid) {
    return <NotFound reason={validation.reason} />;
  }

  const onArrowChange = (d: string) => navigate(`/${d}`, { replace: true });
  const onPickerChange = (d: string) => navigate(`/${d}`);

  return (
    <div className="min-h-screen" style={{ background: 'var(--bg-primary)' }}>
      <header className="border-b" style={{ borderColor: 'var(--border)', background: 'var(--bg-secondary)' }}>
        <div className="max-w-7xl mx-auto px-4 py-4 flex items-center justify-between flex-wrap gap-3">
          <div className="flex items-center gap-3">
            <span className="text-2xl">&#9917;</span>
            <div>
              <h1 className="text-xl font-bold" style={{ color: 'var(--text-primary)' }}>
                Football Predictions
              </h1>
              <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>
                Data-Driven Value Bet Finder
              </p>
            </div>
          </div>
          <DatePicker date={date} onArrowChange={onArrowChange} onPickerChange={onPickerChange} />
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 py-6 space-y-4">
        <PickOfDayCard data={pickData} loading={pickLoading} />
        <MatchTable
          matches={matchData?.matches || []}
          loading={matchesLoading}
          date={date}
          isFetching={isFetching}
          settledIds={settledIds}
        />
        <DailyPLBanner data={dailyPL} />
        <AccumulatorCard data={accData} />
        <PotdHistory data={potdHistoryData} />
        <Glossary />
      </main>
    </div>
  );
}
```

### Task 6.5: Update `client/src/App.tsx` to be a thin Routes shell

**Files:**
- Modify: `client/src/App.tsx`

- [ ] **Step 1: Replace the file**

Open `client/src/App.tsx`. Replace the entire contents with:

```tsx
import { useMemo } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import PredictionsPage from './pages/PredictionsPage';
import NotFound from './pages/NotFound';
import { todayPath } from './lib/routing';

function RedirectToToday() {
  const path = useMemo(() => todayPath(), []);
  return <Navigate to={path} replace />;
}

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<RedirectToToday />} />
      <Route path="/:date" element={<PredictionsPage />} />
      <Route path="*" element={<NotFound />} />
    </Routes>
  );
}
```

### Task 6.6: Update `client/src/main.tsx` with `<BrowserRouter>`

**Files:**
- Modify: `client/src/main.tsx`

- [ ] **Step 1: Replace the file**

Open `client/src/main.tsx`. Replace the entire contents with:

```tsx
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import './lib/routing'; // side-effect: extends dayjs with utc/timezone/customParseFormat
import App from './App';
import { ToastProvider } from './components/ToastContainer';
import './styles/globals.css';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30000,
      retry: 2,
      // Don't fire an extra fetch every time the user tabs back to the app.
      // Our refetchInterval (on hooks that need it) is enough.
      refetchOnWindowFocus: false,
    },
  },
});

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <QueryClientProvider client={queryClient}>
        <ToastProvider>
          <App />
        </ToastProvider>
      </QueryClientProvider>
    </BrowserRouter>
  </StrictMode>
);
```

### Task 6.7: Update `DatePicker` to split callbacks

**Files:**
- Modify: `client/src/components/DatePicker.tsx`

- [ ] **Step 1: Replace the file**

Open `client/src/components/DatePicker.tsx`. Replace the entire contents with:

```tsx
import dayjs from 'dayjs';
import { LAUNCH_DATE, todayString } from '../lib/routing';

interface DatePickerProps {
  date: string;
  onArrowChange: (date: string) => void;   // prev/next arrow — replace history
  onPickerChange: (date: string) => void;  // native picker + Today button — push history
}

export default function DatePicker({ date, onArrowChange, onPickerChange }: DatePickerProps) {
  const prevDate = dayjs(date).subtract(1, 'day').format('YYYY-MM-DD');
  const prev = () => { if (prevDate >= LAUNCH_DATE) onArrowChange(prevDate); };
  const next = () => onArrowChange(dayjs(date).add(1, 'day').format('YYYY-MM-DD'));
  const today = () => onPickerChange(todayString());

  const isToday = date === todayString();
  const isAtLaunch = date <= LAUNCH_DATE;
  const displayDate = dayjs(date).format('ddd, MMM D, YYYY');

  return (
    <div className="flex items-center gap-2">
      <button
        onClick={prev}
        disabled={isAtLaunch}
        title={isAtLaunch ? 'Launch date — cannot go further back' : 'Previous day (does not add browser history)'}
        className="px-3 py-1.5 rounded-lg text-sm font-medium transition-colors"
        style={{ background: 'var(--bg-primary)', color: isAtLaunch ? 'var(--text-secondary)' : 'var(--text-primary)', border: '1px solid var(--border)', opacity: isAtLaunch ? 0.4 : 1, cursor: isAtLaunch ? 'not-allowed' : 'pointer' }}
      >
        &#8592;
      </button>

      <div className="flex items-center gap-2">
        <span className="text-sm font-medium px-3" style={{ color: 'var(--text-primary)' }}>
          {displayDate}
        </span>
        <input
          type="date"
          value={date}
          min={LAUNCH_DATE}
          onChange={(e) => { if (e.target.value >= LAUNCH_DATE) onPickerChange(e.target.value); }}
          className="px-2 py-1.5 rounded-lg text-sm"
          style={{ background: 'var(--bg-primary)', color: 'var(--text-primary)', border: '1px solid var(--border)' }}
        />
      </div>

      <button
        onClick={next}
        title="Next day (does not add browser history)"
        className="px-3 py-1.5 rounded-lg text-sm font-medium transition-colors"
        style={{ background: 'var(--bg-primary)', color: 'var(--text-primary)', border: '1px solid var(--border)' }}
      >
        &#8594;
      </button>

      {!isToday && (
        <button
          onClick={today}
          className="px-3 py-1.5 rounded-lg text-sm font-medium"
          style={{ background: 'var(--accent-blue)', color: 'white' }}
        >
          Today
        </button>
      )}
    </div>
  );
}
```

### Task 6.8: Update React Query hooks with `staleTime` / `keepPreviousData`

**Files:**
- Modify: `client/src/hooks/useMatches.ts`

- [ ] **Step 1: Replace the file**

Open `client/src/hooks/useMatches.ts`. Replace the entire contents with:

```ts
import { useQuery, keepPreviousData } from '@tanstack/react-query';
import { fetchMatches, fetchPickOfDay, fetchPerformance, fetchDailyPL, fetchAccumulators, fetchSettled, fetchPotdHistory } from '../api/client';
import { todayString } from '../lib/routing';

export function useMatches(date: string) {
  return useQuery({
    queryKey: ['matches', date],
    queryFn: () => fetchMatches(date),
    enabled: !!date,
    refetchInterval: 90000,
    staleTime: 600000,
    placeholderData: keepPreviousData,
  });
}

export function usePickOfDay(date: string) {
  return useQuery({
    queryKey: ['pick-of-day', date],
    queryFn: () => fetchPickOfDay(date),
    enabled: !!date,
    refetchInterval: 90000,
    staleTime: 600000,
    placeholderData: keepPreviousData,
  });
}

export function usePerformance(days: number = 30) {
  return useQuery({
    queryKey: ['performance', days],
    queryFn: () => fetchPerformance(days),
    refetchInterval: 300000,
  });
}

export function useDailyPL(date: string) {
  const isToday = !!date && date === todayString();
  return useQuery({
    queryKey: ['daily-pl', date],
    queryFn: () => fetchDailyPL(date),
    enabled: !!date,
    refetchInterval: isToday ? 60000 : false,
    staleTime: 600000,
    placeholderData: keepPreviousData,
  });
}

export function useAccumulators(date: string) {
  return useQuery({
    queryKey: ['accumulators', date],
    queryFn: () => fetchAccumulators(date),
    enabled: !!date,
    refetchInterval: 120000,
    staleTime: 600000,
    placeholderData: keepPreviousData,
  });
}

export function useSettled() {
  return useQuery({
    queryKey: ['settled'],
    queryFn: () => fetchSettled(new Date(Date.now() - 300000).toISOString()),
    refetchInterval: 30000,
  });
}

export function usePotdHistory() {
  return useQuery({
    queryKey: ['potd-history'],
    queryFn: () => fetchPotdHistory(30),
    refetchInterval: 300000,
  });
}
```

### Task 6.9: Build and verify the client

- [ ] **Step 1: Build**

```bash
cd client && npx vite build
```

Expected: TypeScript compiles, Vite bundles, no errors. Output in `client/dist/`.

- [ ] **Step 2: Restart the server**

```bash
docker compose restart app
```

(Or restart the native process.)

- [ ] **Step 3: Verify health**

```bash
curl -s http://localhost:3001/api/health
```

Expected: `{"status":"ok",...}`.

### Task 6.10: Manual browser test plan for Phase 6

- [ ] **Step 1: Visit root**

Open `http://localhost:3001/` in a browser. Expected: URL rewrites to `/2026-04-11` (today in Africa/Nairobi). Predictions load.

- [ ] **Step 2: Visit a past date directly**

Navigate to `http://localhost:3001/2026-04-05`. Expected: the page renders with Apr 5 predictions. URL stays as `/2026-04-05`.

- [ ] **Step 3: Refresh on a past date**

Hit `F5` on `/2026-04-05`. Expected: same predictions, URL unchanged. **This is the original bug fix.**

- [ ] **Step 4: Arrow navigation**

From `/2026-04-11`, click the left arrow. URL becomes `/2026-04-10`. Open DevTools → Application → history (or just check the URL bar).

- [ ] **Step 5: Native picker navigation**

From `/2026-04-11`, use the native `<input type="date">` to pick `2026-04-05`. URL becomes `/2026-04-05`. Click browser Back → returns to `/2026-04-11` (push entry).

- [ ] **Step 6: Today button**

From `/2026-04-05`, click "Today" button. URL becomes `/2026-04-11`. Click Back → returns to `/2026-04-05`.

- [ ] **Step 7: Invalid paths**

Visit each and confirm:
- `/hello` → NotFound with "URL hello is not a valid date" message.
- `/2025-01-01` → NotFound with "pre-launch" message showing `2026-03-16`.
- `/2026-02-30` → NotFound (invalid calendar).
- `/2026-02-29` → NotFound (2026 is not a leap year).
- `/2028-02-29` → loads (leap year).
- `/2030-01-01` → loads (future allowed).
- `/foo/bar/baz` → NotFound via `*` route.

- [ ] **Step 8: NotFound "Back to today"**

From any NotFound page, click "Back to today". URL becomes `/2026-04-11`.

- [ ] **Step 9: Arrow button tooltips**

Hover over the left arrow at launch date. Tooltip shows "Launch date — cannot go further back". Hover over left/right arrows at non-boundary dates. Tooltip shows "Previous/Next day (does not add browser history)".

- [ ] **Step 10: API validation**

```bash
curl -s -w '%{http_code}\n' -o /dev/null 'http://localhost:3001/api/matches?date=notadate'
curl -s -w '%{http_code}\n' -o /dev/null 'http://localhost:3001/api/matches?date=2025-01-01'
curl -s -w '%{http_code}\n' -o /dev/null 'http://localhost:3001/api/matches?date=2026-04-11'
```

Expected: `400`, `400`, `200`.

### Task 6.11: Commit Phase 6

- [ ] **Step 1: Stage all changes**

```bash
git add client/package.json client/package-lock.json client/src/App.tsx client/src/main.tsx client/src/components/DatePicker.tsx client/src/hooks/useMatches.ts client/src/lib/routing.ts client/src/pages/NotFound.tsx client/src/pages/PredictionsPage.tsx
```

- [ ] **Step 2: Review the diff**

```bash
git diff --cached --stat
```

Expected: 9 files (2 modified package files, 3 modified, 4 created).

- [ ] **Step 3: Commit**

```bash
git commit -m "$(cat <<'EOF'
Persist selected date in URL path

Add react-router-dom and move App.tsx body into PredictionsPage,
which reads the date from useParams() and validates it via a
strict helper. Root / redirects to today (computed in Africa/
Nairobi). Invalid or pre-launch URLs render a NotFound page with
a context-specific message and a Back-to-today button.

DatePicker props split into onArrowChange (replace history) and
onPickerChange (push history) so arrow spamming doesn't clutter
browser history while native picker selections remain undoable.
Arrow buttons get title tooltips explaining the replace behavior.

React Query hooks gain staleTime: 10min + keepPreviousData to
avoid fetch storms during rapid navigation. Daily P/L disables
its refetchInterval for past dates.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Final verification

### Task 7.1: End-to-end sanity check

- [ ] **Step 1: Confirm the full feature set**

Load `http://localhost:3001/` in a fresh browser tab. Verify:
1. Redirects to `/2026-04-11`.
2. POTD card shows H / D / A odds (or empty state if no POTD).
3. Match table shows today's qualifying matches with correct badges.
4. POTD History section is grouped by month, all closed.
5. Glossary is collapsed at the bottom.

- [ ] **Step 2: Check each Phase's endpoint**

```bash
curl -s http://localhost:3001/api/health | grep -o '"status":"ok"'
curl -s 'http://localhost:3001/api/matches?date=2026-04-11' | grep -o '"matches":\[' | head -1
curl -s 'http://localhost:3001/api/predictions/pick-of-day?date=2026-04-11' | head -c 200
curl -s 'http://localhost:3001/api/predictions/accumulators?date=2026-04-11' | grep -o '"accumulators":\[' | head -1
curl -s 'http://localhost:3001/api/predictions/potd-history?days=30' | grep -o '"history":\[' | head -1
```

Expected: each returns a non-empty match.

- [ ] **Step 3: Verify no file was left uncommitted**

```bash
git status
```

Expected: `working tree clean` (aside from untracked `.baselines/` and `backups/` directories which are ignored).

---

## Rollback procedures

If a phase needs to be undone:

**Phases 1, 3, 4, 5, 6 (code-only):**
```bash
git revert <commit-sha>
# or, if not yet pushed:
git reset --hard <previous-commit>
```
Then rebuild and restart.

**Phase 2 (destructive DB cleanup):**
Only if data was deleted and the cleanup needs to be undone:
```bash
docker compose stop app
docker compose exec -T db psql -U football_app -c "DROP DATABASE football_predictions;"
docker compose exec -T db psql -U football_app -c "CREATE DATABASE football_predictions;"
docker compose exec -T db psql -U football_app football_predictions < backups/football_backup_<timestamp>.sql
docker compose start app
```

---

## Spec coverage checklist

Verify each spec section is implemented by a task:

- **F1 (Africa/Nairobi today):** Task 6.2 (`todayString` in routing.ts)
- **F2 (qualifiesByOdds helper):** Task 1.1
- **F3 (delete isValueBet):** Task 1.6
- **F4 (remove POTD fallback):** Task 1.5
- **Feature 1 (URL routing):** Phase 6 (Tasks 6.1-6.11)
- **Feature 1 — `<Navigate>` remount fix:** Task 6.5 (`RedirectToToday` with `useMemo`)
- **Feature 1 — server-side date validation:** Tasks 1.8, 1.9
- **Feature 1 — DatePicker tooltips:** Task 6.7
- **Feature 1 — React Query staleTime:** Task 6.8
- **Feature 2 (monthly history):** Task 4.1
- **Feature 2 — `key={month}`:** Task 4.1
- **Feature 2 — useMemo grouping:** Task 4.1
- **Feature 3 (collapsible glossary):** Task 5.1
- **Feature 4 (H/D/A odds):** Task 3.1
- **Feature 5 — shared qualifier call sites:** Tasks 1.2, 1.3, 1.4, 1.5, 1.7
- **Feature 5 — cleanup script:** Task 2.1
- **Feature 5 — dry-run idempotency:** Tasks 2.3, 2.4, 2.6
- **Feature 5 — backup:** Task 2.2
- **Feature 5 — pause cron:** Task 2.3
- **Feature 5 — orphan verification:** Task 2.7

Every spec requirement maps to a task above.
