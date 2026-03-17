import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('predictions', (t) => {
    t.increments('id').primary();
    t.integer('match_id').references('id').inTable('matches').onDelete('CASCADE').unique();
    t.decimal('home_win_prob', 5, 4);
    t.decimal('draw_prob', 5, 4);
    t.decimal('away_win_prob', 5, 4);
    t.string('tip', 10);
    t.decimal('confidence', 5, 4);
    t.decimal('expected_value', 8, 4);
    t.boolean('is_value_bet').defaultTo(false);
    t.boolean('is_pick_of_day').defaultTo(false);
    t.decimal('potd_rank_score', 8, 4);
    t.decimal('poisson_score', 8, 4);
    t.decimal('league_hit_ratio', 5, 4);
    t.decimal('std_deviation', 8, 4);
    t.decimal('line_movement', 8, 4);
    t.string('source', 50).defaultTo('api-football');
    t.timestamp('created_at').defaultTo(knex.fn.now());
    t.index(['is_value_bet', 'is_pick_of_day']);
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('predictions');
}
