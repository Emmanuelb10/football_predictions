# EV Pick of the Day — Design Spec

## Overview

A second daily pick alongside the existing POTD, selected purely by highest Expected Value (EV > 20%). Includes a daily card and a history table, both styled with blue/indigo accent to distinguish from the gold POTD.

## Selection Criteria

- Same candidate pool as POTD: must pass `qualifiesByOdds()` (70%+ confidence, tipped odds 1.50-1.99, opposing-side odds >= 5.00)
- Additional filter: `expected_value >= 0.20` (EV > 20%)
- Winner: highest `expected_value`, tiebreak by confidence descending
- A match CAN be both POTD and EV Pick simultaneously

## Database

**Migration:** Add `is_ev_pick BOOLEAN DEFAULT FALSE` to `predictions` table.

No new tables. The `is_ev_pick` column mirrors the existing `is_pick_of_day` pattern.

## Backend

### Selection Logic (`predictionEngine.ts`)

New function `selectEvPick(date: string)`:
1. Fetch all predictions for the date
2. Post-filter through `qualifiesByOdds()`
3. Filter to `expected_value >= 0.20`
4. Sort by `expected_value` descending, tiebreak by `confidence` descending
5. Clear all `is_ev_pick` flags for the date
6. If candidates exist, set `is_ev_pick = true` on the winner and generate reasoning (same template as POTD but emphasizing EV percentage as the selection rationale)
7. Called alongside `selectPickOfDay()` in the prediction pipeline

### Model (`Prediction.ts`)

New function `findEvPick(date: string)`:
- Same query pattern as `findPickOfDay()` but filters `WHERE p.is_ev_pick = true`

### Routes (`predictions.ts`)

- `GET /predictions/ev-pick?date=` — returns `{ date, pick: {...} | null }`
- `GET /predictions/ev-pick-history?days=30` — returns `{ history: [...], summary: {...} }`
  - Same outcome/profit calculation logic as `/potd-history`
  - Outcome: won/lost/pending based on match result vs tip
  - Profit: `(odds - 1)` for wins, `-1` for losses, `0` for pending

## Frontend

### New Components

**`EvPickCard.tsx`** — replica of `PickOfDayCard.tsx`:
- Blue/indigo accent (border, badge) instead of gold/amber
- Badge text: "EV Pick of the Day"
- Shows: teams, tournament, kickoff time (Africa/Nairobi), confidence, EV, odds (H/D/A)
- When finished: score with green checkmark (won) or red X (lost)
- Reasoning text from prediction

**`EvPickHistory.tsx`** — replica of `PotdHistory.tsx`:
- Blue/indigo accent colors
- Header: "EV Pick History"
- Martingale staking: KSh 1,000 base, 3x multiplier on loss
- Month-grouped collapsible `<details>` accordions
- Table columns: Date, Time, Match, League, Tip, Odds, EV, Score, Result, Stake, P&L, Balance
- Same color coding: green (won), red (lost), amber (PPD), gray (CAN)
- Summary stats: total/settled picks, wins/losses, hit ratio, total P/L

### Hooks (`useMatches.ts`)

- `useEvPick(date)` — query key `['ev-pick', date]`, fetches `/predictions/ev-pick?date=`
- `useEvPickHistory()` — query key `['ev-pick-history']`, fetches `/predictions/ev-pick-history?days=30`, refetch every 5 min

### API Client (`client.ts`)

- `fetchEvPick(date: string)` — `GET /predictions/ev-pick?date=`
- `fetchEvPickHistory(days: number)` — `GET /predictions/ev-pick-history?days=`

### Page Layout (`PredictionsPage.tsx`)

- EV Pick card placed directly below the POTD card
- EV Pick History table placed below the POTD History table

## Not In Scope

- No changes to existing POTD logic or display
- No new staking models (reuses Martingale)
- No new database tables
