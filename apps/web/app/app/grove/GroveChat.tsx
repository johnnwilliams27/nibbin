'use client';

/**
 * The grove — the Grovekeeper's visual chat (§4.2). Full-bleed layered scene
 * with time-of-day palette and ≤8px parallax; the Keeper stands in-scene with
 * CSS expression states; conversation renders as cards in a live log.
 *
 * Reduced motion = feature parity (design-system rule): the scene becomes a
 * calm static backdrop — no parallax, no stagger, no hatch theatrics — while
 * every card, chip, and input behaves identically.
 */
import Link from 'next/link';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { creatureCss } from '@nibbin/creatures';
import {
  type KeeperExpression,
  type KeeperMessage,
  type OnboardingStep,
  type QuestionCard,
  type UnderstandingProfile,
} from '@nibbin/keeper';
import { advanceGroveAction, keeperChatAction, skipUnderstandingAction, understandStepAction } from './actions';
import { CardView } from './cards';
import { KeeperSprite } from './KeeperSprite';
import { Button } from '../../../components/ui';
import ui from '../../../components/ui/ui.module.css';
import styles from './grove.module.css';

type Theme = 'dawn' | 'day' | 'dusk';

function themeForHour(hour: number): Theme {
  if (hour >= 5 && hour < 9) return 'dawn';
  if (hour >= 9 && hour < 18) return 'day';
  return 'dusk';
}

interface ChatItem {
  id: string;
  from: 'keeper' | 'user';
  message?: KeeperMessage;
  text?: string;
}

const ERROR_LINE = 'Something snagged on my end — nothing was lost. Give it another try in a moment.';

let localSeq = 0;
function localId(prefix: string): string {
  localSeq += 1;
  return `${prefix}-${localSeq}`;
}

function keeperItem(message: KeeperMessage): ChatItem {
  return { id: localId(message.id), from: 'keeper', message };
}

/** Layered scene backdrop. Pure decoration — hidden from the tree. */
function SceneLayers() {
  return (
    <div className={styles.layers} aria-hidden="true">
      <div className={styles.glow} />
      <svg className={styles.layerFar} viewBox="0 0 1200 240" preserveAspectRatio="xMidYMax slice">
        <path d="M0 240 L0 150 Q120 90 260 130 Q400 60 540 110 Q700 40 850 100 Q1020 60 1200 120 L1200 240 Z" fill="var(--g-far)" />
      </svg>
      <svg className={styles.layerMid} viewBox="0 0 1200 260" preserveAspectRatio="xMidYMax slice">
        <path d="M0 260 L0 190 Q80 150 150 170 L165 120 Q170 95 185 120 L198 172 Q300 140 380 168 L398 96 Q405 70 420 96 L436 170 Q560 135 660 168 Q780 130 900 165 L918 110 Q925 85 940 110 L955 168 Q1080 140 1200 175 L1200 260 Z" fill="var(--g-mid)" />
      </svg>
      <svg className={styles.layerNear} viewBox="0 0 1200 140" preserveAspectRatio="xMidYMax slice">
        <path d="M0 140 L0 70 Q60 50 120 66 Q140 30 158 62 Q220 44 300 62 Q330 26 352 58 Q450 40 560 60 Q600 24 630 56 Q740 38 850 58 Q890 28 916 56 Q1040 40 1200 64 L1200 140 Z" fill="var(--g-near)" />
      </svg>
    </div>
  );
}

export function GroveChat({
  initialMessages,
  initialExpression,
  initialStep,
  keeperName: initialKeeperName,
  freshHatch,
  credits,
  initialProfile,
}: {
  initialMessages: KeeperMessage[];
  initialExpression: KeeperExpression;
  initialStep: OnboardingStep;
  keeperName: string | null;
  freshHatch: boolean;
  credits: number;
  initialProfile: UnderstandingProfile | null;
}) {
  const [items, setItems] = useState<ChatItem[]>(() =>
    freshHatch ? [] : initialMessages.map(keeperItem),
  );
  const [expression, setExpression] = useState<KeeperExpression>(freshHatch ? 'idle' : initialExpression);
  const [step, setStep] = useState<OnboardingStep>(initialStep);
  const [keeperName, setKeeperName] = useState<string | null>(initialKeeperName);
  const [profile, setProfile] = useState<UnderstandingProfile | null>(initialProfile);
  const [os, setOs] = useState<'mac' | 'windows' | 'other'>('other');
  const [busy, setBusy] = useState(false);
  const [draft, setDraft] = useState('');
  const [picked, setPicked] = useState<string[]>([]);
  const [theme, setTheme] = useState<Theme>('day');
  const [reducedMotion, setReducedMotion] = useState(false);
  const [hatched, setHatched] = useState(!freshHatch);
  const [cracking, setCracking] = useState(false);
  const [burstKey, setBurstKey] = useState(0);

  const sceneRef = useRef<HTMLDivElement>(null);
  const logRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const timersRef = useRef<number[]>([]);

  /* Time-of-day palette, set after mount so SSR markup stays stable. */
  useEffect(() => {
    setTheme(themeForHour(new Date().getHours()));
  }, []);

  /* Detect the platform so the handoff leads with the right installer. */
  useEffect(() => {
    const ua = navigator.userAgent.toLowerCase();
    if (ua.includes('mac')) setOs('mac');
    else if (ua.includes('win')) setOs('windows');
  }, []);

  useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    setReducedMotion(mq.matches);
    const onChange = (e: MediaQueryListEvent) => setReducedMotion(e.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);

  useEffect(() => () => timersRef.current.forEach((t) => window.clearTimeout(t)), []);

  const later = useCallback((fn: () => void, ms: number) => {
    timersRef.current.push(window.setTimeout(fn, ms));
  }, []);

  /** Append keeper messages with a gentle stagger (instant under reduced motion). */
  const appendKeeperMessages = useCallback(
    (messages: KeeperMessage[], after?: () => void) => {
      if (reducedMotion) {
        setItems((prev) => [...prev, ...messages.map(keeperItem)]);
        after?.();
        return;
      }
      messages.forEach((m, i) => later(() => setItems((prev) => [...prev, keeperItem(m)]), i * 420));
      if (after) later(after, messages.length * 420);
    },
    [later, reducedMotion],
  );

  /* The hatch (§4.1 step 2): egg wobbles, cracks, the Grovekeeper emerges.
     Cleanup matters: if the reduced-motion preference lands right after
     mount, the rerun must cancel the staged timers or the opening lines
     would double. */
  useEffect(() => {
    if (hatched) return;
    if (reducedMotion) {
      setHatched(true);
      setItems(initialMessages.map(keeperItem));
      setExpression(initialExpression);
      return;
    }
    const t1 = window.setTimeout(() => setCracking(true), 1500);
    const t2 = window.setTimeout(() => {
      setHatched(true);
      setExpression('delighted');
      setBurstKey((k) => k + 1);
      appendKeeperMessages(initialMessages, () => setExpression(initialExpression));
    }, 2100);
    return () => {
      window.clearTimeout(t1);
      window.clearTimeout(t2);
    };
    // Deps stay narrow on purpose: initialMessages/initialExpression are
    // stable props; `hatched` flipping true makes the rerun a no-op.
  }, [reducedMotion]);

  /* Keep the newest card in view. */
  useEffect(() => {
    const log = logRef.current;
    if (log) log.scrollTo({ top: log.scrollHeight, behavior: reducedMotion ? 'auto' : 'smooth' });
  }, [items, reducedMotion]);

  /* Parallax ≤8px, pointer-driven, disabled for reduced motion. */
  const onPointerMove = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (reducedMotion || e.pointerType !== 'mouse') return;
      const el = sceneRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      const nx = Math.max(-0.5, Math.min(0.5, (e.clientX - rect.left) / rect.width - 0.5));
      const ny = Math.max(-0.5, Math.min(0.5, (e.clientY - rect.top) / rect.height - 0.5));
      el.style.setProperty('--par-x', nx.toFixed(3));
      el.style.setProperty('--par-y', ny.toFixed(3));
    },
    [reducedMotion],
  );

  const activeQuestion: QuestionCard | null = useMemo(() => {
    const last = items[items.length - 1];
    if (last?.from === 'keeper' && last.message?.card.kind === 'question') return last.message.card;
    return null;
  }, [items]);

  const runTurn = useCallback(
    async (userLine: string, perform: () => Promise<{ messages: KeeperMessage[]; expression: KeeperExpression }>) => {
      if (busy) return;
      setBusy(true);
      setItems((prev) => [...prev, { id: localId('u'), from: 'user', text: userLine }]);
      setExpression('thinking');
      try {
        const result = await perform();
        const final = result.expression;
        if (final === 'delighted') setBurstKey((k) => k + 1);
        setExpression(final);
        appendKeeperMessages(result.messages);
      } catch {
        setExpression('concerned');
        setItems((prev) => [
          ...prev,
          keeperItem({
            id: 'err',
            from: 'keeper',
            card: { kind: 'prose', text: ERROR_LINE, transcript: ERROR_LINE },
          }),
        ]);
      } finally {
        setBusy(false);
        inputRef.current?.focus();
      }
    },
    [appendKeeperMessages, busy],
  );

  const advance = useCallback(
    (userLine: string, input: { text?: string; skip?: boolean; channels?: string[] }) =>
      runTurn(userLine, async () => {
        const payload = await advanceGroveAction(input);
        setStep(payload.step);
        setKeeperName(payload.keeperName);
        return payload;
      }),
    [runTurn],
  );

  const submitText = useCallback(() => {
    const text = draft.trim();
    if (text === '' || busy) return;
    setDraft('');
    if (step === 'understand') {
      void runTurn(text, async () => {
        const payload = await understandStepAction(text);
        setStep(payload.step);
        setKeeperName(payload.keeperName);
        if (payload.profile) setProfile(payload.profile);
        return { messages: payload.messages, expression: payload.expression };
      });
    } else if (step !== 'done') {
      void advance(text, { text });
    } else {
      void runTurn(text, async () => {
        const payload = await keeperChatAction(text);
        // payload.routing carries the structured §6.3 decision (tier/degraded)
        // for future styling + telemetry; the user-facing notice already rides
        // inside the message prose.
        return { messages: [payload.message], expression: payload.expression };
      });
    }
  }, [advance, busy, draft, runTurn, step]);

  const togglePick = useCallback((id: string) => {
    setPicked((prev) => (prev.includes(id) ? prev.filter((p) => p !== id) : [...prev, id]));
  }, []);

  const submitChannels = useCallback(() => {
    const labels = activeQuestion?.chips?.filter((c) => picked.includes(c.id)).map((c) => c.label) ?? [];
    const chosen = picked;
    setPicked([]);
    void advance(labels.join(', '), { channels: chosen });
  }, [activeQuestion, advance, picked]);

  const skip = useCallback(() => {
    setPicked([]);
    void advance('Skip this one', { skip: true });
  }, [advance]);

  const multiQuestion = activeQuestion?.multi === true;
  const placeholder = busy
    ? '…'
    : multiQuestion
      ? 'Pick what fits — or skip'
      : (activeQuestion?.placeholder ??
        (step === 'done' ? `Say something to ${keeperName ?? 'your Grovekeeper'}` : 'Type your answer'));

  return (
    <div className={styles.scene} data-theme={theme} ref={sceneRef} onPointerMove={onPointerMove}>
      {/* Engine idle/blink animation rules — included once per surface. */}
      <style dangerouslySetInnerHTML={{ __html: creatureCss }} />
      <SceneLayers />

      <div className={styles.content}>
        <header className={styles.header}>
          <div>
            <p className={styles.eyebrow}>Your grove</p>
            <h1 className={styles.title}>{keeperName ?? 'A new arrival'}</h1>
          </div>
          <div className={styles.headerRight}>
            <p className={styles.meter}>
              <span className={styles.meterValue}>{credits}</span> credits
            </p>
            <Link className={styles.backLink} href="/app">
              Grove home
            </Link>
          </div>
        </header>

        <div className={styles.main}>
          <KeeperSprite
            expression={expression}
            hatched={hatched}
            cracking={cracking}
            burstKey={burstKey}
            name={keeperName}
          />

          <div className={styles.chat}>
            <div className={styles.log} role="log" aria-live="polite" ref={logRef} tabIndex={0}>
              {items.map((item) =>
                item.from === 'user' ? (
                  <div key={item.id} className={styles.userBubble}>
                    {item.text}
                  </div>
                ) : (
                  <div
                    key={item.id}
                    className={
                      item.message!.card.kind === 'celebration' ? styles.celebrationCard : styles.keeperBubble
                    }
                  >
                    <CardView card={item.message!.card} />
                  </div>
                ),
              )}
              {busy && (
                <p className={styles.srOnly} role="status">
                  {keeperName ?? 'Your Grovekeeper'} is writing in the journal…
                </p>
              )}
            </div>

            <div className={styles.composer}>
              {/* Handoff screen: shown at done, replaces the former scan/adopt chip block */}
              {step === 'done' && !busy && (
                <div className={styles.handoff}>
                  {profile?.jobTitle && (
                    <p className={styles.handoffReflect}>
                      Here&apos;s what I picked up — you do <strong>{profile.jobTitle}</strong>
                      {profile.channels.length > 0 && <> and most of your work comes through <strong>{profile.channels.join(', ')}</strong></>}.
                    </p>
                  )}
                  <p className={styles.handoffLead}>Your team is waiting in the desktop app — that&apos;s where we connect your accounts and start.</p>
                  {os === 'windows' ? (
                    <>
                      <a className={`${ui.btn} ${ui.btnPrimary}`} href="/download/windows">Download for Windows</a>
                      <a className={`${ui.btn} ${ui.btnGhost}`} href="/download/mac">Download for macOS instead</a>
                    </>
                  ) : os === 'mac' ? (
                    <>
                      <a className={`${ui.btn} ${ui.btnPrimary}`} href="/download/mac">Download for macOS</a>
                      <a className={`${ui.btn} ${ui.btnGhost}`} href="/download/windows">Download for Windows instead</a>
                    </>
                  ) : (
                    <>
                      <a className={`${ui.btn} ${ui.btnPrimary}`} href="/download/mac">Download for macOS</a>
                      <a className={`${ui.btn} ${ui.btnPrimary}`} href="/download/windows">Download for Windows</a>
                    </>
                  )}
                  <Link className={`${ui.btn} ${ui.btnGhost}`} href="/app">Not now — take me to my grove</Link>
                </div>
              )}
              {/* Understand-phase chips: fill the input as suggestions (not auto-submit) */}
              {step === 'understand' && activeQuestion?.chips && !busy && (
                <div className={styles.chips}>
                  {activeQuestion.chips.map((chip) => (
                    <button
                      key={chip.id}
                      type="button"
                      className={styles.chip}
                      onClick={() => { setDraft((d) => (d ? `${d}, ${chip.label}` : chip.label)); inputRef.current?.focus(); }}
                    >
                      {chip.label}
                    </button>
                  ))}
                </div>
              )}
              {/* Non-understand chips: existing multi/single select behavior */}
              {step !== 'understand' && activeQuestion?.chips && !busy && (
                <div className={styles.chips}>
                  {activeQuestion.chips
                    .filter((c) => c.id !== 'skip')
                    .map((chip) =>
                      multiQuestion ? (
                        <button
                          key={chip.id}
                          type="button"
                          className={styles.chip}
                          aria-pressed={picked.includes(chip.id)}
                          onClick={() => togglePick(chip.id)}
                        >
                          {chip.label}
                        </button>
                      ) : (
                        <button
                          key={chip.id}
                          type="button"
                          className={styles.chip}
                          onClick={() => void advance(chip.label, { text: chip.label })}
                        >
                          {chip.label}
                        </button>
                      ),
                    )}
                  {multiQuestion && picked.length > 0 && (
                    <button type="button" className={styles.chipConfirm} onClick={submitChannels}>
                      That&apos;s where
                    </button>
                  )}
                  {activeQuestion.skippable && (
                    <button type="button" className={styles.chip} onClick={skip}>
                      Skip this one
                    </button>
                  )}
                </div>
              )}

              <form
                className={styles.inputRow}
                onSubmit={(e) => {
                  e.preventDefault();
                  submitText();
                }}
              >
                <label className={styles.srOnly} htmlFor="grove-say">
                  {placeholder}
                </label>
                <input
                  id="grove-say"
                  ref={inputRef}
                  className={styles.input}
                  value={draft}
                  placeholder={placeholder}
                  autoComplete="off"
                  maxLength={2000}
                  disabled={busy || !hatched}
                  onChange={(e) => setDraft(e.target.value)}
                  onFocus={() => setExpression((x) => (x === 'idle' ? 'listening' : x))}
                  onBlur={() => setExpression((x) => (x === 'listening' ? 'idle' : x))}
                />
                <button className={styles.send} type="submit" disabled={busy || !hatched || draft.trim() === ''}>
                  Say it
                </button>
              </form>
              {step === 'understand' && !busy && (
                <Button
                  variant="ghost"
                  type="button"
                  onClick={() =>
                    void runTurn("Skip ahead — I'll set up in the app", async () => {
                      const p = await skipUnderstandingAction();
                      setStep(p.step);
                      setKeeperName(p.keeperName);
                      if (p.profile) setProfile(p.profile);
                      return { messages: p.messages, expression: p.expression };
                    })
                  }
                >
                  Skip ahead — I&apos;ll set up in the app
                </Button>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
