# Date-in-URL Routing — Design

**Date:** 2026-04-11
**Status:** Approved (pending implementation)

## Problem

Selecting a past or future date in the date picker does not survive page refresh. `client/src/App.tsx:14` initializes state via `useState(dayjs().format('YYYY-MM-DD'))`, so a reload always snaps back to today. Users cannot bookmark or share a specific day's predictions.

## Goal

Persist the currently-viewed date in the URL path so that:

1. Refreshing the page preserves the date.
2. Copying the address bar shares a direct link to that date.
3. Browser back/forward navigates between viewed dates sensibly.
4. Invalid or out-of-range dates show a clear error instead of silently falling back to today.

## Non-goals

- Multi-page routing. The app has one view; this spec does not introduce additional routes beyond the date page, the root redirect, and a catch-all 404.
- Server-side URL handling beyond what already exists. The Express catch-all in `server/src/index.ts:26` already serves `index.html` for any non-API path.
- Changing API routes. Everything under `/api/*` is unchanged.

## Approach

Use `react-router-dom@^6` for client-side routing. The app is small enough that a router is not strictly necessary, but the user chose this approach for clarity and familiarity over a hand-rolled `history.pushState` hook.

## Architecture

Three routes defined in `App.tsx`:

| Path | Behavior |
|---|---|
| `/` | `<Navigate to="/{today}" replace />` — rewrites URL to today's date |
| `/:date` | `<PredictionsPage />` — validates the param, renders the app or `<NotFound />` |
| `*` | `<NotFound />` — structurally-broken paths |

`<BrowserRouter>` wraps the provider tree in `main.tsx`. The Express server needs no changes — the existing catch-all already serves `index.html` for any path, and API routes are namespaced under `/api/*`.

## Components

### New files

**`client/src/pages/PredictionsPage.tsx`**
Holds all the content currently in `App.tsx` body (header, DatePicker, PickOfDayCard, MatchTable, DailyPLBanner, AccumulatorCard, PotdHistory, Glossary). Reads `date` from `useParams()`. If `isValidDateParam(date)` returns false, renders `<NotFound invalidPath={date} />` directly instead of the page body. Otherwise, passes the validated `date` to all child hooks and components exactly as `App.tsx` does today.

**`client/src/pages/NotFound.tsx`**
A simple centered card: "Invalid or out-of-range date" + the offending URL fragment + a "Back to today" button that calls `navigate('/{today}')`. Styled with the existing `var(--bg-*)` and `var(--accent-blue)` tokens to match the rest of the app.

**`client/src/lib/routing.ts`**
Exports:
- `LAUNCH_DATE = '2026-03-16'` (moved from `DatePicker.tsx`, re-imported there)
- `isValidDateParam(str: string): boolean` — returns true only if all of:
  - Matches `/^\d{4}-\d{2}-\d{2}$/`
  - `dayjs(str, 'YYYY-MM-DD', true).isValid()` (strict parse, requires `customParseFormat` plugin)
  - `str >= LAUNCH_DATE`
- `todayPath(): string` — returns `/` + `dayjs().format('YYYY-MM-DD')`

### Changed files

**`client/src/main.tsx`**
Wrap the provider tree in `<BrowserRouter>`:
```tsx
<BrowserRouter>
  <QueryClientProvider client={queryClient}>
    <ToastProvider>
      <App />
    </ToastProvider>
  </QueryClientProvider>
</BrowserRouter>
```

**`client/src/App.tsx`**
Becomes a thin routing shell (~15 lines):
```tsx
import { Routes, Route, Navigate } from 'react-router-dom';
import PredictionsPage from './pages/PredictionsPage';
import NotFound from './pages/NotFound';
import { todayPath } from './lib/routing';

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<Navigate to={todayPath()} replace />} />
      <Route path="/:date" element={<PredictionsPage />} />
      <Route path="*" element={<NotFound />} />
    </Routes>
  );
}
```

**`client/src/components/DatePicker.tsx`**
Props change from:
```ts
interface DatePickerProps {
  date: string;
  onChange: (date: string) => void;
}
```
to:
```ts
interface DatePickerProps {
  date: string;
  onArrowChange: (date: string) => void;  // prev/next buttons — replace history
  onPickerChange: (date: string) => void; // native date input + Today button — push history
}
```
- `prev()` and `next()` → `onArrowChange(...)`
- Native `<input type="date">` onChange → `onPickerChange(...)`
- `today()` button → `onPickerChange(...)`

`LAUNCH_DATE` import moves from the local constant to `from '../lib/routing'`.

## Data flow

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

## Validation

`isValidDateParam(str)` must return false for any of:
- Non-matching format (`hello`, `2026-4-11`, `2026/04/11`)
- Invalid calendar date (`2026-02-30`, `2026-13-01`)
- Dates before `2026-03-16` (launch)

No upper bound on future dates — matches the existing DatePicker, which lets users browse arbitrarily far ahead.

`PredictionsPage` validates inline and conditionally renders `<NotFound />` instead of the page body, passing the offending `date` param so the error page can display it.

## Dependencies

Add `react-router-dom@^6` to `client/package.json`. No other new dependencies.

`dayjs` already ships with the app; strict date parsing requires the `customParseFormat` plugin:
```ts
import dayjs from 'dayjs';
import customParseFormat from 'dayjs/plugin/customParseFormat';
dayjs.extend(customParseFormat);
```
This is done once in `lib/routing.ts` on import.

## Error handling

- Invalid URL date → inline `<NotFound />` render inside `PredictionsPage`.
- Valid date but no match data → existing empty state in `MatchTable` (unchanged).
- Network errors loading matches → existing React Query error states (unchanged).
- `NotFound` has a "Back to today" button that calls `navigate(todayPath())` so users never get stuck.

## Manual test plan

The repo has no automated tests (`CLAUDE.md`: "There are no tests or linting configured"). Verify manually after implementation:

1. Visit `/` → redirects to `/2026-04-11`, predictions for today load.
2. Visit `/2026-04-05` directly → loads Apr 5 predictions, URL stays as `/2026-04-05`.
3. Refresh on `/2026-04-05` → still shows Apr 5, URL unchanged. (Original bug fix verified.)
4. From `/2026-04-11`, click arrow left → URL becomes `/2026-04-10`, data changes.
5. From `/2026-04-10`, click browser back → exits the app (no history entry from step 4).
6. From `/2026-04-11`, pick `2026-04-05` via native date input → URL becomes `/2026-04-05`.
7. Click browser back → returns to `/2026-04-11` (history entry exists).
8. From `/2026-04-05`, click "Today" button → URL becomes `/2026-04-11`.
9. Click browser back → returns to `/2026-04-05`.
10. Visit `/hello` → NotFound page displays "hello" as the bad fragment.
11. Visit `/2025-01-01` → NotFound page (pre-launch).
12. Visit `/2026-02-30` → NotFound page (invalid calendar date).
13. Visit `/2030-01-01` → loads (future dates allowed).
14. From NotFound, click "Back to today" → URL becomes `/2026-04-11`.
15. `/api/health` still returns 200 OK (API routes unaffected).
16. `/api/matches?date=2026-04-05` still returns data (API routes unaffected).

## Risks & open questions

- **Bundle size:** `react-router-dom@^6` adds ~10KB gzipped. Acceptable per user's explicit preference.
- **`customParseFormat` plugin:** must be loaded once at app start before any `dayjs(..., format, strict)` call. Loading it in `lib/routing.ts` ensures it runs before any route code.
- **Deep refresh on a page proxied via Vite dev server (`npm run dev`, port 3000):** Vite dev server also serves `index.html` for unknown paths by default, so `/2026-04-05` works in dev. No extra Vite config needed.
- **Docker production build:** Express catch-all already handles any path. No compose or Dockerfile changes.
