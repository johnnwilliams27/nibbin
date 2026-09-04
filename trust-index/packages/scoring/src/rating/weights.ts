/**
 * Generic observer weighting: the subject-agnostic twin of weights.ts.
 *
 * Same shape as the chain path, a product of multipliers clamped to
 * [weight_floor, 1], with the chain-specific signals generalized:
 *
 *   chain                          generic
 *   -----                          -------
 *   wallet age                     observer age since first_seen
 *   same-day creation cohort       shared independence_group
 *   shared first funder            shared independence_group (same signal)
 *   portfolio concentration        observer.concentration
 *   reviews per day                observations per day
 *   commerce with the agent        interaction with the subject
 *   repeat reviews of the agent    (absent: see below)
 *
 * The cohort and funder signals collapse into one because off chain they are
 * one thing. Two review accounts created within an hour of each other by the
 * same operator and two wallets funded from the same address are both "these
 * are not independent voices", and the generic path has exactly one field for
 * that. Where a collector can establish the relationship it sets
 * independence_group; where it cannot, the field is null, and null is treated
 * as unknown rather than as evidence of independence.
 *
 * The repeat-interaction bonus is deliberately absent. On chain it is
 * defensible because a second review of the same agent costs a second
 * transaction. Off chain a second review costs nothing, so the same bonus
 * would reward whoever writes the most, which is the opposite of what it is
 * for. Returning observers still contribute more in total through having more
 * observations; they do not additionally earn a multiplier for it.
 */
import type { Observer } from "@trust-index/types";
import { divRoundHalfUp } from "@trust-index/types";
import { ONE, clampFx, divFx, intFx, minFx, mulFx, parseFx } from "../fixedmath.js";
import { parseIsoUtcSeconds } from "../time.js";
import type { RatingConstantsFx } from "./constants.js";

export type ObserverWeightFx = {
  observerId: string;
  weightFx: bigint;
  components: {
    age: bigint;
    group: bigint;
    velocity: bigint;
    interaction: bigint;
    concentration: bigint;
  };
};

/**
 * Weights for every observer of one subject. Output is sorted by observer_id
 * so nothing downstream depends on map iteration order (SPEC 22).
 *
 * `observers` must be exactly the observers appearing in the subject's
 * admissible observations.
 */
export function computeObserverWeights(
  observers: readonly Observer[],
  asOfSec: number,
  c: RatingConstantsFx,
): ObserverWeightFx[] {
  const sorted = [...observers].sort((a, b) =>
    a.observer_id < b.observer_id ? -1 : a.observer_id > b.observer_id ? 1 : 0,
  );
  const total = sorted.length;

  // Group sizes across this subject's observer set. An observer with a null
  // group is in no group and is not counted toward anyone else's share.
  const groupSize = new Map<string, number>();
  for (const o of sorted) {
    if (o.independence_group === null) continue;
    groupSize.set(o.independence_group, (groupSize.get(o.independence_group) ?? 0) + 1);
  }

  return sorted.map((o) => {
    const seenSec = parseIsoUtcSeconds(o.first_seen_ts);
    const ageSeconds = asOfSec >= seenSec ? asOfSec - seenSec : 0;
    const ageDaysFx = divRoundHalfUp(BigInt(ageSeconds) * ONE, 86400n);
    const ageRatio = minFx(ONE, divFx(ageDaysFx, c.ageRampDays));
    const age = c.ageFloor + mulFx(ONE - c.ageFloor, ageRatio);

    // Group share: how much of this subject's observer set shares this
    // observer's group, excluding the observer itself. One observer alone in
    // its group is undiluted; a group of ten out of ten observers is diluted
    // to near the floor.
    let group = ONE;
    if (o.independence_group !== null && total > 1) {
      const others = (groupSize.get(o.independence_group) ?? 1) - 1;
      const share = divRoundHalfUp(BigInt(others) * ONE, BigInt(total));
      group = clampFx(ONE - mulFx(share, c.groupPenalty), 0n, ONE);
    }

    const velocity =
      intFx(o.max_observations_single_day) > c.velocityThresholdPerDay ? c.velocityMultiplier : ONE;

    const interaction = o.has_interaction_with_subject ? c.interactionMultiplier : ONE;

    const concentration = clampFx(
      ONE - mulFx(clampFx(parseFx(o.concentration), 0n, ONE), c.concentrationPenalty),
      0n,
      ONE,
    );

    let w = age;
    w = mulFx(w, group);
    w = mulFx(w, velocity);
    w = mulFx(w, interaction);
    w = mulFx(w, concentration);
    w = clampFx(w, c.weightFloor, ONE);

    return {
      observerId: o.observer_id,
      weightFx: w,
      components: { age, group, velocity, interaction, concentration },
    };
  });
}
