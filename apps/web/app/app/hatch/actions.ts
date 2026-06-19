'use server';

/**
 * Hatch Your Own (§4.6): the 3-step builder wizard's submit.
 *
 * Two paths:
 *   A) Freeform (choreText provided): synthesizeWorkflowFromText → composeSpec →
 *      adoptComposedSpec — produces a genuinely custom Nibbin bespoke to the
 *      user's typed description. Graceful fallback at every step: if synthesis
 *      returns null, composeSpec returns {error}, or adoptComposedSpec throws, we
 *      fall back to the nearest starter template via adoptTemplate (keyword-match
 *      the text against the 4 chores, else default "scribe") and surface a gentle
 *      note so the user always gets a Nibbin.
 *   B) Starter (chore index provided): the original path — map the index to a
 *      shop template key and adopt it under the user's chosen name via adoptTemplate.
 *
 * The trust-critical checks (trigger-graph cycle check §6.2, tier cap §6.4) are
 * enforced identically for both paths — they live in adoptComposedSpec /
 * adoptTemplate, not here.
 */
import { revalidatePath } from 'next/cache';
import { USER_SPECIES, ACCS, MARKS } from '@nibbin/creatures';
import { appSession } from '../../../lib/auth/app-session';
import { adoptTemplate, adoptComposedSpec, type AppearanceOverride } from '../../../lib/runtime/adopt';
import { composeSpec } from '../../../lib/composer/compose';
import { synthesizeWorkflowFromText } from '../../../lib/composer/freeform';
import { activeConnections } from '../../../lib/runtime/engine';
import { serviceClient } from '../../../lib/supabase/service';
import { CHORE_TEMPLATE } from './options';

/** Keep only the appearance fields that are valid engine inputs; drop the rest so the template's default stands. */
function cleanAppearance(a?: AppearanceOverride): AppearanceOverride | undefined {
  if (!a) return undefined;
  const out: AppearanceOverride = {};
  if (a.species && (USER_SPECIES as readonly string[]).includes(a.species)) out.species = a.species;
  if (a.palette && /^#[0-9a-fA-F]{6}$/.test(a.palette)) out.palette = a.palette;
  if (a.accessory && (ACCS as readonly string[]).includes(a.accessory)) out.accessory = a.accessory;
  if (a.marking && (MARKS as readonly string[]).includes(a.marking)) out.marking = a.marking;
  return Object.keys(out).length > 0 ? out : undefined;
}

export interface HatchResult {
  ok: boolean;
  /** Set on success — the name the egg hatched with (post-trim). */
  name?: string;
  /** Set on failure — a plain-language reason for the wizard to render. */
  error?: string;
  /** True when the cap was hit (the wizard links to billing). */
  capped?: boolean;
  /** Connectors the chosen template needs that aren't linked yet. */
  missingConnectors?: string[];
  /**
   * When the freeform synthesis path ran but fell back to a starter template,
   * this is set to a brief human-readable note explaining the fallback (e.g.
   * "connector not yet linked"). The egg still hatches — this is informational.
   */
  fallbackNote?: string;
}

/**
 * Keyword-match a free-text chore description to the nearest starter template.
 * Checked in priority order: payments/money → calendar/scheduling → email.
 * Defaults to 'scribe' (the email-reply starter — broadly applicable).
 */
function choreTextToFallbackTemplate(text: string): typeof CHORE_TEMPLATE[number] {
  const t = text.toLowerCase();
  if (/invoice|payment|pay|charge|bill|stripe|quickbooks/.test(t)) return 'echo';
  if (/calendar|schedul|meeting|event|appointment|book|confirm/.test(t)) return 'hopper';
  if (/file|upload|export|drive|dropbox|notion|doc|move|copy|rename/.test(t)) return 'brief';
  if (/follow.?up|chase|remind|nag|reply|email|inbox|message/.test(t)) return 'echo';
  return 'scribe';
}

export async function hatchNibbin(input: {
  /** Starter chore index (0–3). Ignored when choreText is also provided. */
  chore: number;
  apps: string[];
  name: string;
  appearance?: AppearanceOverride;
  /** Free-text chore description from the freeform path. When set, triggers
   *  synthesis → composeSpec → adoptComposedSpec with a starter fallback. */
  choreText?: string;
}): Promise<HatchResult> {
  // ── Freeform path ────────────────────────────────────────────────────────────
  if (input.choreText && input.choreText.trim().length > 0) {
    const name = input.name.trim().slice(0, 14);
    if (name.length === 0) return { ok: false, error: 'Give your egg a name.' };

    const { user, accountId } = await appSession();
    const appearance = cleanAppearance(input.appearance);
    const text = input.choreText.trim();

    // Gather account connections — needed by composeSpec and adoptComposedSpec.
    let connectorIds: string[] = [];
    try {
      const svc = serviceClient();
      const conns = await activeConnections(svc, accountId);
      connectorIds = conns.map((c) => c.provider);
    } catch {
      // Non-fatal: composeSpec handles the empty-connections case with a fallback.
    }

    // Step 1: synthesize a DiagnosisWorkflow from the text.
    let workflow = null;
    try {
      workflow = await synthesizeWorkflowFromText(accountId, user.id, text, connectorIds);
    } catch {
      workflow = null;
    }

    if (workflow) {
      // Step 2: compose a validated spec from the workflow.
      let composeResult = null;
      try {
        composeResult = await composeSpec(accountId, user.id, workflow, connectorIds);
      } catch {
        composeResult = null;
      }

      if (composeResult && 'spec' in composeResult) {
        // Step 3: adopt the composed spec.
        try {
          const result = await adoptComposedSpec(accountId, user.id, composeResult.spec, name, appearance);
          if (result.missingConnectors.length > 0) {
            return {
              ok: false,
              missingConnectors: result.missingConnectors,
              error: `This egg works from ${result.missingConnectors.join(' and ')} — connect ${result.missingConnectors.length > 1 ? 'those accounts' : 'that account'} first and it will start watching.`,
            };
          }
          revalidatePath('/app/nibbins');
          revalidatePath('/app');
          revalidatePath('/app/shop');
          return { ok: true, name: result.name };
        } catch (e) {
          if (e instanceof Error && e.message === 'nibbin_limit') {
            return {
              ok: false,
              capped: true,
              error: "Your grove is full for this plan — nobody gets deleted to make room; growing the grove means moving up a plan.",
            };
          }
          // Non-limit error: fall through to starter fallback below.
          console.error('[hatch] adoptComposedSpec failed, falling back to starter', e);
        }
      }
    }

    // Graceful fallback: synthesize failed or composeSpec returned {error} —
    // adopt the nearest starter template and surface a gentle note.
    const fallbackKey = choreTextToFallbackTemplate(text);
    let fallbackResult;
    try {
      fallbackResult = await adoptTemplate(accountId, user.id, fallbackKey, name, appearance);
    } catch (e) {
      if (e instanceof Error && e.message === 'nibbin_limit') {
        return {
          ok: false,
          capped: true,
          error: "Your grove is full for this plan — nobody gets deleted to make room; growing the grove means moving up a plan.",
        };
      }
      throw e;
    }

    if (fallbackResult.missingConnectors.length > 0) {
      return {
        ok: false,
        missingConnectors: fallbackResult.missingConnectors,
        error: `This egg works from ${fallbackResult.missingConnectors.join(' and ')} — connect ${fallbackResult.missingConnectors.length > 1 ? 'those accounts' : 'that account'} first and it will start watching.`,
      };
    }

    revalidatePath('/app/nibbins');
    revalidatePath('/app');
    revalidatePath('/app/shop');
    return {
      ok: true,
      name: fallbackResult.name,
      fallbackNote: "We started with a close match — your Nibbin will still learn your exact chore as it watches.",
    };
  }

  // ── Starter path (original logic) ────────────────────────────────────────────
  const templateKey = CHORE_TEMPLATE[input.chore];
  if (!templateKey) return { ok: false, error: 'Pick a chore to start.' };

  const name = input.name.trim().slice(0, 14);
  if (name.length === 0) return { ok: false, error: 'Give your egg a name.' };

  const { user, accountId } = await appSession();
  const appearance = cleanAppearance(input.appearance);

  let result;
  try {
    result = await adoptTemplate(accountId, user.id, templateKey, name, appearance);
  } catch (e) {
    if (e instanceof Error && e.message === 'nibbin_limit') {
      return {
        ok: false,
        capped: true,
        error:
          'Your grove is full for this plan — nobody gets deleted to make room; growing the grove means moving up a plan.',
      };
    }
    throw e;
  }

  if (result.missingConnectors.length > 0) {
    return {
      ok: false,
      missingConnectors: result.missingConnectors,
      error: `This egg works from ${result.missingConnectors.join(' and ')} — connect ${
        result.missingConnectors.length > 1 ? 'those accounts' : 'that account'
      } first and it'll start watching.`,
    };
  }

  // a new Nibbin joined the grove — refresh the roster + the shop's adopted list
  revalidatePath('/app/nibbins');
  revalidatePath('/app');
  revalidatePath('/app/shop');

  return { ok: true, name: result.name };
}
