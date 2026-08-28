import assert from 'assert';
import { selectResultForMatch, selectVerifiedCorrection } from '../src/cron/resultSync';

const wrongSameHomeResult = selectResultForMatch('Argentina', 'Austria', [
  {
    homeTeam: 'Argentina',
    awayTeam: 'Algeria',
    homeScore: 3,
    awayScore: 0,
    league: 'World Cup',
    status: 'FT',
    kickoff: '03:00',
  },
]);

assert.equal(wrongSameHomeResult, null);

const exactResult = selectResultForMatch('Argentina', 'Austria', [
  {
    homeTeam: 'Argentina',
    awayTeam: 'Austria',
    homeScore: 2,
    awayScore: 0,
    league: 'World Cup',
    status: 'FT',
    kickoff: '03:00',
  },
]);

assert.equal(exactResult?.homeScore, 2);
assert.equal(exactResult?.awayScore, 0);

// A result from an adjacent day must not beat the result for the requested day.
const dateMatchedResult = selectResultForMatch('River Plate', 'Racing Club', [
  { homeTeam: 'River Plate', awayTeam: 'Racing Club', homeScore: 1, awayScore: 0, league: 'Liga', status: 'FT', kickoff: '', resultDate: '2026-08-01', source: 'livescore' },
  { homeTeam: 'River Plate', awayTeam: 'Racing Club', homeScore: 2, awayScore: 2, league: 'Cup', status: 'FT', kickoff: '', resultDate: '2026-08-02', source: 'sofascore' },
], '2026-08-02');

assert.equal(dateMatchedResult?.homeScore, 2);
assert.equal(dateMatchedResult?.awayScore, 2);

// When equally plausible candidates disagree, leave the match pending for a
// later sync instead of saving a result chosen merely by response order.
const ambiguousResult = selectResultForMatch('River Plate', 'Racing Club', [
  { homeTeam: 'River Plate', awayTeam: 'Racing Club', homeScore: 1, awayScore: 0, league: 'Liga', status: 'FT', kickoff: '' },
  { homeTeam: 'River Plate', awayTeam: 'Racing Club', homeScore: 2, awayScore: 2, league: 'Cup', status: 'FT', kickoff: '' },
]);

assert.equal(ambiguousResult, null);

// A stored score can only be corrected after the entire fixture identifies a
// different, unambiguous result.  A single-team candidate must not overwrite it.
const correction = selectVerifiedCorrection('Miami FC', 'Nashville SC', 1, 3, [
  { homeTeam: 'Inter Miami', awayTeam: 'Nashville SC', homeScore: 4, awayScore: 0, league: 'MLS', status: 'FT', kickoff: '', resultDate: '2026-08-02' },
], '2026-08-02');
assert.equal(correction, null);

// BBC Sport is the score authority when providers disagree on the same match.
const bbcAuthoritative = selectResultForMatch('River Plate', 'Racing Club', [
  { homeTeam: 'River Plate', awayTeam: 'Racing Club', homeScore: 1, awayScore: 0, league: 'Liga', status: 'FT', kickoff: '', resultDate: '2026-08-02', source: 'livescore' },
  { homeTeam: 'River Plate', awayTeam: 'Racing Club', homeScore: 2, awayScore: 2, league: 'Liga', status: 'FT', kickoff: '', resultDate: '2026-08-02', source: 'bbc' },
], '2026-08-02');
assert.equal(bbcAuthoritative?.homeScore, 2);
assert.equal(bbcAuthoritative?.awayScore, 2);

console.log('result matching tests passed');
