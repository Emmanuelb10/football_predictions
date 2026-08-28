import assert from 'assert';
import { parse365ScoresResults } from '../src/services/scores365Fetcher';

const results = parse365ScoresResults({
  games: [
    {
      homeCompetitor: { name: 'Godoy Cruz', score: 1 },
      awayCompetitor: { name: 'Deportivo Maipú', score: 2 },
      competitionDisplayName: 'Primera Nacional',
      statusGroup: 4,
    },
    {
      homeCompetitor: { name: 'Future FC', score: 0 },
      awayCompetitor: { name: 'Waiting United', score: 0 },
      statusGroup: 2,
    },
  ],
});

assert.deepEqual(results, [{
  homeTeam: 'Godoy Cruz', awayTeam: 'Deportivo Maipú',
  homeScore: 1, awayScore: 2,
  league: 'Primera Nacional', status: 'FT', kickoff: '',
}]);

console.log('365Scores parser tests passed');
