# Predictions Page Refinements — Design

**Date:** 2026-04-11
**Status:** Draft v2 (post 10-agent critique)

This spec bundles five related refinements to the predictions page:

1. **Date-in-URL routing** — persist the selected date across refresh / share / back-forward navigation.
2. **Collapsible monthly POTD history** — group history by month, with collapsible sections.
3. **Collapsible glossary** — let the user hide the glossary until they need it.
4. **POTD card: full H/D/A odds** — show all three 1X2 odds on the Pick of the Day card.
5. **Rules enforcement consistency** — stop non-conforming matches from sneaking into POTD selection, accumulators, and the `is_value_bet` flag; clean up historical DB rows that violate the current odds rules.

Although bundled in one spec (user asked for them together), each feature is independently reviewable and the implementation plan will treat them as sequential, self-contained sub-steps. See **Implementation Order** at the bottom of this spec.

---

## Foundational clarifications (applies to all features)

These fix recurring ambiguities surfaced during critique.

### F1. The canonical "today" is Africa/Nairobi

The server runs on Africa/Nairobi (UTC+3) for all date logic. Today's match list is built by `DATE(kickoff AT TIME ZONE 'Africa/Nairobi')`. The client must compute "today" the same way, not in the user's local timezone.

**Implementation:** In `client/src/lib/routing.ts`:

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

export function todayString(): string {
  return dayjs().tz(SERVER_TZ).format('YYYY-MM-DD');
}
```

All client code that computes "today" (DatePicker, routing redirect, toasts, useMemo keys) calls `todayString()`. No raw `dayjs().format('YYYY-MM-DD')` calls anywhere in the client.

### F2. The shared qualifier is the single source of truth

**New file: `server/src/utils/qualification.ts`**

```ts
export const TIP_ODDS_MIN = 1.50;
export const TIP_ODDS_MAX = 1.99;
export const OPPOSING_ODDS_MIN = 5.00;
export const MIN_PROBABILITY = 0.70;

export type Tip = '1' | 'X' | '2';

/**
 * Inclusive on all bounds. Handles null odds by returning false
 * (no qualification judgment possible without data).
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
    // draw tip — both home and away must be >= 5.00
    tipOdds = drawOdds;
    opposingOdds = Math.min(homeOdds, awayOdds);
  }

  if (tipOdds < TIP_ODDS_MIN || tipOdds > TIP_ODDS_MAX) return false;
  if (opposingOdds < OPPOSING_ODDS_MIN) return false;
  return true;
}
```

This helper is imported by **all** filter sites: `fixtureIngestion.ts`, `routes/matches.ts`, `services/predictionEngine.ts` (`selectPickOfDay` and `storePrediction`), `routes/predictions.ts` (accumulator and POTD history), and the cleanup script.

### F3. `isValueBet` is removed, not refactored

`server/src/utils/expectedValue.ts` currently exports `isValueBet(aiProbability, odds): boolean` with the signature `aiProbability >= 0.70 && odds > 1.50`. The `>` lower bound is the inconsistency: `fixtureIngestion.ts:81` and `routes/matches.ts:91` use `< 1.50 || > 1.99` which **accepts** `1.50` exactly, while `isValueBet` rejects it.

The fix: **delete `isValueBet` entirely**. Its only call site is `server/src/services/predictionEngine.ts:57`:

```ts
// Before:
valueBet = isValueBet(confidence, tipOdds);

// After:
valueBet = qualifiesByOdds(tip, Number(odds.home_odds), Number(odds.draw_odds), Number(odds.away_odds), confidence);
```

`calculateEV`, `impliedProbability`, and `determineTip` in the same file stay untouched.

### F4. POTD fallback behavior: the `confidence >= 0.55` path is removed

`services/predictionEngine.ts:124-143` currently falls back to `confidence >= 0.55` when no value bets exist for a day. The spec removes this fallback **entirely**. After the change, if `selectPickOfDay(date)` finds zero candidates passing `qualifiesByOdds`, it stores no POTD for that date (sets `is_pick_of_day = false` for all predictions on that date via `clearPickOfDay`, then returns `null`).

This is a behavioral change. Users will see "No qualifying value bets found for this date" more often — especially after the cleanup runs on historical data. Documented as a breaking change in the manual test plan.

---

## Feature 1 — Date-in-URL routing

### Problem

Selecting a past or future date in the date picker does not survive page refresh. `client/src/App.tsx:14` initializes state via `useState(dayjs().format('YYYY-MM-DD'))`, so a reload always snaps back to today. Users cannot bookmark or share a specific day's predictions.

### Goal

Persist the currently-viewed date in the URL path so that:

1. Refreshing the page preserves the date.
2. Copying the address bar shares a direct link to that date.
3. Browser back/forward navigates between viewed dates sensibly.
4. Malformed or pre-launch dates show a clear error with a path back to today.

### Non-goals

- Multi-page routing. The app has one view; this spec does not introduce additional routes beyond the date page, the root redirect, and a catch-all 404.
- Server-side URL handling beyond what already exists. The Express catch-all at `server/src/index.ts:26-28` already serves `index.html` for any non-API path.
- Changing API routes. Everything under `/api/*` is unchanged in URL surface.
- Server-side session state for the selected date. The URL is the state.

### Approach

Use `react-router-dom@^6` for client-side routing. (The user explicitly chose this over a hand-rolled `history.pushState` hook.)

### Architecture

Three routes defined in `App.tsx`:

| Path | Behavior |
|---|---|
| `/` | Redirect to `/{today}` with `replace` semantics |
| `/:date` | `<PredictionsPage />` — validates the param, renders the app or `<NotFound />` |
| `*` | `<NotFound />` — structurally-broken paths |

`<BrowserRouter>` wraps the provider tree in `main.tsx`. The Express catch-all already handles all non-API paths.

### Fix for `<Navigate>` remount (correctness critique blocker)

A naive `<Route path="/" element={<Navigate to={todayPath()} replace />} />` re-computes `todayPath()` on every render, which passes a new string reference and can cause re-redirect loops. The fix: compute the path **once at mount** inside a tiny wrapper component:

```tsx
// in App.tsx
function RedirectToToday() {
  const path = React.useMemo(() => `/${todayString()}`, []);
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

`useMemo` captures the string at the first render of the route element; re-renders reuse it. If the user keeps the app open across midnight, they stay on the date they opened with — consistent with the existing behavior.

### Components

**New files**

- `client/src/pages/PredictionsPage.tsx` — holds all the current `App.tsx` body content (header, DatePicker, PickOfDayCard, MatchTable, DailyPLBanner, AccumulatorCard, PotdHistory, Glossary). Reads `date` from `useParams()`, validates via `isValidDateParam`, returns `<NotFound invalidPath={date} />` inline if invalid, else passes the validated date to the existing hook tree. Constructs the navigation callbacks:

  ```tsx
  const navigate = useNavigate();
  const onArrowChange = (d: string) => navigate(`/${d}`, { replace: true });
  const onPickerChange = (d: string) => navigate(`/${d}`);
  <DatePicker date={date!} onArrowChange={onArrowChange} onPickerChange={onPickerChange} />
  ```

- `client/src/pages/NotFound.tsx` — a centered card that distinguishes the reason for the error:

  ```tsx
  // pseudo
  <div className="card">
    <h2>This date isn't available</h2>
    {reason === 'pre-launch' && (
      <p>The app tracks predictions starting <strong>2026-03-16</strong>. Please pick a date on or after launch.</p>
    )}
    {reason === 'invalid-format' && (
      <p>The URL <code>{invalidPath}</code> is not a valid date.</p>
    )}
    <button onClick={() => navigate(`/${todayString()}`)}>Back to today</button>
  </div>
  ```

  **XSS note:** `invalidPath` is rendered with React's default `{}` text interpolation inside a `<code>` tag. No `dangerouslySetInnerHTML`. No template string concatenation into JSX. The value comes from `useParams()` which is already URL-decoded by React Router, but React's text rendering escapes any HTML-like characters.

- `client/src/lib/routing.ts` — exports `LAUNCH_DATE`, `SERVER_TZ`, `todayString()`, and `isValidDateParam(str): { valid: true } | { valid: false; reason: 'invalid-format' | 'pre-launch' }`. Format is strict `/^\d{4}-\d{2}-\d{2}$/` + `dayjs(str, 'YYYY-MM-DD', true).isValid()` + `>= LAUNCH_DATE`. Returns the failure reason so `NotFound` can customize the message.

  **Side-effect imports**: extends dayjs plugins (`utc`, `timezone`, `customParseFormat`) at module top level. The extend calls are idempotent — safe to call multiple times.

  **Import order**: `main.tsx` imports `./lib/routing` before `./App`, guaranteeing the plugins are loaded before any route code runs.

**Changed files**

- `client/src/main.tsx` — wraps provider tree in `<BrowserRouter>` and imports `./lib/routing` at the top for plugin side effects.
- `client/src/App.tsx` — becomes a thin `<Routes>` shell (~15 lines).
- `client/src/components/DatePicker.tsx` — props change from `{ date, onChange }` to `{ date, onArrowChange, onPickerChange }`:

  ```ts
  interface DatePickerProps {
    date: string;
    onArrowChange: (date: string) => void;  // prev/next arrow buttons
    onPickerChange: (date: string) => void; // native date input + Today button
  }
  ```

  `prev()` and `next()` call `onArrowChange`. Native `<input type="date">` onChange and `today()` button call `onPickerChange`. Local `LAUNCH_DATE` constant moves to `lib/routing.ts`.

  DatePicker has only one caller (`App.tsx:68`), confirmed via grep. The new caller is in `PredictionsPage.tsx` as shown above.

  **UX polish:** add a `title` attribute to the prev/next arrow buttons: `"Navigate without adding browser history"`. This signals the replace-history behavior without requiring documentation. Also update the disabled-prev tooltip: `"Launch date — cannot go further back"`.

### Route data flow

1. User visits `/` → `RedirectToToday` computes `/{today}` (in Nairobi TZ) once via `useMemo`, renders `<Navigate replace>`.
2. User visits `/2026-04-05` → `PredictionsPage` reads param, validates, fetches data for Apr 5.
3. User refreshes on `/2026-04-05` → same URL, same data. **Bug fix.**
4. User clicks arrow prev/next → `navigate('/2026-04-06', { replace: true })`. Back button does NOT walk through intermediate arrow clicks.
5. User picks date via native input → `navigate('/2026-04-10')` (push). Back button returns to previous date.
6. User clicks "Today" button → `navigate('/2026-04-11')` (push). Back button returns to previous date.
7. Browser back/forward → react-router updates `:date` param, `PredictionsPage` re-renders with new date.
8. User visits `/foobar` → `isValidDateParam` returns `{ valid: false, reason: 'invalid-format' }` → `<NotFound />` with format-specific message.
9. User visits `/2025-01-01` → `{ valid: false, reason: 'pre-launch' }` → `<NotFound />` with launch-date message.
10. User visits `/foo/bar/baz` → no route match → `<NotFound />` via `*` route, shown as format error.

### Query strings and fragments

React Router passes `?foo=bar` and `#hash` through unchanged. The `/:date` route param only captures the first path segment. Behavior:

- `/2026-04-05?foo=bar` — route matches, `date` is `2026-04-05`, query string preserved in `location.search` but currently unused.
- `/2026-04-05#details` — route matches, fragment preserved.
- `/2026-04-05/extra` — route does NOT match (React Router's `/:date` is exact), falls through to `*` → `NotFound`.

The spec neither encourages nor breaks query-string extensions. If future features want to add `?view=reasoning`, they can layer on without changing routing.

### Validation

`isValidDateParam(str)` rejects:
- Non-matching format (`hello`, `2026-4-11`, `2026/04/11`) — reason `invalid-format`
- Invalid calendar dates (`2026-02-30`, `2026-13-01`, `2026-02-29` — 2026 is not a leap year) — reason `invalid-format`
- Dates before `2026-03-16` (launch) — reason `pre-launch`

No upper bound. Future dates are allowed. The spec does NOT claim invalid dates are "out-of-range" (a wording inconsistency from the previous draft) — only the specific reasons above are checked.

### Server-side defense in depth

Even though the client validates, the server must also validate to prevent defense-in-depth gaps. Add a small helper `server/src/utils/dateValidation.ts` with the same three-rule check, and call it at the top of `routes/matches.ts`, `routes/predictions.ts` (POTD, POTD history, accumulators), and `routes/performance.ts`:

```ts
import dayjs from 'dayjs';
import customParseFormat from 'dayjs/plugin/customParseFormat';
dayjs.extend(customParseFormat);

const LAUNCH_DATE = '2026-03-16';
export function isValidDateString(str: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(str)) return false;
  if (!dayjs(str, 'YYYY-MM-DD', true).isValid()) return false;
  return str >= LAUNCH_DATE;
}
```

At each route:

```ts
const date = (req.query.date as string) || dayjs().tz('Africa/Nairobi').format('YYYY-MM-DD');
if (!isValidDateString(date)) {
  res.status(400).json({ error: 'Invalid date', date });
  return;
}
```

Existing parameterized SQL already protects against injection, but this adds an explicit 400 response for malformed parameters rather than silently returning empty arrays.

### Dependencies

Add `react-router-dom@^6` to `client/package.json`. Actual bundle cost is ~4KB gzipped (previous draft incorrectly quoted ~10KB; verified against bundlephobia).

`dayjs` already ships with the app; `customParseFormat` plugin adds ~1–2KB minified. Total new client bundle cost: ~5–6KB gzipped.

### Performance polish

Add `staleTime: 600000` (10 min) and `placeholderData: keepPreviousData` to the date-bound React Query hooks (`useMatches`, `usePickOfDay`, `useDailyPL`, `useAccumulators`) in `client/src/hooks/useMatches.ts`. This prevents refetch storms when the user rapidly arrow-clicks through dates: recently-viewed dates serve from cache, and the currently-displayed data stays on screen during background refetches.

Also: `useDailyPL` disables its `refetchInterval` for past dates:

```ts
export function useDailyPL(date: string) {
  const isToday = date === todayString();
  return useQuery({
    queryKey: ['daily-pl', date],
    queryFn: () => fetchDailyPL(date),
    enabled: !!date,
    refetchInterval: isToday ? 60000 : false,
    staleTime: 600000,
  });
}
```

Past dates have settled P/L — no reason to refetch every minute.

### Vite dev server proxy

Vite's SPA fallback serves `index.html` for any unknown path. During dev, `/api/*` must hit the Express backend on port 3001 — currently handled by the Vite proxy. Verify `client/vite.config.ts` has:

```ts
server: {
  proxy: {
    '/api': 'http://localhost:3001',
  },
},
```

(This is likely already present since the client/server split predates this spec. The plan phase must verify.)

---

## Feature 2 — Collapsible monthly POTD history

### Problem

`client/src/components/PotdHistory.tsx` renders a flat 30-row table. As history accumulates, it becomes long and hard to scan. Users should be able to fold up older months.

### Goal

Group POTD history by month (calendar month in Africa/Nairobi), render each month as a collapsible section, and show per-month aggregate stats in the month header.

### Approach

Client-side grouping only. The `/api/predictions/potd-history` endpoint already returns all picks sorted by date descending — group them in the component.

Use native `<details>` / `<summary>` HTML elements for collapsibility. Accessible, keyboard-navigable, zero JavaScript needed for toggle state. `<details>` preserves its `open` state across React re-renders as long as the DOM node has a stable key.

### Components

**Changed file: `client/src/components/PotdHistory.tsx`**

1. After receiving `data.history`, use `useMemo` to group entries by `dayjs(entry.date).format('YYYY-MM')`:

   ```tsx
   const monthGroups = useMemo(() => {
     const groups = new Map<string, typeof history>();
     for (const h of history) {
       const monthKey = dayjs(h.date).format('YYYY-MM');
       if (!groups.has(monthKey)) groups.set(monthKey, []);
       groups.get(monthKey)!.push(h);
     }
     return Array.from(groups.entries())
       .sort((a, b) => b[0].localeCompare(a[0])); // newest first
   }, [history]);
   ```

2. For each month group, compute aggregate stats (memoized alongside the grouping):
   - `total` — count of picks in month
   - `settled` — count where `outcome !== 'pending'`
   - `wins`, `losses`
   - `hitRatio` — `wins / settled` (0 if no settled picks)
   - `totalProfit` — sum of `profit` column

3. Render each group inside `<details key={month}>`:

   ```tsx
   {monthGroups.map(([month, entries]) => {
     const stats = computeStats(entries);
     const monthLabel = dayjs(month + '-01').format('MMMM YYYY');
     return (
       <details key={month}>
         <summary>
           <span className="font-semibold">{monthLabel}</span>
           <span>{stats.total} picks</span>
           <span>{stats.wins}W - {stats.losses}L</span>
           <span>{(stats.hitRatio * 100).toFixed(0)}% hit</span>
           <span>{stats.totalProfit >= 0 ? '+' : ''}{stats.totalProfit.toFixed(2)}u</span>
         </summary>
         <table>{/* existing columns */}</table>
       </details>
     );
   })}
   ```

4. **All months closed by default.** No auto-open for the current month. Rationale (scope critique): simpler, no hidden state, avoids the "month boundary flip" UX issue where the open section silently moves when the calendar rolls over.

5. `key={month}` is explicit so React reuses the same DOM node across refetches — this is what preserves the native `<details>` open state.

6. Keep the existing card-level global summary (total / wins / losses / profit) outside the collapsibles, unchanged.

### History horizon

Default remains 30 days. Hook `usePotdHistory` in `hooks/useMatches.ts:56-62` calls `fetchPotdHistory(30)`. Not changed in this spec.

### Zero-pick month handling

A month with zero entries simply doesn't produce a group — the grouping loop skips it. No "empty month" placeholder. The backend only returns picks that exist.

---

## Feature 3 — Collapsible glossary

### Problem

`client/src/components/Glossary.tsx` renders 18 definitions in a two-column grid at the bottom of the page. Valuable as a reference but always visible.

### Goal

Collapse the glossary by default; let the user expand it with a click.

### Approach

Wrap the existing `<div className="grid ...">` in `<details>` with a `<summary>` for the "📚 Glossary" heading. Default state: closed.

### Components

**Changed file: `client/src/components/Glossary.tsx`**

```tsx
export default function Glossary() {
  const terms = [/* unchanged */];

  return (
    <details className="card" style={{ marginTop: 16 }}>
      <summary className="cursor-pointer list-none">
        <h2 className="text-lg font-bold inline-flex items-center gap-2">
          <span className="toggle-arrow">▶</span>
          📚 Glossary
          <span className="text-xs text-secondary">(click to expand)</span>
        </h2>
      </summary>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-3 mt-4">
        {/* existing terms unchanged */}
      </div>
    </details>
  );
}
```

### Affordance polish

- `summary { cursor: pointer; list-none; }` to hide the default browser disclosure triangle and show a custom chevron.
- `.toggle-arrow` rotates 90° when `details[open]` via CSS selector.
- Small secondary-text hint "(click to expand)" to make the collapsible affordance explicit on first visit.

### Default state

Closed. No localStorage persistence. If a user opens and refreshes, it closes again. Simpler, no state leakage across sessions.

---

## Feature 4 — POTD card: full H/D/A odds display

### Problem

The Pick of the Day card at `client/src/components/PickOfDayCard.tsx:92-99` shows only the tipped-side odds as a single 2xl-bold gold number. The user wants to see all three 1X2 odds so the ratio between the pick and the other sides is immediately visible — this confirms the "opposing side is a heavy underdog" framing that drives the qualification rule.

### Goal

Replace the single odds stat with a compact three-column H/D/A display. The tipped side gets gold emphasis. Odds in the 1.50-1.99 range get the same green highlight as `MatchTable.tsx:56-68`.

### Layout decision

**Keep the existing `md:grid-cols-3` layout.** Place the three odds as a horizontal row inside the middle cell as a subgroup, replacing the current single Odds stat. This avoids the "4-column crowding on desktop" concern raised in the UX critique and works naturally on mobile (where everything stacks to 1 column anyway).

Rendered layout (middle cell):

```
      Win Prob    Odds                    Expected Value
      73%         H       D       A       +13.2%
                  1.55    3.70    5.70
                  (gold)  (-)     (-)
```

The tipped side gets gold text + a subtle gold background tint. The other two sides are `var(--text-secondary)`. Odds in 1.50-1.99 get the green value-range highlight regardless of which side is tipped.

### Components

**Changed file: `client/src/components/PickOfDayCard.tsx`**

1. Remove the single-value `const odds = ...` computation at line 40.
2. Replace the single-stat odds block (lines 92-99) with a three-cell subgroup:

   ```tsx
   <div className="text-center">
     <p className="text-sm text-secondary">Odds<InfoTip text="..." /></p>
     <div className="grid grid-cols-3 gap-2 mt-1">
       <OddsCell label="H" value={pick.home_odds} isTipped={pick.tip === '1'} />
       <OddsCell label="D" value={pick.draw_odds} isTipped={pick.tip === 'X'} />
       <OddsCell label="A" value={pick.away_odds} isTipped={pick.tip === '2'} />
     </div>
   </div>
   ```

3. Define `OddsCell` as a local file-scoped subcomponent (mirrors the `OddsVal` pattern in `MatchTable.tsx`):

   ```tsx
   function OddsCell({ label, value, isTipped }: { label: string; value: number | null | undefined; isTipped: boolean }) {
     if (value == null) {
       return (
         <div>
           <span className="text-xs text-secondary">{label}</span>
           <div className="font-mono">-</div>
         </div>
       );
     }
     const n = Number(value);
     const isValueRange = n >= 1.50 && n <= 1.99;
     return (
       <div style={{
         background: isTipped ? 'rgba(245,158,11,0.12)' : isValueRange ? 'rgba(34,197,94,0.12)' : 'transparent',
         borderRadius: 4, padding: '2px 4px',
       }}>
         <span className="text-xs text-secondary">{label}</span>
         <div className="font-mono font-bold" style={{
           color: isTipped ? 'var(--accent-gold)' : isValueRange ? 'var(--accent-green)' : 'var(--text-primary)',
         }}>
           {n.toFixed(2)}
         </div>
       </div>
     );
   }
   ```

4. Any side with null/missing odds renders `-` in that cell. The whole odds section still renders — other cells are not suppressed.

### Data source

No backend change. `server/src/models/Prediction.ts:51` (the `findPickOfDay` SQL) already selects `oh.home_odds, oh.draw_odds, oh.away_odds` via `LEFT JOIN LATERAL`, so the API response already includes all three. Verified against the live endpoint: `curl /api/predictions/pick-of-day?date=2026-04-11` returns `"home_odds": "1.90", "draw_odds": "3.45", "away_odds": "3.60"`.

---

## Feature 5 — Rules enforcement consistency

### Problem

The "70%+ prob AND tipped odds 1.50-1.99 (inclusive) AND opposing side >= 5.00" rule is enforced in:

- `server/src/cron/fixtureIngestion.ts:71-87` — ingestion filter (correct).
- `server/src/routes/matches.ts:85-94` — read-time filter for the matches list (correct).

But it is **not** enforced in:

- `server/src/services/predictionEngine.ts:107` — `selectPickOfDay()` picks from `is_value_bet = true` rows and falls back to `confidence >= 0.55` without checking the full rule.
- `server/src/routes/predictions.ts:32-45` — accumulator builder selects from `is_value_bet = true` without the opposing-side check.
- `server/src/utils/expectedValue.ts:23` — `isValueBet()` uses `odds > 1.50` (strict), while `fixtureIngestion.ts:81` and `routes/matches.ts:91` use `< 1.50 || > 1.99` which accepts `1.50` exactly.

**Live evidence:** Today's POTD is `Cercle Brugge vs Raal La Louviere` with home=1.90 / draw=3.45 / **away=3.60**. Tip=1, so opposing = 3.60, far below 5.00. Filtered correctly from `/api/matches` but still returned as POTD because `selectPickOfDay` has no opposing-side enforcement.

**Stale data evidence:** Shanghai Shenhua (tip=1, home=1.50) has `is_value_bet: false` in the DB because `isValueBet()` rejects 1.50, even though both ingestion and matches filters accept it. Its tip badge renders blue (non-value) in the matches list.

### Goal

- Every code path that selects or filters matches uses `qualifiesByOdds` (F2).
- `isValueBet` is deleted (F3).
- The POTD fallback is removed (F4).
- Historical DB rows that do not satisfy the current rules are removed.
- POTDs recorded against non-conforming matches are recomputed, resulting in "no POTD" for some days.

### Approach

**A. Wire `qualifiesByOdds` into every filter site**

1. `fixtureIngestion.ts:71-87` — replace the inline filter with `qualifiesByOdds(tip, f.homeOdds, f.drawOdds, f.awayOdds, maxProb)`. The draw-tip case is already correct in the existing code; the helper just encapsulates it.
2. `routes/matches.ts:85-94` — replace the inline filter with `qualifiesByOdds(m.tip, o.home, o.draw, o.away, Number(m.confidence))`.
3. `services/predictionEngine.ts:57` — `storePrediction` sets `is_value_bet = qualifiesByOdds(tip, home_odds, draw_odds, away_odds, confidence)`.
4. `services/predictionEngine.ts:107` (`selectPickOfDay`):
   - Query candidates as before (`is_value_bet = true` with all three odds in the SELECT).
   - After fetching, apply a JS post-filter: `candidates = candidates.filter(c => qualifiesByOdds(c.tip, Number(c.home_odds), Number(c.draw_odds), Number(c.away_odds), Number(c.confidence)))`.
   - **Remove the `confidence >= 0.55` fallback** (lines 124-143). If no candidates remain, `clearPickOfDay(date)` and return `null`.
5. `routes/predictions.ts:32-45` (accumulator builder) — after the SELECT, apply the same JS post-filter before building combinations.
6. `routes/predictions.ts:128-150` (POTD history) — no additional filter needed here; the POTD history reads already-persisted `is_pick_of_day` flags, which are set by `selectPickOfDay` (now correct). But the SQL should guard against orphan rows: `WHERE p.is_pick_of_day = true AND m.id IS NOT NULL`.

**B. POTD recomputation semantics**

After the code-path fix (A) is merged, `selectPickOfDay` is strict. The cleanup script (C) uses this new strict version when recomputing historical POTDs. Between merging A and running C, the DB still contains stale `is_pick_of_day` flags on non-conforming matches — that's fine, they will be cleared as part of the cleanup.

**C. One-time DB cleanup script**

New file: `server/src/scripts/cleanupNonConformingMatches.ts`.

CLI-only. No HTTP endpoint. Rationale: one-time operation, no reason to expose a destructive trigger on an unauthenticated LAN service. Run as:

```bash
# Dry run first (no writes)
node dist/scripts/cleanupNonConformingMatches.js --dry-run

# Real run (only after reviewing dry-run output and taking a backup)
node dist/scripts/cleanupNonConformingMatches.js
```

**Pre-flight requirements:**

1. The code-path fix (A) is already merged and deployed. `selectPickOfDay` is strict, `isValueBet` is deleted.
2. `pg_dump` backup exists (see Backup & Rollback below).
3. Cron jobs (fixture ingestion, result sync, odds sync) are paused while cleanup runs — to prevent race conditions where a new non-conforming row is inserted mid-transaction.

**Pause cron:** the simplest way is to stop the Node server before running the cleanup, then restart it after. Since the cleanup script connects directly to the DB, it does not need the app server running. The spec's manual test plan includes this step explicitly.

**Script logic:**

```ts
import { getClient } from '../config/database';
import { qualifiesByOdds } from '../utils/qualification';
import * as PredictionModel from '../models/Prediction';
import { selectPickOfDay } from '../services/predictionEngine';

const DRY_RUN = process.argv.includes('--dry-run');

async function main() {
  const client = await getClient();
  try {
    await client.query('BEGIN');
    // Lock tables to block concurrent scrapes (defense in depth, even if cron is paused).
    await client.query('LOCK TABLE matches IN SHARE ROW EXCLUSIVE MODE');

    // Step 1: find every match whose latest odds + prediction does NOT qualify.
    // Matches with no prediction row are SKIPPED (we can't judge them).
    // Matches with no odds row are considered NON-QUALIFYING (cannot assess).
    const res = await client.query(`
      SELECT m.id, m.kickoff AT TIME ZONE 'Africa/Nairobi' AS nairobi_kickoff,
             p.tip, p.confidence,
             oh.home_odds, oh.draw_odds, oh.away_odds
      FROM matches m
      JOIN predictions p ON p.match_id = m.id
      LEFT JOIN LATERAL (
        SELECT home_odds, draw_odds, away_odds
        FROM odds_history
        WHERE match_id = m.id
        ORDER BY scraped_at DESC, id DESC
        LIMIT 1
      ) oh ON true
    `);

    const nonConforming: Array<{ id: number; date: string; reason: string }> = [];
    for (const row of res.rows) {
      const tip = row.tip as '1' | 'X' | '2';
      const ok = qualifiesByOdds(
        tip,
        row.home_odds != null ? Number(row.home_odds) : null,
        row.draw_odds != null ? Number(row.draw_odds) : null,
        row.away_odds != null ? Number(row.away_odds) : null,
        Number(row.confidence),
      );
      if (!ok) {
        const date = row.nairobi_kickoff.toISOString().slice(0, 10);
        const reason = describeNonConformance(row); // small helper, returns "away_odds 3.60 < 5.00" etc.
        nonConforming.push({ id: row.id, date, reason });
      }
    }

    console.log(`Found ${nonConforming.length} non-conforming matches`);
    for (const nc of nonConforming) {
      console.log(`  match_id=${nc.id} date=${nc.date} — ${nc.reason}`);
    }
    const affectedDates = Array.from(new Set(nonConforming.map(n => n.date))).sort();
    console.log(`Affected dates: ${affectedDates.join(', ')}`);

    if (DRY_RUN) {
      console.log('Dry run — no changes committed.');
      await client.query('ROLLBACK');
      return;
    }

    // Step 2: delete the matches. CASCADE handles predictions + odds_history.
    if (nonConforming.length > 0) {
      const ids = nonConforming.map(n => n.id);
      const del = await client.query('DELETE FROM matches WHERE id = ANY($1)', [ids]);
      console.log(`Deleted ${del.rowCount} matches (cascade cleaned predictions + odds_history)`);
    }

    await client.query('COMMIT');

    // Step 3: recompute POTD for affected dates. This happens AFTER the deletion
    // transaction commits, in its own transactional scope (selectPickOfDay uses
    // the shared pool). Each date is independent, so partial failure leaves
    // already-recomputed dates in place.
    for (const date of affectedDates) {
      await PredictionModel.clearPickOfDay(date); // remove stale is_pick_of_day flags
      const result = await selectPickOfDay(date);
      console.log(`  ${date}: ${result ? `new POTD match_id=${result.id}` : 'no POTD'}`);
    }

    console.log('Cleanup complete.');
  } catch (err) {
    console.error('Cleanup failed, rolling back:', err);
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

main().catch(err => { console.error(err); process.exit(1); });
```

**Why delete order uses CASCADE:** `predictions.match_id` and `odds_history.match_id` both have `ON DELETE CASCADE` (verified in `server/src/db/migrations/004_create_predictions.ts:6` and `005_create_odds_history.ts:6`). Deleting the `matches` row automatically cleans up both child tables in one statement. The previous draft's explicit three-step delete was redundant and risked failing on FK constraints if order was wrong.

**Why the POTD recomputation is outside the main transaction:** `selectPickOfDay` is an existing function that uses the shared pool. Wrapping it in the same client transaction would require refactoring its signature to accept a `PoolClient` parameter. For a one-time script, that's over-engineering. The trade-off: if the recomputation crashes partway, some dates won't have recomputed POTDs — but the dates that are done are committed, and re-running the script is safe (idempotent, as no non-conforming rows remain for the second run to delete).

**Observability:**

The script prints to stdout:
- Count of non-conforming matches + list of IDs with reasons (dry-run and real)
- Affected dates list
- Deleted row count
- For each affected date: the new POTD match_id or "no POTD"

User is expected to redirect stdout to a log file for audit:

```bash
node dist/scripts/cleanupNonConformingMatches.js --dry-run 2>&1 | tee cleanup_dryrun_$(date +%Y%m%d_%H%M%S).log
node dist/scripts/cleanupNonConformingMatches.js 2>&1 | tee cleanup_$(date +%Y%m%d_%H%M%S).log
```

### Edge cases documented

- **No prediction row for a match:** skipped by the cleanup query (`JOIN predictions` drops it). Such matches are neither cleaned up nor re-examined. Rationale: they were never selected for display either, so they pose no user-visible consistency risk.
- **No odds row for a match:** treated as non-qualifying. The `qualifiesByOdds` helper returns `false` on any null odds input. These matches are deleted.
- **Odds drift (retroactive policy):** the cleanup uses the latest odds row to assess conformance. A match that was conforming when ingested but whose odds drifted later may be deleted. This is the policy choice — the current rule is the source of truth. Alternative (use earliest odds) is rejected because odds_history can be sparse and the first row isn't always "at ingest".
- **Deterministic "latest":** the `ORDER BY scraped_at DESC, id DESC` secondary sort ensures deterministic row selection when timestamps tie.

### Backup & Rollback

**Before running real cleanup:**

```bash
# From a shell on the DB host (or inside the WSL2 Postgres env):
wsl -u root -e bash -c "PGPASSWORD=football_pass pg_dump -h 127.0.0.1 -U football_app football_predictions > /tmp/football_backup_$(date +%Y%m%d_%H%M%S).sql"
```

For the Docker deployment:

```bash
docker compose exec db pg_dump -U football_app football_predictions > ./backups/football_backup_$(date +%Y%m%d_%H%M%S).sql
```

Expected backup size at current data volume: < 5 MB. Duration: < 5 seconds.

**Rollback if issues are discovered:**

```bash
# Stop the app first
docker compose stop app

# Drop and recreate the DB, then restore
docker compose exec db psql -U football_app -c "DROP DATABASE football_predictions;"
docker compose exec db psql -U football_app -c "CREATE DATABASE football_predictions;"
docker compose exec db psql -U football_app football_predictions < ./backups/football_backup_<timestamp>.sql

# Restart
docker compose start app
```

Retention: keep the backup for 7 days after a successful cleanup.

### React Query cache invalidation after cleanup

Cleanup mutates data that React Query may be caching in an open browser tab. After the cleanup runs, users with open sessions will see stale data until their next refetch (`refetchInterval`). This is acceptable for a rare one-time operation and is documented in the deployment checklist: "After running cleanup, ask any active users to hard-refresh their browsers."

No invalidation endpoint is added — it would be over-engineering for a one-time cleanup.

---

## Shared manual test plan

The repo has no automated tests (`CLAUDE.md`: "There are no tests or linting configured"). Verify manually in this order.

### Pre-flight baseline snapshot (before ANY changes)

Capture a baseline for comparison:

```bash
curl -s 'http://localhost:3001/api/predictions/pick-of-day?date=2026-04-11' > baseline_potd_2026-04-11.json
curl -s 'http://localhost:3001/api/matches?date=2026-04-11' | jq '.matches | length' > baseline_matches_count.txt
curl -s 'http://localhost:3001/api/predictions/accumulators?date=2026-04-11' > baseline_acca.json
curl -s 'http://localhost:3001/api/predictions/potd-history?days=90' > baseline_history.json
```

### Feature 5 — Code-path fixes (before cleanup)

1. **`qualifiesByOdds` helper compiles and runs.** Run `cd server && npx tsc` — no type errors.
2. **`isValueBet` is removed.** Grep `isValueBet` in `server/src/` — only test-related references allowed (none expected).
3. **Today's POTD changes immediately.** After deploying code-path fix (not cleanup yet): `curl /api/predictions/pick-of-day?date=2026-04-11`. Cercle Brugge should no longer be returned (it no longer qualifies). Either a different POTD from the 9 conforming matches, or `null` if none qualify at POTD ranking time.
4. **Shanghai Shenhua tip badge is green.** Load `/2026-04-11` in the browser. Shanghai Shenhua (home=1.50, tip=1) now renders with a green badge (via `is_value_bet = true` on next scrape or after the cleanup's recomputation of existing rows).
5. **Accumulators respect rules.** `curl /api/predictions/accumulators?date=2026-04-11` — every leg of every combo has opposing odds >= 5.00.

### Feature 5 — Cleanup dry-run

6. **Pause cron.** `docker compose stop app` (or stop the dev server).
7. **Take backup.** See "Backup & Rollback" above.
8. **First dry-run.** `node dist/scripts/cleanupNonConformingMatches.js --dry-run` → note total count X and list of match IDs.
9. **Second dry-run.** Run the same command immediately. Output must be IDENTICAL to step 8 — same X, same IDs. This verifies dry-run is non-destructive.
10. **Real run.** `node dist/scripts/cleanupNonConformingMatches.js` → deleted count matches X.
11. **Third dry-run.** Run the dry-run a third time after the real run → expected output: `Found 0 non-conforming matches`. Verifies idempotency.
12. **Orphan check.**
    ```sql
    SELECT COUNT(*) FROM predictions WHERE match_id NOT IN (SELECT id FROM matches);
    SELECT COUNT(*) FROM odds_history WHERE match_id NOT IN (SELECT id FROM matches);
    ```
    Both counts must be 0. CASCADE should have handled this.
13. **Restart app.** `docker compose start app`.

### Feature 5 — Post-cleanup verification

14. **POTD for today.** `curl /api/predictions/pick-of-day?date=2026-04-11` — returns new POTD or null. Compare to `baseline_potd_2026-04-11.json`: different.
15. **Matches count for today.** `curl /api/matches?date=2026-04-11 | jq '.matches | length'` — same as `baseline_matches_count.txt` (today's 9 matches were already conforming).
16. **New POTD satisfies rules.** If not null, manually verify:
    - `confidence >= 0.70`
    - tipped odds in `[1.50, 1.99]`
    - opposing odds >= 5.00
17. **Accumulator conformance.** `curl /api/predictions/accumulators?date=2026-04-11` — every leg satisfies the rules.
18. **POTD history has no gaps worth investigating.** Compare `curl /api/predictions/potd-history?days=90` to `baseline_history.json`. Expected changes: some days that had a POTD may now have none (those days had no qualifying matches after cleanup). Document which days changed for the user.
19. **Fresh scrape reintegration.** `POST /api/trigger/ingest?date=2026-04-11`. Wait 30s. Re-check `/api/matches` — no new non-conforming matches appear.

### Feature 1 — URL routing

20. Visit `/` → redirects to `/2026-04-11` (today in Nairobi). Predictions load.
21. Visit `/2026-04-05` directly → loads Apr 5. URL stays.
22. Refresh on `/2026-04-05` → still Apr 5 (the original bug fix).
23. From `/2026-04-11`, arrow left → `/2026-04-10`. Inspect browser history (devtools) — no new entry.
24. Open a fresh tab, visit `/2026-04-11` directly, arrow left, then click browser back: behavior is whatever the browser does with an empty-ish history stack (may stay on the page, or navigate to previous tab/page). **Not** "exits the app" — that was unverifiable.
25. From `/2026-04-11`, pick `2026-04-05` via native input → `/2026-04-05`. Back button → returns to `/2026-04-11` (push added an entry).
26. From `/2026-04-05`, click "Today" button → `/2026-04-11`. Back button → `/2026-04-05`.
27. Visit `/hello` → NotFound with "not a valid date" message.
28. Visit `/2025-01-01` → NotFound with "pre-launch" message and the 2026-03-16 date.
29. Visit `/2026-02-30` → NotFound (invalid calendar).
30. Visit `/2026-02-29` → NotFound (2026 is not a leap year).
31. Visit `/2028-02-29` → loads (2028 IS a leap year).
32. Visit `/2030-01-01` → loads (future dates allowed).
33. Visit `/foo/bar/baz` → NotFound via `*` route.
34. NotFound "Back to today" button → `/2026-04-11`.
35. `curl /api/health` → 200 OK (API unaffected).
36. `curl 'http://localhost:3001/api/matches?date=2025-01-01'` → 400 response (server-side validation rejects pre-launch).
37. `curl 'http://localhost:3001/api/matches?date=notadate'` → 400 response.

### Feature 2 — Collapsible POTD history

38. Load the page. POTD history card is visible. Global summary bar is visible. **All months are closed.**
39. Click the first (newest) month `<summary>` → expands and shows the table rows for that month.
40. Month summary stats: count, W-L, hit ratio, profit. Manually verify the count against `baseline_history.json` filtered to that month (should match after cleanup adjustments).
41. Expand a second month. Both are open simultaneously.
42. Wait 5+ minutes for `usePotdHistory` to refetch (or trigger by toggling a React Query devtools refetch). Verify: both open months remain open after the refetch. This verifies `<details>` state preservation with `key={month}`.
43. Collapse both months. All groups visible but closed.
44. Refresh the browser → all closed again (no persistence).

### Feature 3 — Collapsible glossary

45. Hard-refresh the page → Glossary card is visible at the bottom. Heading "📚 Glossary" + chevron + "(click to expand)" hint. Terms are NOT visible.
46. Click the heading → terms expand into the 2-column grid.
47. Click again → collapses.
48. DevTools → Local Storage → no glossary key persisted.

### Feature 4 — POTD card full odds

49. Load a date with a valid POTD. Card shows Win Prob | Odds (H/D/A) | EV in three columns.
50. The tipped side's odds cell has gold text and a gold background tint.
51. Any odds in the 1.50-1.99 range have a green background tint.
52. Find (or force via DB tweak) a POTD with one null odds value → that cell renders `-`, other cells render normally.
53. Mobile viewport (DevTools device emulation, iPhone 14) → card stacks, three odds cells are readable.

---

## Risks & open questions

- **Behavioral change: POTD fallback removal.** Users who track win/loss streaks will see discontinuities in POTD history after cleanup. Documented in the test plan; user has approved the design.
- **Historical POTD mutability.** Deletion-based cleanup rewrites history. Immutable alternative (adding a `legacy` flag and filtering) is rejected for simplicity but listed here for user awareness.
- **React Query cache staleness after cleanup.** Users with open tabs see stale data until `refetchInterval` fires (up to 5 minutes). Deployment checklist asks users to hard-refresh.
- **Odds retroactivity.** The cleanup uses latest odds, not odds-at-ingest. A match conforming at display time that later drifts out of range is deleted.
- **Cron pause during cleanup.** The spec requires `docker compose stop app` before running cleanup. This causes a brief outage window (seconds). Acceptable for a one-time operation.
- **`customParseFormat` plugin idempotency.** Calling `dayjs.extend(customParseFormat)` multiple times is a no-op. Safe to import from multiple modules.
- **Arrow-click history UX.** Replace-history behavior is a deliberate trade-off to avoid history spam. The `title` tooltip on arrow buttons signals this.
- **Vite dev proxy.** Already configured for `/api/*`. The plan phase will verify by opening `client/vite.config.ts`.
- **No authentication on the app.** `CLAUDE.md` confirms the LAN-only posture. The spec does not add authentication. The cleanup script is CLI-only (no HTTP endpoint) to avoid expanding the attack surface.

---

## Implementation order

The features are independent but have partial ordering:

**Phase 1 (foundational):** Feature 5 code-path fix only — shared helper `qualifiesByOdds`, delete `isValueBet`, update filter call sites, remove POTD fallback. No data deletion yet. Verify today's POTD changes. This is the correctness fix and must land first.

**Phase 2 (cleanup):** Feature 5 cleanup script. Requires Phase 1 merged and deployed. Pause cron, backup, dry-run ×2, real run, dry-run ×1, verify. Restart cron.

**Phase 3 (POTD card UX):** Feature 4 — full H/D/A odds on the POTD card. Standalone file change in `PickOfDayCard.tsx`.

**Phase 4 (history UX):** Feature 2 — collapsible monthly POTD history.

**Phase 5 (glossary UX):** Feature 3 — collapsible glossary.

**Phase 6 (routing):** Feature 1 — date-in-URL routing. Biggest structural change (adds pages/, new dependencies, restructures App.tsx). Landed last to avoid merge conflicts with the UI changes above.

Each phase is independently reviewable and can be landed as its own PR if desired. The plan phase will make this concrete.
