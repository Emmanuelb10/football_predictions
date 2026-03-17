import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('teams', (t) => {
    t.increments('id').primary();
    t.integer('api_football_id').unique().notNullable();
    t.string('name', 255).notNullable();
    t.string('short_name', 10);
    t.text('logo_url');
    t.integer('tournament_id').references('id').inTable('tournaments').onDelete('SET NULL');
    t.timestamp('created_at').defaultTo(knex.fn.now());
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('teams');
}
