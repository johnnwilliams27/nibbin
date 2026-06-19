'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { appSession } from '../../../lib/auth/app-session';
import { serviceClient } from '../../../lib/supabase/service';
import { adoptComposedSpec, adoptTemplate } from '../../../lib/runtime/adopt';
import { activeConnections } from '../../../lib/runtime/engine';
import {
  composeSpec,
  applyComposerEdit,
  editablePlanFromSpec,
  COMPOSER_CADENCES,
  type ComposerEdit,
  type EditablePlan,
} from '../../../lib/composer/compose';
import type { DiagnosisMap, DiagnosisWorkflow } from '../../../lib/diagnosis/types';
import type { AdoptOutcome } from '../../../components/adopt/types';
import type { AgentSpec } from '@nibbin/runtime';

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

/** Friendly display name for a connector provider id (review card). */
function connectorLabel(provider: string): string {
  switch (provider) {
    case 'gmail':
      return 'Gmail';
    case 'google-calendar':
      return 'Google Calendar';
    case 'stripe':
      return 'Stripe';
    default:
      return provider;
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
      /**
       * The reviewed, already-validated spec — carried through to adoption so
       * the user hatches EXACTLY what they approved (no recomposition / no 2nd
       * model call that could drift, e.g. a different staleDays). Client-supplied
       * at adopt time, but `adoptComposedSpec` re-validates it fail-closed
       * against the registry + the account's live connections BEFORE any write,
       * so it is confined to a valid menu-primitive spec regardless.
       */
      spec: AgentSpec;
      /**
       * The EDITABLE surface (Part B): the steps + per-step scalar params + the
       * cadence the user may tweak before adopting. Derived from `spec`; the
       * client edits this and sends back a `ComposerEdit`, which the server
       * re-derives + re-validates fail-closed. The user can only ever reorder /
       * remove steps + tweak schema-bounded scalars + name/cadence.
       */
      editable: EditablePlan;
      /** The named cadences the user may choose for the schedule trigger. */
      cadenceOptions: readonly string[];
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
    // Friendly connector names for the review card — a cross-resource Nibbin
    // (e.g. calendar→email) lists both (Google Calendar and Gmail).
    connectorsNeeded: spec.requiredConnectors.map(connectorLabel),
    spec,
    editable: editablePlanFromSpec(spec),
    cadenceOptions: COMPOSER_CADENCES,
  };
}

/**
 * Re-validate a user's EDIT of a composed proposal WITHOUT adopting (Part B) —
 * the client calls this when the user changes a step's params / removes /
 * reorders / changes the cadence, so the review card can show the refreshed
 * plan + reject an invalid edit BEFORE the confirm step. Pure re-derivation +
 * fail-closed validation; no model call, no write.
 *
 * `reviewedSpec` is client-supplied, but that is safe: `applyComposerEdit`
 * rebuilds the trusted envelope from the registry and re-validates fail-closed,
 * so the edit is confined to reordered/removed primitives + schema-bounded
 * params regardless of transport.
 */
export async function previewComposerEdit(
  reviewedSpec: AgentSpec,
  edit: ComposerEdit,
  workflowLabel: string,
): Promise<{ ok: true; spec: AgentSpec; summary: string; editable: EditablePlan } | { ok: false; error: string }> {
  const { accountId } = await appSession();
  const svc = serviceClient();
  const connections = await activeConnections(svc, accountId);
  const providers = connections.map((c) => c.provider);

  const result = applyComposerEdit(reviewedSpec, edit, workflowLabel, providers);
  if ('error' in result) return { ok: false, error: result.error };
  return { ok: true, spec: result.spec, summary: result.summary, editable: editablePlanFromSpec(result.spec) };
}

/**
 * Adopt the REVIEWED custom spec for one workflow. The spec comes straight from
 * the review step (synthesizeForWorkflow) — it is NOT recomposed here, so the
 * user hatches exactly what they approved (a 2nd composeSpec at temperature 0.3
 * could drift, e.g. a different staleDays, and would double the model spend).
 *
 * Part B — when the user EDITED the proposal (`edit` present), the edit is
 * applied + re-validated SERVER-SIDE via `applyComposerEdit`: the trusted
 * envelope (allowlist/connectors/triggers) is rebuilt from the registry and the
 * spec is re-validated fail-closed. The user can only reorder/remove steps +
 * tweak schema-bounded scalar params + name/cadence; an edit that fails
 * validation is REFUSED (never adopted). `edit` is client-supplied, but that is
 * safe for the same reason the raw spec is.
 *
 * The spec is client-supplied, but that is safe: `adoptComposedSpec` re-runs
 * `validateComposedSpec` (capability∈registry, schema-checked primitive params,
 * connector-granted, allowlist⊇yielded tools, acyclic graph) fail-closed BEFORE
 * any write — so a tampered spec is confined to a valid menu-primitive spec
 * regardless. The validator is the trust boundary, not the transport.
 *
 * Returns an AdoptOutcome so the client plays the Beat-2 hatch ceremony,
 * exactly like a template adoption.
 */
export async function adoptSynthesized(
  spec: AgentSpec,
  chosenName?: string,
  edit?: ComposerEdit,
  workflowLabel?: string,
): Promise<AdoptOutcome> {
  const { user, accountId } = await appSession();

  try {
    // Part B: apply the user's edit + re-validate fail-closed server-side. An
    // edit that fails validation aborts adoption (never silently falls back to
    // the un-edited spec — the user must fix it).
    let toAdopt = spec;
    if (edit) {
      const svc = serviceClient();
      const connections = await activeConnections(svc, accountId);
      const providers = connections.map((c) => c.provider);
      const reconciled = applyComposerEdit(spec, edit, workflowLabel ?? spec.displayName, providers);
      if ('error' in reconciled) {
        return { ok: false, redirectTo: '/app/diagnosis?error=edit' };
      }
      toAdopt = reconciled.spec;
    }
    const name = (chosenName ?? toAdopt.displayName).trim() || toAdopt.displayName;
    // adoptComposedSpec re-validates the spec fail-closed against the account's
    // live connections + the registry BEFORE any DB write (the trust boundary).
    const adopted = await adoptComposedSpec(accountId, user.id, toAdopt, name);
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
