import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { RlsHarness } from './harness';

const dbAvailable = await RlsHarness.probe();
if (!dbAvailable && !process.env.CI) {
  console.warn('[rls] no database — skipping memory-extensible schema suite');
}

describe.skipIf(!dbAvailable)('migration: field_meta + sources columns', () => {
  const h = new RlsHarness();

  beforeAll(async () => {
    await h.reset();
  });
  afterAll(async () => {
    await h.close();
  });

  it('field_meta has label/sort_order/is_custom/is_hidden', async () => {
    const r = await h.sql(
      `select column_name from information_schema.columns
       where table_schema='public' and table_name='field_meta'`,
    );
    const names = r.rows.map((row: { column_name: string }) => row.column_name);
    expect(names).toEqual(expect.arrayContaining(['label', 'sort_order', 'is_custom', 'is_hidden']));
  });

  it('sources has mime_type/byte_size/extraction_state', async () => {
    const r = await h.sql(
      `select column_name from information_schema.columns
       where table_schema='public' and table_name='sources'`,
    );
    const names = r.rows.map((row: { column_name: string }) => row.column_name);
    expect(names).toEqual(expect.arrayContaining(['mime_type', 'byte_size', 'extraction_state']));
  });

  it('extraction_state CHECK constraint exists with the required values', async () => {
    // Verify the constraint is registered in pg_constraint
    const r = await h.sql(
      `select cc.check_clause
       from information_schema.table_constraints tc
       join information_schema.check_constraints cc
         on cc.constraint_schema = tc.constraint_schema
        and cc.constraint_name   = tc.constraint_name
       where tc.table_schema = 'public'
         and tc.table_name   = 'sources'
         and tc.constraint_type = 'CHECK'
         and cc.check_clause like '%extraction_state%'`,
    );
    expect(r.rows.length).toBeGreaterThan(0);
    const clause = r.rows[0].check_clause as string;
    // All five allowed values must appear in the constraint definition
    for (const val of ['pending', 'extracting', 'extracted', 'unsupported', 'failed']) {
      expect(clause).toContain(val);
    }
  });

  it('sources_account_state_idx index exists', async () => {
    const r = await h.sql(
      `select indexname from pg_indexes
       where schemaname='public' and tablename='sources' and indexname='sources_account_state_idx'`,
    );
    expect(r.rows).toHaveLength(1);
  });
});
