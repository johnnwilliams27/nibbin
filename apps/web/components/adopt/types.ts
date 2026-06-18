/**
 * The serializable result of an adopt server action. On success we carry the
 * creature's appearance so the client can play the hatch ceremony; on any
 * non-success path we carry where the client should navigate instead.
 */
export type AdoptOutcome =
  | {
      ok: true;
      nibbinId: string;
      name: string;
      species: string;
      stage: 'egg' | 'student';
      palette: string;
      accessory: string;
      marking: string;
      isFirstAdoption: boolean;
      /** Where "meet them" goes after the ceremony. */
      ctaPath: string;
    }
  | { ok: false; redirectTo: string };
