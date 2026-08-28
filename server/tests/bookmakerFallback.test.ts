import assert from 'assert';
import {
  selectBookmakerFixtureForMatch,
  selectBookmakerResultForMatch,
} from '../src/services/bookmakerFallback';

const fixture = selectBookmakerFixtureForMatch('EVERTON DV', 'DEPORTES COPIAPO', [
  {
    homeTeam: 'Everton de Vina del Mar',
    awayTeam: 'Copiapo',
    league: 'Chile Primera Division',
    kickoff: '00:00',
    homeOdds: 1.50,
    drawOdds: 4.25,
    awayOdds: 5.25,
  },
]);

assert.equal(fixture?.homeTeam, 'Everton de Vina del Mar');
assert.equal(fixture?.awayTeam, 'Copiapo');

const wrongFixture = selectBookmakerFixtureForMatch('EVERTON DV', 'DEPORTES COPIAPO', [
  {
    homeTeam: 'Everton',
    awayTeam: 'Audax Italiano',
    league: 'Chile Primera Division',
    kickoff: '00:00',
  },
]);

assert.equal(wrongFixture, null);

const result = selectBookmakerResultForMatch('EVERTON DV', 'DEPORTES COPIAPO', [
  {
    homeTeam: 'Everton de Vina del Mar',
    awayTeam: 'Copiapo',
    league: 'Chile Primera Division',
    kickoff: '00:00',
    status: 'finished',
    homeScore: 2,
    awayScore: 0,
  },
]);

assert.equal(result?.homeScore, 2);
assert.equal(result?.awayScore, 0);

console.log('bookmaker fallback tests passed');
