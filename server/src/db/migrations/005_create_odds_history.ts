import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('odds_history', (t) => {
    t.increments('id').primary();
    t.integer('match_id').references('id').inTable('matches').onDelete('CASCADE');
    t.string('bookmaker', 50).defaultTo('1xbet');
    t.string('market', 20).defaultTo('1x2');
    t.decimal('home_odds', 6, 2);
    t.decimal('draw_odds', 6, 2);
    t.decimal('away_odds', 6, 2);
    t.timestamp('scraped_at').defaultTo(knex.fn.now());
    t.index(['match_id', 'bookmaker', 'scraped_at']);
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('odds_history');
}
