import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  const hasColumn = await knex.schema.hasColumn('predictions', 'is_ev_pick');
  if (!hasColumn) {
    await knex.schema.alterTable('predictions', (t) => {
      t.boolean('is_ev_pick').defaultTo(false);
    });
  }
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.alterTable('predictions', (t) => {
    t.dropColumn('is_ev_pick');
  });
}
