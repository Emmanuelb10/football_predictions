import { teamsMatch } from '../services/livescoreFetcher';

export interface FixtureIdentity {
  homeTeam: string;
  awayTeam: string;
}

export interface ExistingFixtureCandidate {
  id: number;
  kickoff: Date;
  status: string;
  home_team: string;
  away_team: string;
}

export function isSameOrderedFixture(a: FixtureIdentity, b: FixtureIdentity): boolean {
  return teamsMatch(a.homeTeam, b.homeTeam) && teamsMatch(a.awayTeam, b.awayTeam);
}

export function findSameFixtureCandidate<T extends ExistingFixtureCandidate>(
  candidates: T[],
  fixture: FixtureIdentity,
): T | null {
  return candidates.find(candidate =>
    isSameOrderedFixture(
      { homeTeam: candidate.home_team, awayTeam: candidate.away_team },
      fixture,
    ),
  ) ?? null;
}
