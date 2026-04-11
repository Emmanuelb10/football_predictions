# Predictions Page Refinements — Design

**Date:** 2026-04-11
**Status:** Draft (pending approval)

This spec bundles four related refinements to the predictions page:

1. **Date-in-URL routing** — persist the selected date across refresh / share / back-forward navigation.
2. **Collapsible monthly POTD history** — group history by month, with collapsible sections.
3. **Collapsible glossary** — let the user hide the glossary until they need it.
4. **POTD card: full H/D/A odds** — show all three 1X2 odds on the Pick of the Day card, not only the tipped side.
5. **Rules enforcement consistency** — stop non-conforming matches from sneaking into POTD selection, accumulators, and the `is_value_bet` flag; clean up historical DB rows that violate the current odds rules.

The five items are bundled because they all touch the same page and because the user asked for them together. Where implementation order matters, the plan will sequence them so each step is reviewable in isolation.

---

## Feature 1 — Date-in-URL routing

### Problem

Selecting a past or future date in the date picker does not survive page refresh. `client/src/App.tsx:14` initializes state via `useState(dayjs().format('YYYY-MM-DD'))`, so a reload always snaps back to today. Users cannot bookmark or share a specific day's predictions.

### Goal

Persist the currently-viewed date in the URL path so that:

1. Refreshing the page preserves the date.
2. Copying the address bar shares a direct link to that date.
3. Browser back/forward navigates between viewed dates sensibly.
4. Invalid or out-of-range dates show a clear error instead of silently falling back to today.

### Non-goals

- Multi-page routing. The app has one view; this spec does not introduce additional routes beyond the date page, the root redirect, and a catch-all 404.
- Server-side URL handling beyond what already exists. The Express catch-all in `server/src/index.ts:26` already serves `index.html` for any non-API path.
- Changing API routes. Everything under `/api/*` is unchanged.

### Approach

Use `react-router-dom@^6` for client-side routing. The app is small enough that a router is not strictly necessary, but the user chose this approach for clarity and familiarity over a hand-rolled `history.pushState` hook.

### Architecture

Three routes defined in `App.tsx`:

| Path | Behavior |
|---|---|
| `/` | `<Navigate to="/{today}" replace />` — rewrites URL to today's date |
| `/:date` | `<PredictionsPage />` — validates the param, renders the app or `<NotFound />` |
| `*` | `<NotFound />` — structurally-broken paths |

`<BrowserRouter>` wraps the provider tree in `main.tsx`. The Express server needs no changes — the existing catch-all already serves `index.html` for any path, and API routes are namespaced under `/api/*`.

### Components

**New files**

- `client/src/pages/PredictionsPage.tsx` — holds all current `App.tsx` body content (header, DatePicker, PickOfDayCard, MatchTable, DailyPLBanner, AccumulatorCard, PotdHistory, Glossary). Reads `date` from `useParams()`, validates via `isValidDateParam`, returns `<NotFound invalidPath={date} />` inline if invalid, else passes the validated date to the existing hook tree.
- `client/src/pages/NotFound.tsx` — centered card with "Invalid or out-of-range date", the offending URL fragment, and a "Back to today" button that calls `navigate(todayPath())`. Styled with existing `var(--bg-*)` / `var(--accent-blue)` tokens.
- `client/src/lib/routing.ts` — exports `LAUNCH_DATE = '2026-03-16'`, `isValidDateParam(str): boolean` (format + strict parse + `>= LAUNCH_DATE`), `todayPath(): string` (returns `/{today}`).

**Changed files**

- `client/src/main.tsx` — wrap the provider tree in `<BrowserRouter>`.
- `client/src/App.tsx` — becomes a thin `<Routes>` shell (~15 lines).
- `client/src/components/DatePicker.tsx` — props change from `{ date, onChange }` to `{ date, onArrowChange, onPickerChange }`. Arrow buttons call `onArrowChange` (replace), native date input and "Today" button call `onPickerChange` (push). Local `LAUNCH_DATE` constant moves to `lib/routing.ts`.

### Data flow

1. User visits `/` → `<Navigate to="/2026-04-11" replace />` rewrites URL (no history entry).
2. User visits `/2026-04-05` → `PredictionsPage` reads param, `isValidDateParam` passes, fetches data for Apr 5.
3. User refreshes on `/2026-04-05` → same URL, same data, no reset. **This is the bug fix.**
4. User clicks arrow prev/next → `navigate('/2026-04-06', { replace: true })`. Back button does not walk through these.
5. User picks date via native input → `navigate('/2026-04-10')`. Back button returns to previous date.
6. User clicks "Today" button → `navigate('/2026-04-11')`. Back button returns to previous date.
7. Browser back/forward → react-router updates `:date` param, `PredictionsPage` re-renders with new date.
8. User visits `/foobar` → `isValidDateParam` fails → `<NotFound />`.
9. User visits `/2025-01-01` → pre-launch → `<NotFound />`.
10. User visits `/foo/bar/baz` → no route match → `<NotFound />` via `*` route.

### Validation

`isValidDateParam(str)` returns false for any of:
- Non-matching format (`hello`, `2026-4-11`, `2026/04/11`)
- Invalid calendar date (`2026-02-30`, `2026-13-01`)
- Dates before `2026-03-16` (launch)

No upper bound on future dates — matches existing DatePicker behavior.

### Dependencies

Add `react-router-dom@^6` to `client/package.json`. `dayjs` already ships with the app; strict date parsing requires the `customParseFormat` plugin, imported once in `lib/routing.ts`.

---

## Feature 2 — Collapsible monthly POTD history

### Problem

`client/src/components/PotdHistory.tsx` currently renders a flat 30-row table. As history accumulates, this will become long and hard to scan. Users should be able to fold up older months.

### Goal

Group POTD history entries by month (calendar month in `Africa/Nairobi`), render each month as a collapsible section, and show per-month aggregate stats (picks count, wins, losses, hit ratio, total profit) in the month header.

### Approach

Client-side grouping only. The `/api/predictions/potd-history` endpoint (`server/src/routes/predictions.ts:128`) already returns all picks sorted by date descending — group them in the component. No backend changes.

Use the native `<details>` / `<summary>` HTML elements for collapsibility. They are accessible, keyboard-navigable by default, and require zero JavaScript for toggle state. React re-renders preserve the open state because the DOM element is preserved by key.

### Components

**Changed file: `client/src/components/PotdHistory.tsx`**

- After receiving `data.history`, group entries by `dayjs(entry.date).format('YYYY-MM')`.
- For each month group, compute: `total`, `settled`, `wins`, `losses`, `hitRatio`, `totalProfit`.
- Render each group inside `<details>` with a `<summary>` row showing: month name (e.g. "April 2026"), pick count, W-L, hit ratio, and profit (with color coding matching the global summary).
- Current month (`dayjs().format('YYYY-MM')`) is rendered with the `open` attribute; all earlier months are closed by default.
- The existing table header row moves inside each `<details>` so the columns are clear when a section is open.
- Keep the existing card-level summary (total settled / wins / losses / profit) outside the collapsibles, unchanged.

### Default state

- Current month: open
- All prior months: closed

No user-preference persistence (localStorage). Rationale: simple, predictable; users who want the old "everything visible" behavior can click each section.

### History horizon

Default horizon remains 30 days (matches existing `usePotdHistory` hook calling `fetchPotdHistory(30)`). If the user eventually wants more history, changing `30` in `hooks/useMatches.ts:59` is a one-line follow-up — out of scope for this spec.

---

## Feature 3 — Collapsible glossary

### Problem

`client/src/components/Glossary.tsx` renders 18 definitions in a two-column grid at the bottom of the page. It is valuable as a reference but always visible even for returning users who no longer need it.

### Goal

Collapse the glossary by default; let the user expand it with a click.

### Approach

Wrap the existing `<div className="grid ...">` content in `<details>` with a `<summary>` that shows the existing "📚 Glossary" heading. Default: closed (`<details>` without the `open` attribute).

No grouping, no per-section collapse, no search — just a single top-level toggle. Simplest possible behavior.

### Default state

- Closed on first visit.
- No persistence; each new page load starts closed.

### Components

**Changed file: `client/src/components/Glossary.tsx`** — minor structural change only. Existing term list and styling are preserved verbatim.

---

## Feature 4 — POTD card: full H/D/A odds display

### Problem

The Pick of the Day card (`client/src/components/PickOfDayCard.tsx:92-99`) currently shows only the tipped-side odds as a single 2xl-bold gold number. The user wants to see all three 1X2 odds (home, draw, away) on the card so that the ratio between the pick and the other sides is immediately visible — this is especially important for confirming the "opposing side is a heavy underdog" framing.

### Goal

Replace the single odds stat with a compact three-column H/D/A display. The tipped side is visually emphasized (gold), the other two are shown in secondary-text color. Odds in the 1.50-1.99 value range get the same green highlight used in `MatchTable.tsx:56-68`.

### Approach

A small presentational change inside `PickOfDayCard.tsx`. The card's data source (`/api/predictions/pick-of-day`) already returns `home_odds`, `draw_odds`, `away_odds` — see `server/src/models/Prediction.ts:51`.

### Components

**Changed file: `client/src/components/PickOfDayCard.tsx`**

- Remove the `const odds = pick.tip === '1' ? ...` single-value computation at line 40.
- Replace the single-stat "Odds" block at lines 92-99 with a three-column group:
  - Column header "Odds (H / D / A)"
  - Three numbers laid out horizontally, each with `OddsVal`-style styling (green highlight when in 1.50-1.99, bold when tipped side).
  - The tipped side gets a gold background accent (`rgba(245,158,11,0.12)`) and gold-bold text (`var(--accent-gold)`) so it remains the prominent one.
- Extract a small `OddsCell` subcomponent inside the file (not a new file) to keep the three columns DRY.
- Preserve the existing Win Prob and Expected Value stats to the left and right. The card layout grid (currently `md:grid-cols-3`) becomes `md:grid-cols-4` to accommodate the expanded odds section, OR the three odds stay inside the same middle cell as a subgroup. Pick whichever fits the card width better — the plan phase will decide after inspecting the rendered width.

### Fallback behavior

If any of `home_odds`, `draw_odds`, `away_odds` is null (stale or missing row), fall back to `-` in the affected cell. The whole odds block is not suppressed — other cells still render.

---

## Feature 5 — Rules enforcement consistency

### Problem

The "70%+ prob AND tipped odds 1.50-1.99 AND opposing side >= 5.00" rule is enforced in:

- `server/src/cron/fixtureIngestion.ts:71-87` — ingestion filter (correct).
- `server/src/routes/matches.ts:85-94` — read-time filter for the matches list (correct).

But it is **not** enforced in:

- `server/src/services/predictionEngine.ts:107` — `selectPickOfDay()` picks from `is_value_bet = true` rows (or falls back to `confidence >= 0.55`) without checking opposing-side odds or the strict tipped-odds range.
- `server/src/routes/predictions.ts:33-46` — accumulator builder selects from `is_value_bet = true` without checking opposing-side odds.
- `server/src/utils/expectedValue.ts:23` — `isValueBet()` uses `odds > 1.50` (strict), while every other filter uses `>= 1.50`. This 1-pip difference causes matches tipped at exactly 1.50 to be displayed in the matches list but rendered with a blue (non-value) badge.

The result: today's POTD is `Cercle Brugge vs Raal La Louviere` with home=1.90 / draw=3.45 / **away=3.60**. The opposing side (away, because tip=1) is 3.60 — below 5.00, so the rule is violated. The match is correctly hidden from the matches list but still surfaces as POTD, contradicting the filter.

Additionally, some stale rows exist in the database from before the "opposing >= 5.00" rule was enforced (or from scrapes where one code path was updated before another). They pollute the POTD fallback, the accumulator pool, and the `is_value_bet` statistics.

### Goal

- Every code path that selects or displays matches uses the same three-rule filter.
- The `is_value_bet` flag and display filters agree (inclusive `>= 1.50`).
- Historical DB rows that do not satisfy the current rules are removed.
- POTDs recorded against non-conforming matches are recomputed — resulting in "no POTD" for some days, which is acceptable and honest.

### Approach

**A. Introduce a shared qualification helper**

New file: `server/src/utils/qualification.ts`. Exports:

```ts
export const TIP_ODDS_MIN = 1.50;
export const TIP_ODDS_MAX = 1.99;
export const OPPOSING_ODDS_MIN = 5.00;
export const MIN_PROBABILITY = 0.70;

// Pure predicate, takes raw numbers
export function qualifiesByOdds(
  tip: '1' | 'X' | '2',
  homeOdds: number,
  drawOdds: number,
  awayOdds: number,
  probability: number
): boolean;
```

All three existing filters (ingestion, matches route, isValueBet) are rewritten to delegate to this helper. The helper is the single source of truth for "is this a qualifying match".

`isValueBet()` in `utils/expectedValue.ts` becomes a thin wrapper that calls `qualifiesByOdds` with the tipped side + the two sides it has. Because it currently only has probability and one odds value (the tipped one), its signature needs to change — or it needs to be deprecated in favor of `qualifiesByOdds` called with all 1X2 odds. The plan phase will pick the cleaner refactor.

Note: `isValueBet` is called in `predictionEngine.ts:57` where all three odds are already loaded from `OddsModel.getLatestOdds(matchId)`, so passing the full 1X2 triple is straightforward.

**B. Enforce the rule in POTD selection**

`selectPickOfDay` in `services/predictionEngine.ts:107` runs a SQL query that currently filters on `p.is_value_bet = true` only. Change the query (or a post-fetch filter in JS) to additionally require:
- Strict tipped odds in `[1.50, 1.99]`
- Opposing odds `>= 5.00`
- `p.confidence >= 0.70`

The simplest approach is a JS post-filter on the already-fetched candidate list, using the shared `qualifiesByOdds` helper. No new SQL complexity.

The "fallback to confidence >= 0.55" path is **removed**. If no qualifying value bets exist for a day, no POTD is stored. `PotdHistory` and the POTD endpoint already handle "no pick" (they return `null` / empty), so no UI changes are required beyond the existing empty state.

**C. Enforce the rule in the accumulator endpoint**

`routes/predictions.ts:33-46` — the SQL query is fine as-is; add a JS post-fetch `.filter(qualifiesByOdds(...))` before building combinations.

**D. One-time DB cleanup script**

New file: `server/src/scripts/cleanupNonConformingMatches.ts`. The script:

1. Selects every match whose latest odds row + prediction does NOT satisfy `qualifiesByOdds`.
2. Logs a summary: "Found N non-conforming matches (X scheduled, Y finished)".
3. Deletes in the following order inside a single transaction:
   - `predictions` WHERE `match_id` in the non-conforming set
   - `odds_history` WHERE `match_id` in the non-conforming set
   - `matches` WHERE `id` in the non-conforming set
4. Counts affected dates and calls `selectPickOfDay(date)` for each, so any day that lost its POTD is recomputed from the remaining qualifying matches (which may result in "no POTD" for that day).
5. Logs a final summary of deleted counts and recomputed dates.

The script is runnable as `node dist/scripts/cleanupNonConformingMatches.js` from a shell, or via a one-shot trigger endpoint `POST /api/trigger/cleanup-nonconforming` that runs it asynchronously and returns immediately (matching the existing trigger pattern in `routes/index.ts:21`).

### Safety

- The cleanup script runs inside a single PostgreSQL transaction so partial deletes cannot leave the DB in an inconsistent state.
- A dry-run mode (`--dry-run` CLI flag or `?dryRun=1` on the trigger endpoint) logs the count and list of affected match IDs without actually deleting, so the user can review before committing.
- The plan will require a `pg_dump` backup step before the first real run, documented in the plan's "before you execute" notes.

### Why delete instead of just filtering

The display filter already hides these matches, so why physically remove them? Three reasons:

1. **POTD history integrity.** A historical POTD pinned to a non-conforming match is a misleading record of "what we would have picked if the rule had been enforced". Recomputing requires the pool of candidates to exclude those matches — deletion is the cleanest way.
2. **Performance and clarity.** The matches table is small, but the accumulator and POTD pool queries scan all predictions per date; leaving stale rows wastes effort and clouds debugging.
3. **User expectation.** The user explicitly asked for "updated in the db to follow the odd ranges we provided", which literally means cleanup rather than "just hide them".

An **assumption** is documented here: historical POTDs are mutable (we are willing to rewrite history when rules change). If the user prefers immutable history, an alternative is to add a `legacy` flag on `predictions` rather than deleting, and to filter `legacy=true` out of the POTD/accumulator/matches endpoints. The critic agents should flag this if they disagree with the current choice.

---

## Shared manual test plan

The repo has no automated tests (`CLAUDE.md`: "There are no tests or linting configured"). Verify manually after implementation, in the order listed:

### URL routing
1. Visit `/` → redirects to `/2026-04-11`, predictions for today load.
2. Visit `/2026-04-05` → loads Apr 5 predictions, URL stays.
3. Refresh on `/2026-04-05` → still Apr 5 (the bug fix).
4. Arrow left from `/2026-04-11` → URL `/2026-04-10`, back button exits app.
5. Native picker from `/2026-04-11` to `/2026-04-05` → back button returns to `/2026-04-11`.
6. "Today" button from `/2026-04-05` → back button returns to `/2026-04-05`.
7. Visit `/hello` → NotFound page with "hello" fragment.
8. Visit `/2025-01-01` → NotFound (pre-launch).
9. Visit `/2026-02-30` → NotFound (invalid calendar).
10. Visit `/2030-01-01` → loads (future allowed).
11. `NotFound` "Back to today" button → URL `/2026-04-11`.
12. `/api/health` returns 200.

### Collapsible POTD history
13. Load the page → POTD history section exists, current month is expanded, all prior months are closed.
14. Click an older month summary row → expands and shows full table rows for that month.
15. Each month summary shows correct pick count, W-L count, hit ratio, and total profit (sanity-check against raw data).
16. Click the current month summary → closes it.
17. Refresh the page → current month is open again (no persistence is expected).

### Collapsible glossary
18. Load the page → glossary card is visible with heading; terms are hidden.
19. Click the glossary header → expands and shows the 18 terms.
20. Click again → collapses.

### POTD card full odds
21. Load a date with a valid POTD → card shows H / D / A odds as three numbers with clear labels.
22. The tipped side is visually emphasized (gold).
23. Odds in the 1.50-1.99 range render with the green value highlight.
24. On a POTD where `home_odds` is null → that cell renders `-`, others render normally.

### Rules enforcement
25. Before running cleanup: `curl /api/predictions/pick-of-day?date=2026-04-11` → current POTD Cercle Brugge.
26. Run cleanup script in dry-run → logs list of affected matches including Cercle Brugge.
27. Run cleanup script for real → affected count matches dry-run.
28. `curl /api/predictions/pick-of-day?date=2026-04-11` → new POTD (picked from remaining qualifying matches) or `null` if none exist.
29. `curl /api/matches?date=2026-04-11` → still returns the same 9 matches as before cleanup (those were already conforming).
30. `curl /api/predictions/accumulators?date=2026-04-11` → combos use only the 9 conforming matches.
31. Shanghai Shenhua match (tip=1, home=1.50) in `/api/matches` → tip badge renders **green** (after `isValueBet` fix with `>= 1.50`).
32. Re-scrape today: `POST /api/trigger/ingest?date=2026-04-11` → no new non-conforming matches enter the DB.
33. Spot-check a random past date: `/api/predictions/pick-of-day?date=2026-04-07` → either a different (conforming) POTD, or `null`.

---

## Risks & open questions

- **Bundle size:** `react-router-dom@^6` adds ~10KB gzipped. Acceptable per user's explicit preference.
- **`customParseFormat` plugin:** must be loaded once at app start before any `dayjs(..., format, strict)` call. Loading it in `lib/routing.ts` ensures it runs before any route code.
- **Vite dev server (`npm run dev`, port 3000):** Vite dev server serves `index.html` for unknown paths by default, so `/2026-04-05` works in dev. No extra Vite config needed.
- **Docker production build:** Express catch-all already handles any path. No compose or Dockerfile changes.
- **`<details>` element state preservation across re-renders:** React Query refetches every 90-120s. The native `<details>` element retains its open/closed state across React re-renders as long as the DOM node is reused (same key). React will reuse it because we're not changing the element type or the key. This is reliable behavior — confirmed by React 19 release notes.
- **Mobile layout for 4-column POTD card:** The existing card uses `md:grid-cols-3`. Adding H/D/A odds may push it to 4 columns on desktop. On mobile (`grid-cols-1`), everything stacks so there is no layout risk, but desktop crowding is a concern. The plan will inspect the rendered width and decide whether to keep 3 columns (with H/D/A as a subgroup in the middle cell) or go to 4 columns.
- **Historical POTD mutability (Feature 5):** documented above. The choice is to delete non-conforming matches and recompute POTD history. If immutability matters to the user, an alternative is a `legacy` flag. Flag this explicitly in user review.
- **Cleanup script safety:** runs inside a transaction, has a dry-run mode, requires pg_dump backup first. Still, it's a destructive operation — the plan will require explicit user confirmation before the first real run.
- **POTD fallback removal:** removing the "fallback to confidence >= 0.55" branch in `selectPickOfDay` means some days will simply have no POTD. This is a behavioral change. Users will see the "No qualifying value bets found for this date" empty state more often. That is correct per the rule, but worth confirming with the user.
- **`customParseFormat` double-extend:** calling `dayjs.extend(customParseFormat)` is idempotent — safe to call from multiple modules.

## Implementation order (informational — the plan owns the real sequencing)

A reasonable order, each step independently reviewable:

1. Feature 5 code-path fixes (shared helper, selectPickOfDay, accumulator filter, isValueBet inclusive-1.50). No data deletion yet. Verify POTD for today changes.
2. Feature 5 cleanup script (dry-run first, then real run with backup). Verify DB state.
3. Feature 4 POTD card full odds display.
4. Feature 2 collapsible monthly POTD history.
5. Feature 3 collapsible glossary.
6. Feature 1 URL routing (biggest structural change, best saved for last to minimize conflicts with the other 4).

Rationale: Feature 5 fixes a real data correctness issue and should not be blocked by UI work. Feature 1 restructures `App.tsx` into pages/ and touches `DatePicker` — doing it last lets the UI changes above merge cleanly first.
