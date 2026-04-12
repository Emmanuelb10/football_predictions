import axios from 'axios';
import logger from '../config/logger';

export interface LivescoreMatch {
  homeTeam: string;
  awayTeam: string;
  homeScore: number;
  awayScore: number;
  league: string;
  status: string;
  kickoff: string;
}

/**
 * Fetch all match results from livescore.com for a specific date.
 */
export async function fetchLivescores(date: string): Promise<LivescoreMatch[]> {
  try {
    const dateCompact = date.replace(/-/g, '');
    const url = `https://prod-cdn-public-api.livescore.com/v1/api/app/date/soccer/${dateCompact}/1?MD=1`;

    const { data } = await axios.get(url, {
      timeout: 15000,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept': 'application/json',
      },
    });

    const matches: LivescoreMatch[] = [];
    for (const stage of (data.Stages || [])) {
      const league = stage.CompN || stage.Snm || 'Unknown';
      for (const evt of (stage.Events || [])) {
        const homeTeam = evt.T1?.[0]?.Nm || '';
        const awayTeam = evt.T2?.[0]?.Nm || '';
        if (!homeTeam || !awayTeam) continue;

        const esd = evt.Esd || '';
        const kickoff = esd.length >= 12 ? `${esd.substring(8, 10)}:${esd.substring(10, 12)}` : '00:00';

        matches.push({
          homeTeam,
          awayTeam,
          homeScore: parseInt(evt.Tr1) || 0,
          awayScore: parseInt(evt.Tr2) || 0,
          league,
          status: evt.Eps || '',
          kickoff,
        });
      }
    }

    logger.info(`Livescore.com: ${matches.length} matches for ${date}`);
    return matches;
  } catch (error: any) {
    logger.error(`Livescore.com fetch failed: ${error.message}`);
    return [];
  }
}

// Major leagues to include from livescore (case-insensitive substring match).
// Note: Generic terms like 'premier league' and 'super league' may match non-target
// countries (e.g., Kazakhstan, South Africa). This is an accepted trade-off — extra
// matches simply receive AI predictions and don't harm accuracy.
const TARGET_LEAGUES = [
  'premier league', 'la liga', 'serie a', 'serie b', 'bundesliga', 'ligue 1', 'ligue 2',
  'championship', 'league one', 'league two',
  'champions league', 'europa league', 'conference league',
  'eredivisie', 'primeira liga', 'liga portugal', 'super lig',
  'scottish premiership', 'scottish championship',
  'pro league', 'super league', 'ekstraklasa',
  'a-league', 'k league', 'liga betplay', 'liga profesional',
  'copa libertadores', 'copa sudamericana',
  'fa cup', 'copa del rey', 'coppa italia', 'dfb pokal', 'coupe de france',
  'nations league', 'world cup', 'euro 202',
  'mls',
];

function isTargetLeague(league: string): boolean {
  const lower = league.toLowerCase();
  return TARGET_LEAGUES.some(t => lower.includes(t));
}

/**
 * Fetch scheduled (upcoming) matches from livescore.com for fixture ingestion.
 * Filters to major leagues only (livescore returns 700-900 matches globally).
 */
export async function fetchScheduledFixtures(date: string): Promise<LivescoreMatch[]> {
  const all = await fetchLivescores(date);
  const scheduled = all.filter(m =>
    !['FT', 'AET', 'AP', 'Pen', 'Canc', 'Postp', 'Abn'].includes(m.status) &&
    isTargetLeague(m.league)
  );
  logger.info(`Livescore scheduled: ${scheduled.length}/${all.length} matches in target leagues for ${date}`);
  return scheduled;
}

/**
 * Get only finished matches from livescore.com.
 */
export async function fetchFinishedResults(date: string): Promise<LivescoreMatch[]> {
  const all = await fetchLivescores(date);
  return all.filter(m => ['FT', 'AET', 'AP', 'Pen'].includes(m.status));
}

/**
 * Get postponed/cancelled/abandoned matches from livescore.com.
 */
export async function fetchCancelledMatches(date: string): Promise<LivescoreMatch[]> {
  const all = await fetchLivescores(date);
  return all.filter(m => ['Postp', 'Canc', 'Abn'].includes(m.status));
}

/**
 * Fetch finished results from sofascore API as a secondary source.
 */
export async function fetchSofascoreResults(date: string): Promise<LivescoreMatch[]> {
  try {
    const url = `https://api.sofascore.com/api/v1/sport/football/scheduled-events/${date}`;
    const { data } = await axios.get(url, {
      timeout: 15000,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept': 'application/json',
      },
    });

    const matches: LivescoreMatch[] = [];
    for (const evt of (data.events || [])) {
      if (evt.status?.type !== 'finished') continue;
      matches.push({
        homeTeam: evt.homeTeam?.name || '',
        awayTeam: evt.awayTeam?.name || '',
        homeScore: evt.homeScore?.current ?? 0,
        awayScore: evt.awayScore?.current ?? 0,
        league: evt.tournament?.name || '',
        status: 'FT',
        kickoff: '',
      });
    }

    logger.info(`Sofascore: ${matches.length} finished matches for ${date}`);
    return matches;
  } catch (error: any) {
    logger.warn(`Sofascore fetch failed: ${error.message}`);
    return [];
  }
}

/**
 * Fetch ALL matches from ESPN API (scheduled + finished) for verification.
 * Used to confirm a match truly exists on a given date before ingesting.
 */
export async function fetchEspnAllMatches(date: string): Promise<LivescoreMatch[]> {
  try {
    const dateCompact = date.replace(/-/g, '');
    const url = `https://site.api.espn.com/apis/site/v2/sports/soccer/all/scoreboard?dates=${dateCompact}&limit=500`;
    const { data } = await axios.get(url, {
      timeout: 15000,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept': 'application/json',
      },
    });

    const matches: LivescoreMatch[] = [];
    for (const evt of (data.events || [])) {
      const comp = evt.competitions?.[0];
      if (!comp) continue;

      const home = comp.competitors?.find((c: any) => c.homeAway === 'home');
      const away = comp.competitors?.find((c: any) => c.homeAway === 'away');
      if (!home?.team?.name || !away?.team?.name) continue;

      matches.push({
        homeTeam: home.team.displayName || home.team.name,
        awayTeam: away.team.displayName || away.team.name,
        homeScore: parseInt(home.score) || 0,
        awayScore: parseInt(away.score) || 0,
        league: evt.season?.slug || '',
        status: comp.status?.type?.name || '',
        kickoff: '',
      });
    }

    logger.info(`ESPN (all): ${matches.length} matches for ${date}`);
    return matches;
  } catch (error: any) {
    logger.warn(`ESPN fetch failed: ${error.message}`);
    return [];
  }
}

/**
 * Fetch finished results from ESPN API as a third source for result sync.
 */
export async function fetchEspnResults(date: string): Promise<LivescoreMatch[]> {
  try {
    const dateCompact = date.replace(/-/g, '');
    const url = `https://site.api.espn.com/apis/site/v2/sports/soccer/all/scoreboard?dates=${dateCompact}&limit=500`;
    const { data } = await axios.get(url, {
      timeout: 15000,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept': 'application/json',
      },
    });

    const matches: LivescoreMatch[] = [];
    for (const evt of (data.events || [])) {
      const comp = evt.competitions?.[0];
      if (!comp) continue;
      const statusName = comp.status?.type?.name || '';
      if (!statusName.includes('FULL_TIME') && !statusName.includes('FINAL')) continue;

      const home = comp.competitors?.find((c: any) => c.homeAway === 'home');
      const away = comp.competitors?.find((c: any) => c.homeAway === 'away');
      if (!home?.team?.name || !away?.team?.name) continue;

      matches.push({
        homeTeam: home.team.displayName || home.team.name,
        awayTeam: away.team.displayName || away.team.name,
        homeScore: parseInt(home.score) || 0,
        awayScore: parseInt(away.score) || 0,
        league: evt.season?.slug || '',
        status: 'FT',
        kickoff: '',
      });
    }

    logger.info(`ESPN: ${matches.length} finished matches for ${date}`);
    return matches;
  } catch (error: any) {
    logger.warn(`ESPN fetch failed: ${error.message}`);
    return [];
  }
}

// Common transliteration aliases (scraper name → livescore name)
const TEAM_ALIASES: Record<string, string[]> = {
  'SACHTOR': ['SHAKHTAR'],
  'SHAKHTAR': ['SACHTOR'],
  'BAYERN MUNCHEN': ['BAYERN MUNICH'],
  'BAYERN MUNICH': ['BAYERN MUNCHEN'],
  'BORUSSIA DORTMU': ['BORUSSIA DORTMUND'],
  'ATLETICO': ['ATLETICO', 'ATHLETICO'],
  'ATHLETICO': ['ATLETICO'],
  'DYNAMO': ['DINAMO'],
  'DINAMO': ['DYNAMO'],
  'CSKA': ['PFC CSKA'],
  'LOKOMOTIV': ['LOKOMOTIVA'],
  'LOKOMOTIVA': ['LOKOMOTIV'],
  'MONCHENGLADBACH': ['MOENCHENGLADBACH', "M'GLADBACH"],
  'MIAMI': ['INTER MIAMI'],
  'INTER MIAMI': ['MIAMI'],
  'SPORTING KC': ['SPORTING KANSAS'],
  'SPORTING KANSAS': ['SPORTING KC'],
  'NY RED BULLS': ['NEW YORK RED BULLS'],
  'LA GALAXY': ['LOS ANGELES GALAXY'],
  'PHILADELPHIA': ['PHILADELPHIA UNION'],
  'COLUMBUS': ['COLUMBUS CREW'],
  'MINNESOTA': ['MINNESOTA UNITED'],
  'NASHVILLE': ['NASHVILLE SC'],
  'LYON': ['OLYMPIQUE LYONNAIS', 'OL'],
  'OLYMPIQUE LYONNAIS': ['LYON'],
  'MARSEILLE': ['OLYMPIQUE MARSEILLE', 'OLYMPIQUE DE MARSEILLE', 'OM'],
  'OLYMPIQUE MARSEILLE': ['MARSEILLE'],
  'PARIS': ['PARIS SAINT-GERMAIN', 'PSG'],
  'PARIS SAINT-GERMAIN': ['PARIS', 'PSG'],
  'NIGER TORNADOES': ['NIGER TORNADOES FC'],
  'DUNAJSKA': ['DAC DUNAJSKA STREDA', 'DUNAJSKA STREDA', 'DAC 1904'],
  'MICHALOVCE': ['MFK ZEMPLIN MICHALOVCE', 'ZEMPLIN MICHALOVCE'],
};

/**
 * Fuzzy match team names. Strips suffixes, handles transliteration aliases.
 */
export function teamsMatch(dbName: string, liveName: string): boolean {
  const normalize = (s: string) => s.toUpperCase()
    .replace(/\b(FC|CF|SC|SK|FK|AC|AS|SS|CD|UD|RC|US|SD|CA|SE|CE|AD)\b/g, '')
    .replace(/\d+/g, '')
    .replace(/[^A-Z ]/g, '')
    .trim()
    .split(/\s+/)
    .filter(w => w.length > 1);

  const aWords = normalize(dbName);
  const bWords = normalize(liveName);

  if (aWords.length === 0 || bWords.length === 0) return false;

  const aMain = aWords.reduce((a, b) => a.length >= b.length ? a : b);
  const bMain = bWords.reduce((a, b) => a.length >= b.length ? a : b);

  // Exact main word match
  if (aMain === bMain) return true;

  // One contains the other (e.g. "POGON" in "POGON SZCZECIN")
  if (aMain.length >= 4 && (bMain.includes(aMain) || aMain.includes(bMain))) return true;

  // First word match (at least 4 chars)
  if (aWords[0].length >= 4 && bWords[0].length >= 4 &&
      (aWords[0].startsWith(bWords[0].substring(0, 4)) || bWords[0].startsWith(aWords[0].substring(0, 4)))) return true;

  // Check transliteration aliases
  const aFull = dbName.toUpperCase();
  const bFull = liveName.toUpperCase();
  for (const [key, aliases] of Object.entries(TEAM_ALIASES)) {
    if (aFull.includes(key) && aliases.some(a => bFull.includes(a))) return true;
    if (bFull.includes(key) && aliases.some(a => aFull.includes(a))) return true;
  }

  return false;
}
