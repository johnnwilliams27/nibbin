/**
 * RLS attack suite for the M5 drip + email tables. Posture matches
 * rls.test.ts: adversarial queries as the PostgREST roles. Members read only
 * their own arc/sends/leaves; nobody but the service role touches the
 * suppression list or the send log (they hold bare email addresses); the
 * only client write path is mark_notification_read, membership-checked.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { RlsHarness } from './harness';

const dbAvailable = await RlsHarness.probe();

if (!dbAvailable && !process.env.CI) {
  console.warn('[rls] no database at RLS_DATABASE_URL / localhost:54329 — skipping drip suite');
}

const UID_A = 'aaaaaaaa-5555-4555-8555-555555555555';
const UID_B = 'bbbbbbbb-6666-4666-8666-666666666666';

describe.skipIf(!dbAvailable)('drip + email RLS (M5)', () => {
  const h = new RlsHarness();
  let accountA = '';
  let accountB = '';
  let leafA = '';

  const asA = { kind: 'authenticated', uid: UID_A } as const;
  const asB = { kind: 'authenticated', uid: UID_B } as const;
  const anon = { kind: 'anon' } as const;
  const service = { kind: 'service_role' } as const;

  beforeAll(async () => {
    await h.reset();
    await h.sql(`insert into auth.users (id, email) values ($1, 'da@example.test'), ($2, 'db@example.test')`, [
      UID_A,
      UID_B,
    ]);
    for (const [who, uid] of [
      [asA, UID_A],
      [asB, UID_B],
    ] as const) {
      await h.as(who, async (c) => {
        await c.query(`insert into public.users (id, email) values ($1, $2)`, [uid, `${uid}@example.test`]);
      });
    }
    accountA = await h.as(asA, async (c) =>
      (await c.query(`select public.create_account_with_owner('A Grove') as id`)).rows[0].id,
    );
    accountB = await h.as(asB, async (c) =>
      (await c.query(`select public.create_account_with_owner('B Grove') as id`)).rows[0].id,
    );
    await h.as(service, async (c) => {
      await c.query(`insert into public.drip_arcs (account_id) values ($1), ($2)`, [accountA, accountB]);
      await c.query(
        `insert into public.drip_sends (account_id, beat, slot, local_day, status)
         values ($1, 'field_notes_1', 'field_notes_1', '2026-06-02', 'sent')`,
        [accountA],
      );
      leafA = (
        await c.query(
          `insert into public.notifications (account_id, kind, source_id, title, body)
           values ($1, 'beat', 'field_notes_1', 'Your first Field Notes', 'Evening.') returning id`,
          [accountA],
        )
      ).rows[0].id;
      await c.query(`insert into public.email_suppressions (email, reason) values ('gone@example.test', 'unsubscribe')`);
      await c.query(
        `insert into public.email_sends (account_id, to_email, beat) values ($1, 'da@example.test', 'field_notes_1')`,
        [accountA],
      );
    });
  });

  afterAll(async () => {
    await h.close();
  });

  describe('member reads are account-scoped', () => {
    it('A reads their own arc, sends, and leaves — and only theirs', async () => {
      const arcs = await h.as(asA, async (c) => (await c.query(`select account_id from public.drip_arcs`)).rows);
      expect(arcs).toHaveLength(1);
      expect(arcs[0].account_id).toBe(accountA);

      const sends = await h.as(asA, async (c) => (await c.query(`select beat from public.drip_sends`)).rows);
      expect(sends).toHaveLength(1);

      const leaves = await h.as(asB, async (c) =>
        (await c.query(`select * from public.notifications where account_id = $1`, [accountA])).rows,
      );
      expect(leaves).toHaveLength(0);
    });

    it('anon sees nothing anywhere', async () => {
      for (const table of ['drip_arcs', 'drip_sends', 'notifications']) {
        await expect(h.as(anon, async (c) => c.query(`select * from public.${table}`))).rejects.toThrow();
      }
    });
  });

  describe('clients cannot write the drip tables', () => {
    it('a member cannot forge a send record or flip their arc', async () => {
      await expect(
        h.as(asA, async (c) =>
          c.query(
            `insert into public.drip_sends (account_id, beat, slot, local_day) values ($1, 'species', 'species', '2026-06-03')`,
            [accountA],
          ),
        ),
      ).rejects.toThrow();
      await expect(
        h.as(asA, async (c) => c.query(`update public.drip_arcs set email_enabled = false where account_id = $1`, [accountA])),
      ).rejects.toThrow();
      await expect(
        h.as(asA, async (c) =>
          c.query(`insert into public.notifications (account_id, kind, source_id, title, body) values ($1, 'beat', 'x', 't', 'b')`, [
            accountA,
          ]),
        ),
      ).rejects.toThrow();
    });
  });

  describe('the suppression list and send log are service-only (bare addresses)', () => {
    it('members and anon can neither read nor write them', async () => {
      for (const who of [asA, anon] as const) {
        await expect(h.as(who, async (c) => c.query(`select * from public.email_suppressions`))).rejects.toThrow();
        await expect(h.as(who, async (c) => c.query(`select * from public.email_sends`))).rejects.toThrow();
        await expect(
          h.as(who, async (c) =>
            c.query(`insert into public.email_suppressions (email, reason) values ('x@example.test', 'manual')`),
          ),
        ).rejects.toThrow();
      }
    });

    it('the service role reads and upserts suppressions idempotently', async () => {
      await h.as(service, async (c) => {
        await c.query(
          `insert into public.email_suppressions (email, reason) values ('gone@example.test', 'bounce')
           on conflict (email) do nothing`,
        );
        const rows = (await c.query(`select reason from public.email_suppressions where email = 'gone@example.test'`)).rows;
        expect(rows).toHaveLength(1);
        expect(rows[0].reason).toBe('unsubscribe'); // first write wins
      });
    });
  });

  describe('mark_notification_read — the single client write path', () => {
    it('a member marks their own leaf read', async () => {
      await h.as(asA, async (c) => {
        await c.query(`select public.mark_notification_read($1)`, [leafA]);
      });
      const read = await h.as(service, async (c) =>
        (await c.query(`select read_at from public.notifications where id = $1`, [leafA])).rows[0],
      );
      expect(read.read_at).not.toBeNull();
    });

    it("a non-member's call is a silent no-op on someone else's leaf", async () => {
      const fresh = await h.as(service, async (c) =>
        (
          await c.query(
            `insert into public.notifications (account_id, kind, source_id, title, body)
             values ($1, 'beat', 'species', 'Meet the six species', 'Six of them.') returning id`,
            [accountA],
          )
        ).rows[0].id,
      );
      await h.as(asB, async (c) => {
        await c.query(`select public.mark_notification_read($1)`, [fresh]);
      });
      const row = await h.as(service, async (c) =>
        (await c.query(`select read_at from public.notifications where id = $1`, [fresh])).rows[0],
      );
      expect(row.read_at).toBeNull();
    });
  });

  describe('double-send guards live in the database', () => {
    it('the same slot can never be claimed twice — even under its other beat key', async () => {
      await h.as(service, async (c) => {
        const again = await c.query(
          `insert into public.drip_sends (account_id, beat, slot, local_day, status)
           values ($1, 'field_notes_1', 'field_notes_1', '2026-06-03', 'claimed')
           on conflict do nothing`,
          [accountA],
        );
        expect(again.rowCount).toBe(0);
        // The day-5 slot under both keys: scan_depth claims it…
        const first = await c.query(
          `insert into public.drip_sends (account_id, beat, slot, local_day, status)
           values ($1, 'scan_depth', 'study_whisper', '2026-06-06', 'claimed')
           on conflict do nothing`,
          [accountA],
        );
        expect(first.rowCount).toBe(1);
        // …and study_whisper can never re-deliver the same slot.
        const twin = await c.query(
          `insert into public.drip_sends (account_id, beat, slot, local_day, status)
           values ($1, 'study_whisper', 'study_whisper', '2026-06-07', 'claimed')
           on conflict do nothing`,
          [accountA],
        );
        expect(twin.rowCount).toBe(0);
      });
    });

    it('a second non-skipped push on the same local day is refused', async () => {
      await h.as(service, async (c) => {
        const sameDay = await c.query(
          `insert into public.drip_sends (account_id, beat, slot, local_day, status)
           values ($1, 'species', 'species', '2026-06-02', 'claimed')
           on conflict do nothing`,
          [accountA],
        );
        expect(sameDay.rowCount).toBe(0);
        // Skipped bookkeeping on the same day is fine.
        const skipped = await c.query(
          `insert into public.drip_sends (account_id, beat, slot, local_day, status)
           values ($1, 'training_1', 'training_1', '2026-06-02', 'skipped')
           on conflict do nothing`,
          [accountA],
        );
        expect(skipped.rowCount).toBe(1);
      });
    });
  });
});
