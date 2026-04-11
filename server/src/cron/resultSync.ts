import dayjs from 'dayjs';
import logger from '../config/logger';
import { query } from '../config/database';
import { fetchFinishedResults, fetchCancelledMatches, fetchSofascoreResults, fetchEspnResults, teamsMatch } from '../services/livescoreFetcher';
import type { LivescoreMatch } from '../services/livescoreFetcher';
import * as MatchModel from '../models/Match';

// Track dates currently being synced to avoid duplicate work
const syncingDates = new Set<string>();

/**
 * Fetch results from livescore (primary) + sofascore (fallback), across adjacent dates.
 */
async function fetchAllResults(utcDate: string): Promise<LivescoreMatch[]> {
  const prevDate = dayjs(utcDate).subtract(1, 'day').format('YYYY-MM-DD');
  const nextDate = dayjs(utcDate).add(1, 'day').format('YYYY-MM-DD');

  const [mainResults, prevResults, nextResults] = await Promise.all([
    fetchFinishedResults(utcDate),
    fetchFinishedResults(prevDate),
    fetchFinishedResults(nextDate),
  ]);

  let results = [...mainResults];
  const seen = new Set(results.map(r => r.homeTeam.toUpperCase()));
  for (const r of [...prevResults, ...nextResults]) {
    if (!seen.has(r.homeTeam.toUpperCase())) {
      results.push(r);
      seen.add(r.homeTeam.toUpperCase());
    }
  }

  // Sofascore fallback
  const [sofaMain, sofaPrev, sofaNext] = await Promise.all([
    fetchSofascoreResults(utcDate),
    fetchSofascoreResults(prevDate),
    fetchSofascoreResults(nextDate),
  ]);
  for (const r of [...sofaMain, ...sofaPrev, ...sofaNext]) {
    if (!seen.has(r.homeTeam.toUpperCase())) {
      results.push(r);
      seen.add(r.homeTeam.toUpperCase());
    }
  }

  // ESPN fallback — covers leagues livescore/sofascore miss (Nigerian NPFL, etc.)
  const [espnMain, espnPrev, espnNext] = await Promise.all([
    fetchEspnResults(utcDate),
    fetchEspnResults(prevDate),
    fetchEspnResults(nextDate),
  ]);
  for (const r of [...espnMain, ...espnPrev, ...espnNext]) {
    if (!seen.has(r.homeTeam.toUpperCase())) {
      results.push(r);
      seen.add(r.homeTeam.toUpperCase());
    }
  }

  return results;
}

/**
 * Try to match a pending match against result sources and update if found.
 * Returns true if updated.
 */
async function tryMatchResult(matchId: number, home: string, away: string, results: LivescoreMatch[]): Promise<boolean> {
  let result = results.find(lr =>
    teamsMatch(home, lr.homeTeam) && teamsMatch(away, lr.awayTeam)
  );
  if (!result) {
    const homeMatches = results.filter(lr => teamsMatch(home, lr.homeTeam));
    if (homeMatches.length === 1) result = homeMatches[0];
  }
  if (result) {
    await query(
      'UPDATE matches SET home_score=$1, away_score=$2, status=$3, updated_at=NOW() WHERE id=$4',
      [result.homeScore, result.awayScore, 'finished', matchId]
    );
    return true;
  }
  return false;
}

/**
 * Sync results for a specific date — called when user opens a past date with pending matches.
 */
export async function syncResultsForDate(date: string) {
  if (syncingDates.has(date)) return;
  syncingDates.add(date);

  try {
    const pending = await query(
      `SELECT m.id, m.kickoff FROM matches m
       WHERE m.status = 'scheduled' AND DATE(m.kickoff AT TIME ZONE 'Africa/Nairobi') = $1`,
      [date]
    );
    if (pending.rows.length === 0) return;

    logger.info(`Auto result sync for ${date}: ${pending.rows.length} pending`);
    const utcDates = new Set(pending.rows.map((m: any) => dayjs(m.kickoff).format('YYYY-MM-DD')));

    for (const utcDate of utcDates) {
      const results = await fetchAllResults(utcDate);
      logger.info(`${results.length} results (livescore+sofascore) for ${utcDate}`);

      for (const m of pending.rows) {
        if (dayjs(m.kickoff).format('YYYY-MM-DD') !== utcDate) continue;
        const res = await query(
          `SELECT ht.name as home, at2.name as away
           FROM matches m JOIN teams ht ON m.home_team_id=ht.id JOIN teams at2 ON m.away_team_id=at2.id
           WHERE m.id=$1`, [m.id]
        );
        if (!res.rows[0]) continue;
        const { home, away } = res.rows[0];

        if (await tryMatchResult(m.id, home, away, results)) {
          logger.info(`Auto result: ${home} vs ${away}`);
        }
      }

      // Check postponed/cancelled
      const cancelled = await fetchCancelledMatches(utcDate);
      for (const m of pending.rows) {
        const res2 = await query(
          `SELECT ht.name as home, at2.name as away
           FROM matches m JOIN teams ht ON m.home_team_id=ht.id JOIN teams at2 ON m.away_team_id=at2.id
           WHERE m.id=$1 AND m.status='scheduled'`, [m.id]
        );
        if (!res2.rows[0]) continue;
        const { home, away } = res2.rows[0];
        const match = cancelled.find(lr =>
          teamsMatch(home, lr.homeTeam) && teamsMatch(away, lr.awayTeam)
        );
        if (match) {
          const status = match.status === 'Postp' ? 'postponed' : 'cancelled';
          await query('UPDATE matches SET status=$1, updated_at=NOW() WHERE id=$2', [status, m.id]);
          logger.info(`${status.toUpperCase()}: ${home} vs ${away}`);
        }
      }
    }
  } catch (error: any) {
    logger.error(`Auto result sync for ${date} failed: ${error.message}`);
  } finally {
    syncingDates.delete(date);
  }
}

export async function syncResults() {
  logger.info('Starting result sync');

  try {
    const pendingMatches = await MatchModel.findPendingResults();
    if (pendingMatches.length === 0) {
      logger.info('No pending results to sync');
      return;
    }

    const byDate = new Map<string, any[]>();
    for (const m of pendingMatches) {
      const date = dayjs(m.kickoff).format('YYYY-MM-DD');
      if (!byDate.has(date)) byDate.set(date, []);
      byDate.get(date)!.push(m);
    }

    let updated = 0;

    for (const [date, matches] of byDate) {
      const results = await fetchAllResults(date);

      if (results.length === 0) continue;
      logger.info(`${results.length} results (livescore+sofascore) for ${date}`);

      for (const m of matches) {
        const res = await query(
          `SELECT ht.name as home, at2.name as away
           FROM matches m JOIN teams ht ON m.home_team_id=ht.id JOIN teams at2 ON m.away_team_id=at2.id
           WHERE m.id=$1`, [m.id]
        );
        if (!res.rows[0]) continue;
        const { home, away } = res.rows[0];

        if (await tryMatchResult(m.id, home, away, results)) {
          updated++;
          logger.info(`Result: ${home} vs ${away}`);
        }
      }

      // Check postponed/cancelled
      const cancelled = await fetchCancelledMatches(date);
      for (const m of matches) {
        const res2 = await query(
          `SELECT ht.name as home, at2.name as away
           FROM matches m JOIN teams ht ON m.home_team_id=ht.id JOIN teams at2 ON m.away_team_id=at2.id
           WHERE m.id=$1 AND m.status='scheduled'`, [m.id]
        );
        if (!res2.rows[0]) continue;
        const { home, away } = res2.rows[0];
        const match = cancelled.find(lr =>
          teamsMatch(home, lr.homeTeam) && teamsMatch(away, lr.awayTeam)
        );
        if (match) {
          const status = match.status === 'Postp' ? 'postponed' : 'cancelled';
          await query('UPDATE matches SET status=$1, updated_at=NOW() WHERE id=$2', [status, m.id]);
          updated++;
          logger.info(`${status.toUpperCase()}: ${home} vs ${away}`);
        }
      }
    }

    logger.info(`Result sync complete: ${updated} updated`);

    // Auto-cancel phantom fixtures: scheduled matches 48+ hours past kickoff
    // with no result on any source are likely false ingestions from prosoccer.gr
    const stale = await query(
      `UPDATE matches SET status='cancelled', updated_at=NOW()
       WHERE status='scheduled' AND kickoff < NOW() - INTERVAL '48 hours'
       RETURNING id`
    );
    if ((stale.rowCount ?? 0) > 0) {
      logger.info(`Auto-cancelled ${stale.rowCount} stale phantom fixture(s)`);
    }
  } catch (error: any) {
    logger.error(`Result sync failed: ${error.message}`);
  }
}
