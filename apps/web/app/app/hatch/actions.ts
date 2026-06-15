'use server';

/**
 * Hatch Your Own (§4.6): the 3-step builder wizard's submit. The "egg" is
 * template-backed but custom-named — we map the plain-language chore to one of
 * the six shop templates and adopt it under the user's chosen name, reusing the
 * exact same adoption path the Agent Shop uses (`adoptTemplate` → the
 * `adopt_nibbin` RPC). That keeps the trust-critical checks in one place: the
 * trigger-graph cycle check (§6.2) and the §6.4 tier cap (enforced in SQL under
 * the per-account advisory lock) both run here, unchanged.
 *
 * This is the honest v1: it does NOT synthesize a bespoke agent (custom
 * tools_allowlist / trigger graph). The selected apps + chore are advisory UI
 * context only — the M4 schema has no per-nibbin metadata column to persist
 * them to (agent_specs is the validated template snapshot; nibbins has no notes
 * field), so they shape the chore→template choice and nothing more for now.
 */
import { revalidatePath } from 'next/cache';
import { appSession } from '../../../lib/auth/app-session';
import { adoptTemplate } from '../../../lib/runtime/adopt';
import { CHORE_TEMPLATE } from './options';

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
}

export async function hatchNibbin(input: {
  chore: number;
  apps: string[];
  name: string;
}): Promise<HatchResult> {
  const templateKey = CHORE_TEMPLATE[input.chore];
  if (!templateKey) return { ok: false, error: 'Pick a chore to start.' };

  const name = input.name.trim().slice(0, 14);
  if (name.length === 0) return { ok: false, error: 'Give your egg a name.' };

  const { user, accountId } = await appSession();

  let result;
  try {
    result = await adoptTemplate(accountId, user.id, templateKey, name);
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
