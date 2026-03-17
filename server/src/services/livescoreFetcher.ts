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

/**
 * Get only finished matches from livescore.com.
 */
export async function fetchFinishedResults(date: string): Promise<LivescoreMatch[]> {
  const all = await fetchLivescores(date);
  return all.filter(m => ['FT', 'AET', 'AP', 'Pen'].includes(m.status));
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
 * Fuzzy match a team name from our DB against a livescore team name.
 */
/**
 * Fuzzy match team names. Strips numbers, suffixes, and compares core name.
 */
export function teamsMatch(dbName: string, liveName: string): boolean {
  // Normalize: uppercase, strip numbers/special chars, trim
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

  // Check if the main word (longest or first significant word) matches
  const aMain = aWords.reduce((a, b) => a.length >= b.length ? a : b);
  const bMain = bWords.reduce((a, b) => a.length >= b.length ? a : b);

  // Exact main word match
  if (aMain === bMain) return true;

  // One contains the other (e.g. "POGON" in "POGON SZCZECIN")
  if (aMain.length >= 4 && (bMain.includes(aMain) || aMain.includes(bMain))) return true;

  // First word match (at least 4 chars)
  if (aWords[0].length >= 4 && bWords[0].length >= 4 &&
      (aWords[0].startsWith(bWords[0].substring(0, 4)) || bWords[0].startsWith(aWords[0].substring(0, 4)))) return true;

  return false;
}
