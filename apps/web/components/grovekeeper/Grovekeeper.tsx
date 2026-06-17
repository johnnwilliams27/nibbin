'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useRive, useStateMachineInput, Layout, Fit, Alignment } from '@rive-app/react-canvas';
import { Creature } from '../../app/(marketing)/Creature';

/**
 * State-machine + input names — these MUST match the authored .riv.
 * See reference/grovekeeper-asset-brief.md (Route A) for the contract the
 * Rive file is built against.
 */
const STATE_MACHINE = 'Keeper';
const MOOD = { idle: 0, happy: 1, thinking: 2 } as const;
export type KeeperMood = keyof typeof MOOD;

export interface GrovekeeperProps {
  /** Path to the Rive asset under /public. */
  src?: string;
  /** Drives the `mood` number input (0 idle · 1 happy · 2 thinking). */
  state?: KeeperMood;
  /** Drives the `talking` boolean input — subtle mouth/bob loop while speaking. */
  talking?: boolean;
  /** Fires the `wave` trigger each time this flips false → true. */
  greet?: boolean;
  /** Square render size in px. */
  size?: number;
  className?: string;
}

/**
 * The Grovekeeper, driven by the Rive `Keeper` state machine.
 *
 * Falls back to the canonical code-drawn Keeper (@nibbin/creatures) during SSR,
 * under prefers-reduced-motion, on load error, or while the .riv is absent — so
 * this is safe to ship today and upgrades automatically the moment
 * /public/grovekeeper/grovekeeper.riv is dropped in.
 */
export function Grovekeeper({
  src = '/grovekeeper/grovekeeper.riv',
  state = 'idle',
  talking = false,
  greet = false,
  size = 200,
  className,
}: GrovekeeperProps) {
  const [mounted, setMounted] = useState(false);
  const [reduced, setReduced] = useState(false);
  const [failed, setFailed] = useState(false);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    setMounted(true);
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    setReduced(mq.matches);
    const onChange = () => setReduced(mq.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);

  // Never touch the canvas/wasm during SSR or under reduced-motion / after a
  // failed load — passing null to useRive keeps it dormant.
  const active = mounted && !reduced && !failed;

  const layout = useMemo(() => new Layout({ fit: Fit.Contain, alignment: Alignment.Center }), []);
  const { rive, RiveComponent } = useRive(
    active
      ? {
          src,
          stateMachines: STATE_MACHINE,
          autoplay: true,
          layout,
          onLoad: () => setLoaded(true),
          onLoadError: () => setFailed(true),
        }
      : null,
  );

  const moodInput = useStateMachineInput(rive, STATE_MACHINE, 'mood');
  const talkInput = useStateMachineInput(rive, STATE_MACHINE, 'talking');
  const waveInput = useStateMachineInput(rive, STATE_MACHINE, 'wave');

  useEffect(() => {
    if (moodInput) moodInput.value = MOOD[state];
  }, [moodInput, state]);
  useEffect(() => {
    if (talkInput) talkInput.value = talking;
  }, [talkInput, talking]);

  const prevGreet = useRef(false);
  useEffect(() => {
    if (greet && !prevGreet.current && waveInput) waveInput.fire();
    prevGreet.current = greet;
  }, [greet, waveInput]);

  return (
    <div
      className={className}
      style={{ position: 'relative', width: size, height: size }}
      role="img"
      aria-label="Grovekeeper"
    >
      {active && <RiveComponent style={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }} />}
      {(!active || !loaded) && (
        <span
          style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
        >
          <Creature species="Keeper" size={size} />
        </span>
      )}
    </div>
  );
}
