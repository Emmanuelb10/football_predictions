import dayjs from 'dayjs';
import logger from '../config/logger';
import { query } from '../config/database';
import { fetchFinishedResults, fetchCancelledMatches, fetchSofascoreResults, fetchEspnResults, teamsMatch, teamsStrongMatch } from '../services/livescoreFetcher';
import type { LivescoreMatch } from '../services/livescoreFetcher';
import { canVerifyProsoccerResult, scrapeFixtures } from '../services/fixtureScraper';
import { scrapeZulubet } from '../services/zulubetScraper';
import { fetchFlashscoreResults } from '../services/flashscoreFetcher';
import { fetchBbcResults } from '../services/bbcFetcher';
import { fetch365ScoresResults } from '../services/scores365Fetcher';
import * as MatchModel from '../models/Match';

// Track dates currently being synced to avoid duplicate work
const syncingDates = new Set<string>();

/**
 * Fetch results from BBC Sport (authoritative) and fallback providers across adjacent dates.
 */
export async function fetchAllResults(utcDate: string): Promise<LivescoreMatch[]> {
  const prevDate = dayjs(utcDate).subtract(1, 'day').format('YYYY-MM-DD');
  const nextDate = dayjs(utcDate).add(1, 'day').format('YYYY-MM-DD');
  // Start the web fallbacks immediately; a slow or unavailable API must not
  // delay the sources we are using in the meantime.
  const webResultsPromise = Promise.all([
    canVerifyProsoccerResult(utcDate) ? scrapeFixtures(utcDate) : Promise.resolve([]),
    scrapeZulubet(utcDate),
  ]);

  const [bbcMain, bbcPrev, bbcNext, mainResults, prevResults, nextResults] = await Promise.all([
    fetchBbcResults(utcDate),
    fetchBbcResults(prevDate),
    fetchBbcResults(nextDate),
    fetchFinishedResults(utcDate),
    fetchFinishedResults(prevDate),
    fetchFinishedResults(nextDate),
  ]);

  // Keep the source/date of every result.  The old de-duplication used only
  // team names, so a same-named fixture on an adjacent date could win by order.
  let results: LivescoreMatch[] = [
    ...bbcMain.map(r => ({ ...r, resultDate: utcDate, source: 'bbc' as const })),
    ...bbcPrev.map(r => ({ ...r, resultDate: prevDate, source: 'bbc' as const })),
    ...bbcNext.map(r => ({ ...r, resultDate: nextDate, source: 'bbc' as const })),
    ...mainResults.map(r => ({ ...r, resultDate: utcDate, source: 'livescore' as const })),
    ...prevResults.map(r => ({ ...r, resultDate: prevDate, source: 'livescore' as const })),
    ...nextResults.map(r => ({ ...r, resultDate: nextDate, source: 'livescore' as const })),
  ];

  // Sofascore fallback
  const [sofaMain, sofaPrev, sofaNext] = await Promise.all([
    fetchSofascoreResults(utcDate),
    fetchSofascoreResults(prevDate),
    fetchSofascoreResults(nextDate),
  ]);
  results.push(
    ...sofaMain.map(r => ({ ...r, resultDate: utcDate, source: 'sofascore' as const })),
    ...sofaPrev.map(r => ({ ...r, resultDate: prevDate, source: 'sofascore' as const })),
    ...sofaNext.map(r => ({ ...r, resultDate: nextDate, source: 'sofascore' as const })),
  );

  // 365Scores extends coverage to leagues that are not consistently listed by
  // BBC Sport or ESPN, including Argentina's Primera Nacional.
  const [scores365Main, scores365Prev, scores365Next] = await Promise.all([
    fetch365ScoresResults(utcDate),
    fetch365ScoresResults(prevDate),
    fetch365ScoresResults(nextDate),
  ]);
  results.push(
    ...scores365Main.map(r => ({ ...r, resultDate: utcDate, source: 'scores365' as const })),
    ...scores365Prev.map(r => ({ ...r, resultDate: prevDate, source: 'scores365' as const })),
    ...scores365Next.map(r => ({ ...r, resultDate: nextDate, source: 'scores365' as const })),
  );

  // Flashscore Kenya provides an independent, broad-coverage score feed.
  // As with the other APIs, adjacent dates cover timezone-boundary kickoffs.
  const [flashMain, flashPrev, flashNext] = await Promise.all([
    fetchFlashscoreResults(utcDate),
    fetchFlashscoreResults(prevDate),
    fetchFlashscoreResults(nextDate),
  ]);
  results.push(
    ...flashMain.map(r => ({ ...r, resultDate: utcDate, source: 'flashscore' as const })),
    ...flashPrev.map(r => ({ ...r, resultDate: prevDate, source: 'flashscore' as const })),
    ...flashNext.map(r => ({ ...r, resultDate: nextDate, source: 'flashscore' as const })),
  );

  // ESPN fallback — covers leagues livescore/sofascore miss (Nigerian NPFL, etc.)
  const [espnMain, espnPrev, espnNext] = await Promise.all([
    fetchEspnResults(utcDate),
    fetchEspnResults(prevDate),
    fetchEspnResults(nextDate),
  ]);
  results.push(
    ...espnMain.map(r => ({ ...r, resultDate: utcDate, source: 'espn' as const })),
    ...espnPrev.map(r => ({ ...r, resultDate: prevDate, source: 'espn' as const })),
    ...espnNext.map(r => ({ ...r, resultDate: nextDate, source: 'espn' as const })),
  );

  // These HTML sources are useful when the JSON score providers are
  // unavailable.  Keep them on their requested date only: unlike the APIs,
  // an adjacent weekday page is not a reliable historical-date fallback.
  const [prosoccer, zulubet] = await webResultsPromise;
  for (const fixture of prosoccer) {
    if (fixture.status === 'finished' && fixture.homeScore != null && fixture.awayScore != null) {
      results.push({
        homeTeam: fixture.homeTeam, awayTeam: fixture.awayTeam,
        homeScore: fixture.homeScore, awayScore: fixture.awayScore,
        league: fixture.league, status: 'FT', kickoff: fixture.kickoff,
        resultDate: utcDate, source: 'prosoccer',
      });
    }
  }
  for (const fixture of zulubet) {
    if (fixture.status === 'finished' && fixture.homeScore != null && fixture.awayScore != null) {
      results.push({
        homeTeam: fixture.homeTeam, awayTeam: fixture.awayTeam,
        homeScore: fixture.homeScore, awayScore: fixture.awayScore,
        league: fixture.league, status: 'FT', kickoff: fixture.kickoff,
        resultDate: utcDate, source: 'zulubet',
      });
    }
  }

  return results;
}

export function selectResultForMatch(home: string, away: string, results: LivescoreMatch[], expectedDate?: string): LivescoreMatch | null {
  const allCandidates = results.filter(lr =>
    Number.isInteger(lr.homeScore) && lr.homeScore >= 0 &&
    Number.isInteger(lr.awayScore) && lr.awayScore >= 0 &&
    teamsStrongMatch(home, lr.homeTeam) && teamsStrongMatch(away, lr.awayTeam)
  );
  // Adjacent-day data is a timezone fallback only.  Prefer the provider's
  // requested date whenever it has a candidate, preventing a repeated fixture
  // on the previous/next day from being selected.
  const candidates = expectedDate && allCandidates.some(r => r.resultDate === expectedDate)
    ? allCandidates.filter(r => r.resultDate === expectedDate)
    : allCandidates;
  if (candidates.length === 0) return null;
  // BBC Sport is the score authority.  Once BBC has an exact fixture match,
  // accept its final score even if a fallback provider is stale or incorrect.
  const bbcCandidates = candidates.filter(result => result.source === 'bbc');
  if (bbcCandidates.length > 0) {
    const bbcScores = new Set(bbcCandidates.map(result => `${result.homeScore}:${result.awayScore}`));
    return bbcScores.size === 1 ? bbcCandidates[0] : null;
  }
  const scores = new Set(candidates.map(r => `${r.homeScore}:${r.awayScore}`));
  // Never commit a score when multiple equally-named candidates disagree.
  return scores.size === 1 ? candidates[0] : null;
}

/**
 * Return a correction only when the candidate is a complete, unambiguous
 * fixture match.  Finished rows are never re-scored merely because another
 * game shares one team name.
 */
export function selectVerifiedCorrection(
  home: string,
  away: string,
  currentHomeScore: number,
  currentAwayScore: number,
  results: LivescoreMatch[],
  expectedDate: string,
): LivescoreMatch | null {
  const verified = selectResultForMatch(home, away, results, expectedDate);
  if (!verified) return null;
  return verified.homeScore === currentHomeScore && verified.awayScore === currentAwayScore
    ? null
    : verified;
}

/**
 * Try to match a pending match against result sources and update if found.
 * Returns true if updated.
 */
async function tryMatchResult(matchId: number, home: string, away: string, results: LivescoreMatch[], expectedDate: string): Promise<boolean> {
  const result = selectResultForMatch(home, away, results, expectedDate);
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
      logger.info(`${results.length} independently sourced results for ${utcDate}`);

      for (const m of pending.rows) {
        if (dayjs(m.kickoff).format('YYYY-MM-DD') !== utcDate) continue;
        const res = await query(
          `SELECT ht.name as home, at2.name as away
           FROM matches m JOIN teams ht ON m.home_team_id=ht.id JOIN teams at2 ON m.away_team_id=at2.id
           WHERE m.id=$1`, [m.id]
        );
        if (!res.rows[0]) continue;
        const { home, away } = res.rows[0];

        if (await tryMatchResult(m.id, home, away, results, utcDate)) {
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
    // Providers occasionally correct a score after initially publishing it.
    // Reconcile a bounded recent window on every run, while older history is
    // covered by the explicit audit command.
    const recentlyFinished = await MatchModel.findRecentlyFinishedResults();
    const matchesToCheck = [...pendingMatches, ...recentlyFinished];
    if (matchesToCheck.length === 0) {
      logger.info('No pending results to sync');
      return;
    }

    const byDate = new Map<string, any[]>();
    for (const m of matchesToCheck) {
      const date = dayjs(m.kickoff).format('YYYY-MM-DD');
      if (!byDate.has(date)) byDate.set(date, []);
      byDate.get(date)!.push(m);
    }

    let updated = 0;

    for (const [date, matches] of byDate) {
      const results = await fetchAllResults(date);
      if (results.length === 0) continue;
      logger.info(`${results.length} independently sourced results for ${date}`);

      for (const m of matches) {
        const res = await query(
          `SELECT ht.name as home, at2.name as away
           FROM matches m JOIN teams ht ON m.home_team_id=ht.id JOIN teams at2 ON m.away_team_id=at2.id
           WHERE m.id=$1`, [m.id]
        );
        if (!res.rows[0]) continue;
        const { home, away } = res.rows[0];

        if (m.status === 'finished') {
          const correction = selectVerifiedCorrection(
            home, away, m.home_score, m.away_score, results, date,
          );
          if (correction) {
            await MatchModel.updateResult(m.id, correction.homeScore, correction.awayScore, 'finished');
            updated++;
            logger.info(`Corrected result: ${home} ${correction.homeScore}-${correction.awayScore} ${away}`);
          }
          continue;
        }

        if (await tryMatchResult(m.id, home, away, results, date)) {
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
