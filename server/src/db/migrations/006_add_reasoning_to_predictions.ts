import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  const hasColumn = await knex.schema.hasColumn('predictions', 'reasoning');
  if (!hasColumn) {
    await knex.schema.alterTable('predictions', (t) => {
      t.text('reasoning').defaultTo('');
    });
  }
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.alterTable('predictions', (t) => {
    t.dropColumn('reasoning');
  });
}
