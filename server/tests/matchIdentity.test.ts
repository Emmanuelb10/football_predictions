import assert from 'assert';
import { findSameFixtureCandidate } from '../src/utils/matchIdentity';
import { teamsStrongMatch } from '../src/services/livescoreFetcher';

const candidates = [
  {
    id: 489,
    kickoff: new Date('2026-05-19T01:30:00.000Z'),
    status: 'finished',
    home_team: 'SAO PAULO',
    away_team: 'LOS MILLONARIOS',
  },
];

const duplicate = findSameFixtureCandidate(candidates, {
  homeTeam: 'SAO PAULO',
  awayTeam: 'Millonarios',
});

assert.equal(duplicate?.id, 489);

const reversed = findSameFixtureCandidate(candidates, {
  homeTeam: 'Millonarios',
  awayTeam: 'SAO PAULO',
});

assert.equal(reversed, null);

assert.equal(teamsStrongMatch('Pogon', 'Pogon Szczecin'), true);
assert.equal(teamsStrongMatch('Manchester United', 'Newcastle United'), false);
assert.equal(teamsStrongMatch('Real Madrid', 'Real Sociedad'), false);
assert.equal(teamsStrongMatch('Miami FC', 'Inter Miami'), false);
assert.equal(teamsStrongMatch('Atletico Madrid', 'Athletico Paranaense'), false);

console.log('matchIdentity tests passed');
