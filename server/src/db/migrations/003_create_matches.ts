import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('matches', (t) => {
    t.increments('id').primary();
    t.integer('api_football_id').unique().notNullable();
    t.integer('tournament_id').references('id').inTable('tournaments').onDelete('CASCADE');
    t.integer('home_team_id').references('id').inTable('teams').onDelete('CASCADE');
    t.integer('away_team_id').references('id').inTable('teams').onDelete('CASCADE');
    t.timestamp('kickoff').notNullable();
    t.string('status', 20).defaultTo('scheduled');
    t.integer('home_score');
    t.integer('away_score');
    t.timestamp('created_at').defaultTo(knex.fn.now());
    t.timestamp('updated_at').defaultTo(knex.fn.now());
    t.index(['kickoff', 'status']);
    t.index('tournament_id');
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('matches');
}
