import assert from 'assert';
import { parseFlashscoreResults } from '../src/services/flashscoreFetcher';

const results = parseFlashscoreResults(
  '~ZA\u00f7Football\u00ac~AA\u00f7event-id\u00ac~AE\u00f7Gor Mahia\u00ac~AF\u00f7AFC Leopards\u00ac~AC\u00f73\u00ac~AG\u00f72\u00ac~AH\u00f71\u00ac~CN\u00f7KPL' +
  '~AA\u00f7scheduled-id\u00ac~AE\u00f7Scheduled FC\u00ac~AF\u00f7Later United\u00ac~AC\u00f70\u00ac~AG\u00f70\u00ac~AH\u00f70',
);

assert.deepEqual(results, [{
  homeTeam: 'Gor Mahia', awayTeam: 'AFC Leopards', homeScore: 2, awayScore: 1,
  league: 'KPL', status: 'FT', kickoff: '',
}]);

console.log('Flashscore feed parser tests passed');
