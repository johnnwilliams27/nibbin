'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { appSession } from '../../../lib/auth/app-session';
import { serviceClient } from '../../../lib/supabase/service';
import { adoptComposedSpec, adoptTemplate } from '../../../lib/runtime/adopt';
import { activeConnections } from '../../../lib/runtime/engine';
import { composeSpec } from '../../../lib/composer/compose';
import type { DiagnosisMap, DiagnosisWorkflow } from '../../../lib/diagnosis/types';
import type { AdoptOutcome } from '../../../components/adopt/types';

/**
 * Adopt a recommended Nibbin straight from the diagnosis reveal. Returns an
 * AdoptOutcome so the client can play the hatch ceremony; a missing connector
 * or error becomes a navigation the client performs instead of a redirect here.
 */
export async function adoptRecommendationOutcome(templateKey: string): Promise<AdoptOutcome> {
  const key = templateKey.trim();
  if (!key) return { ok: false, redirectTo: '/app/diagnosis' };

  const { user, accountId } = await appSession();

  try {
    const result = await adoptTemplate(accountId, user.id, key);
    if (result.missingConnectors.length > 0) {
      return {
        ok: false,
        redirectTo: `/app/diagnosis?needs=${encodeURIComponent(result.missingConnectors.join(','))}`,
      };
    }
    return {
      ok: true,
      nibbinId: result.nibbinId,
      name: result.name,
      species: result.species,
      stage: result.stage,
      palette: result.palette,
      accessory: result.accessory,
      marking: result.marking,
      isFirstAdoption: result.isFirstAdoption,
      ctaPath: '/app',
    };
  } catch {
    return { ok: false, redirectTo: '/app/diagnosis?error=adopt' };
  }
}

/* ── Synthesis (Composer Slice 2a): build a custom Nibbin for a workflow ───── */

export type ComposerReviewResult =
  | {
      ok: true;
      workflowKey: string;
      workflowLabel: string;
      displayName: string;
      summary: string;
      tone: string;
      trigger: string;
      connectorsNeeded: string[];
    }
  | { ok: false; error: string };

/** Load a diagnosis (account-scoped) and find one workflow by key. */
async function loadWorkflow(
  accountId: string,
  diagnosisId: string,
  workflowKey: string,
): Promise<DiagnosisWorkflow | null> {
  const svc = serviceClient();
  const { data, error } = await svc
    .from('diagnoses')
    .select('map')
    .eq('id', diagnosisId)
    .eq('account_id', accountId)
    .maybeSingle();
  if (error || !data) return null;
  const map = data.map as DiagnosisMap | null;
  return map?.workflows?.find((w) => w.key === workflowKey) ?? null;
}

/**
 * Compose (but do NOT adopt) a custom Nibbin for one diagnosis workflow. Returns
 * the proposed agent's human-readable plan for the review-before-adopt surface.
 * Deterministic with no model key (CI-safe); fail-closed validated by composeSpec.
 */
export async function synthesizeForWorkflow(
  diagnosisId: string,
  workflowKey: string,
): Promise<ComposerReviewResult> {
  const { user, accountId } = await appSession();
  const workflow = await loadWorkflow(accountId, diagnosisId, workflowKey);
  if (!workflow) return { ok: false, error: 'That workflow is no longer in this diagnosis.' };

  const svc = serviceClient();
  const connections = await activeConnections(svc, accountId);
  const providers = connections.map((c) => c.provider);

  const result = await composeSpec(accountId, user.id, workflow, providers);
  if ('error' in result) return { ok: false, error: result.error };

  const { spec, summary } = result;
  return {
    ok: true,
    workflowKey,
    workflowLabel: workflow.label,
    displayName: spec.displayName,
    summary,
    tone: spec.personaPolicy?.tone ?? 'warm, plainspoken',
    trigger: 'Every morning, and whenever you ask',
    connectorsNeeded: spec.requiredConnectors,
  };
}

/**
 * Synthesize + adopt a custom Nibbin for one workflow. Re-runs composeSpec (the
 * proposal is deterministic for a given workflow + connectors, so the adopted
 * spec == the reviewed one), then adoptComposedSpec — which re-validates
 * fail-closed before any write. Returns an AdoptOutcome so the client plays the
 * Beat-2 hatch ceremony, exactly like a template adoption.
 */
export async function adoptSynthesized(
  diagnosisId: string,
  workflowKey: string,
  chosenName?: string,
): Promise<AdoptOutcome> {
  const { user, accountId } = await appSession();
  const workflow = await loadWorkflow(accountId, diagnosisId, workflowKey);
  if (!workflow) return { ok: false, redirectTo: '/app/diagnosis?error=adopt' };

  try {
    const svc = serviceClient();
    const connections = await activeConnections(svc, accountId);
    const providers = connections.map((c) => c.provider);

    const result = await composeSpec(accountId, user.id, workflow, providers);
    if ('error' in result) {
      return { ok: false, redirectTo: '/app/diagnosis?error=adopt' };
    }

    const name = (chosenName ?? result.spec.displayName).trim() || result.spec.displayName;
    const adopted = await adoptComposedSpec(accountId, user.id, result.spec, name);
    if (adopted.missingConnectors.length > 0) {
      return {
        ok: false,
        redirectTo: `/app/diagnosis?needs=${encodeURIComponent(adopted.missingConnectors.join(','))}`,
      };
    }
    return {
      ok: true,
      nibbinId: adopted.nibbinId,
      name: adopted.name,
      species: adopted.species,
      stage: adopted.stage,
      palette: adopted.palette,
      accessory: adopted.accessory,
      marking: adopted.marking,
      isFirstAdoption: adopted.isFirstAdoption,
      ctaPath: '/app',
    };
  } catch {
    return { ok: false, redirectTo: '/app/diagnosis?error=adopt' };
  }
}

/**
 * Permanently delete a single diagnosis from the account's history (§6.11 +
 * #29 erasure). DELETE is REVOKED from `authenticated`, so this goes through
 * the service client. The service role bypasses RLS, so the explicit
 * `.eq('account_id', accountId)` IS the authz guard — never delete by id alone.
 */
export async function deleteDiagnosis(formData: FormData) {
  const id = String(formData.get('id') ?? '').trim();
  // Defensive: a missing/blank id deletes nothing and just bounces back.
  if (!id) redirect('/app/diagnosis');

  const { accountId } = await appSession();

  const svc = serviceClient();
  const { error } = await svc
    .from('diagnoses')
    .delete()
    .eq('id', id)
    .eq('account_id', accountId);

  if (!error) {
    // Best-effort analytics; never fail the delete on it.
    try {
      await svc.rpc('emit_product_event', {
        p_account: accountId,
        p_name: 'diagnosis_deleted',
        p_props: { diagnosisId: id },
      });
    } catch {
      // ignore
    }
    revalidatePath('/app/diagnosis');
  }

  redirect('/app/diagnosis');
}
