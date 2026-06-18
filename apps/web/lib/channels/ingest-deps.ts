import { serviceClient } from '../supabase/service';
import type { IngestDeps } from './ingest';

export function supabaseIngestDeps(): IngestDeps {
  const svc = serviceClient();
  return {
    async resolveAccount(channel, externalId) {
      const { data } = await svc.from('notification_channels')
        .select('account_id').eq('channel', channel).eq('external_id', externalId).eq('status', 'verified').maybeSingle();
      return data?.account_id ?? null;
    },
    async verifyBinding(nonce, externalId, label) {
      const { data } = await svc.rpc('verify_channel_binding', { p_nonce: nonce, p_external_id: externalId, p_external_label: label ?? null });
      return (data as string | null) ?? null;
    },
    async persistInbound(row) {
      await svc.from('channel_messages').insert({
        account_id: row.accountId, channel: row.channel, direction: 'inbound', kind: 'inbound',
        status: 'received', verified: true, redacted_text: row.redactedText, redaction_rules: row.redactionRules,
        request_id: row.inReplyTo ?? null,
      });
    },
    async handoff() {
      // Plan 05 consumes the verified inbound (escalation reply -> approval gate;
      // chat -> Grovekeeper). Until then this is a no-op; the inbound row is
      // persisted above for observability.
    },
  };
}
