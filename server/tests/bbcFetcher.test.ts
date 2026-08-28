import assert from 'assert';
import { parseBbcResults } from '../src/services/bbcFetcher';

const results = parseBbcResults(`
  <section><h2>Premier League</h2>
    <li data-tipo-topic-id="fixture-1">
      <span class="TeamNameWrapper"><span>Arsenal</span><span class="visually-hidden">Arsenal</span></span>
      <div data-testid="score"><div class="HomeScore">3</div><div class="VerticalLine"></div><div class="AwayScore">1</div></div>
      <span class="TeamNameWrapper"><span>Chelsea</span><span class="visually-hidden">Chelsea</span></span>
      <span>Full time</span>
    </li>
    <li data-tipo-topic-id="fixture-2">
      <span class="TeamNameWrapper">Liverpool</span>
      <span class="TeamNameWrapper">Everton</span>
      <span>Kick off 20:00</span>
    </li>
  </section>
`);

assert.deepEqual(results, [{
  homeTeam: 'Arsenal', awayTeam: 'Chelsea', homeScore: 3, awayScore: 1,
  league: 'Premier League', status: 'FT', kickoff: '',
}]);

console.log('BBC Sport parser tests passed');
