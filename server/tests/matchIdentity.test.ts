import assert from 'assert';
import { findSameFixtureCandidate } from '../src/utils/matchIdentity';

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

console.log('matchIdentity tests passed');
