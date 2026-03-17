import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('tournaments', (t) => {
    t.increments('id').primary();
    t.integer('api_football_id').unique().notNullable();
    t.string('name', 255).notNullable();
    t.string('country', 100);
    t.integer('season');
    t.boolean('is_active').defaultTo(true);
    t.timestamp('created_at').defaultTo(knex.fn.now());
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('tournaments');
}
