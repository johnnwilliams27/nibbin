import 'server-only';

/**
 * Adoption (§4.6): template → validated spec snapshot → Nibbin hatched as an
 * Egg. The trigger graph is cycle-checked against EVERY spec already on the
 * account before anything is written (§6.2 spec-validation time); the
 * adopt_nibbin RPC enforces the §6.4 tier cap under the account lock.
 */
import {
  getTemplate,
  validateTriggerGraph,
  type AgentSpec,
} from '@nibbin/runtime';
import type { SupabaseClient } from '@supabase/supabase-js';
import { serviceClient } from '../supabase/service';
import { SupabaseEventSink } from './stores';
import { activeConnections, hatchToStudent, specFromRow, triggerNibbinRun } from './engine';
import type { RunOutcome } from '@nibbin/runtime';

export interface AdoptResult {
  nibbinId: string;
  name: string;
  templateKey: string;
  stage: 'egg' | 'student';
  /** Outcome of the first dispatched run (§4.1 step 7 — first value fast). */
  firstRun: RunOutcome | null;
  missingConnectors: string[];
}

async function accountSpecs(svc: SupabaseClient, accountId: string): Promise<AgentSpec[]> {
  const { data, error } = await svc
    .from('agent_specs')
    .select('*, nibbins!inner(status)')
    .eq('account_id', accountId)
    .neq('nibbins.status', 'sleeping');
  if (error) throw new Error(`spec load failed: ${error.message}`);
  return (data ?? []).map((row) => specFromRow(row as Parameters<typeof specFromRow>[0]));
}

/** Optional appearance chosen at hatch time; any field omitted falls back to the template's. */
export interface AppearanceOverride {
  species?: string;
  palette?: string;
  accessory?: string;
  marking?: string;
}

export async function adoptTemplate(
  accountId: string,
  userId: string,
  templateKey: string,
  chosenName?: string,
  appearance?: AppearanceOverride,
): Promise<AdoptResult> {
  const svc = serviceClient();
  const template = getTemplate(templateKey);
  const name = (chosenName ?? template.spec.displayName).trim().slice(0, 40) || template.spec.displayName;
  const species = appearance?.species ?? template.species;
  const palette = appearance?.palette ?? template.color;
  const accessory = appearance?.accessory ?? template.accessory;
  const marking = appearance?.marking ?? template.marking;

  // §6.2: cycle-checked trigger graphs at spec-validation time, across the
  // account's whole spec set — custom or shop, same validation.
  const existing = await accountSpecs(svc, accountId);
  const problems = validateTriggerGraph([...existing, template.spec]);
  if (problems.length > 0) {
    throw new Error(`spec validation failed: ${problems.join('; ')}`);
  }

  const connections = await activeConnections(svc, accountId);
  const have = new Set(connections.map((c) => c.provider));
  const missing = template.spec.requiredConnectors.filter((p) => !have.has(p));
  if (missing.length > 0) {
    return {
      nibbinId: '',
      name,
      templateKey,
      stage: 'egg',
      firstRun: null,
      missingConnectors: missing,
    };
  }

  const { data, error } = await svc.rpc('adopt_nibbin', {
    p_account: accountId,
    p_actor_user: userId,
    p_template_key: templateKey,
    p_version: template.spec.version,
    p_display_name: template.spec.displayName,
    p_tools_allowlist: template.spec.toolsAllowlist,
    p_required_connectors: template.spec.requiredConnectors,
    p_triggers: template.spec.triggers,
    p_curriculum: template.spec.curriculum,
    p_credit_profile: template.spec.creditProfile,
    p_name: name,
    p_species: species,
    p_palette: palette,
    p_accessory: accessory,
    p_marking: marking,
    p_seed: Math.abs(hashCode(`${accountId}:${templateKey}:${name}`)) % 100_000,
  });
  if (error) {
    if (error.message.includes('nibbin limit reached')) {
      throw new Error('nibbin_limit');
    }
    throw new Error(`adoption failed: ${error.message}`);
  }
  const row = (Array.isArray(data) ? data[0] : data) as { nibbin_id: string };
  const nibbinId = row.nibbin_id;

  const events = new SupabaseEventSink(svc);
  await events.emit({ name: 'nibbin_adopted', accountId, userId, props: { templateKey, nibbinId } });

  // §4.6 incubation: the Egg becomes a Student once account context has been
  // observed — a completed scan or Keeper interview counts (the SQL decides).
  const hatched = await hatchToStudent(nibbinId);

  // §4.1 step 7: dispatch the first run immediately so a reviewable draft
  // exists within minutes of adoption. Eggs (no context yet) skip this.
  let firstRun: RunOutcome | null = null;
  if (hatched) {
    firstRun = await triggerNibbinRun(nibbinId, { kind: 'user', key: 'adoption.first-run' });
  }

  return { nibbinId, name, templateKey, stage: hatched ? 'student' : 'egg', firstRun, missingConnectors: [] };
}

function hashCode(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (Math.imul(31, h) + s.charCodeAt(i)) | 0;
  return h;
}
