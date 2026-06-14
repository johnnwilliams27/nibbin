'use client';

/**
 * KeeperChat — the reusable chat engine (§4.2).
 * Contains all state, effects, callbacks, the message log, chips, composer,
 * handoff screen, and the KeeperSprite. Renders inside any surface
 * (focal full-bleed scene, docked panel, etc.) via the `variant` prop.
 *
 * In Phase 1 `variant` is accepted but does not branch layout — both values
 * render identically. Layout branching lands in Phase 2+.
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
import styles from './keeper-chat.module.css';

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

export function KeeperChat({
  initialMessages,
  initialExpression,
  initialStep,
  keeperName: initialKeeperName,
  freshHatch,
  credits,
  initialProfile,
  variant,
}: {
  initialMessages: KeeperMessage[];
  initialExpression: KeeperExpression;
  initialStep: OnboardingStep;
  keeperName: string | null;
  freshHatch: boolean;
  credits: number;
  initialProfile: UnderstandingProfile | null;
  variant: 'focal' | 'panel';
}) {
  const isPanel = variant === 'panel';
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
  const [reducedMotion, setReducedMotion] = useState(false);
  const [hatched, setHatched] = useState(!freshHatch);
  const [cracking, setCracking] = useState(false);
  const [burstKey, setBurstKey] = useState(0);

  const logRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const timersRef = useRef<number[]>([]);

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

  const log = (
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
  );

  const composer = (
    <div className={styles.composer}>
      {/* Handoff screen: shown at done, replaces the former scan/adopt chip block.
          In panel mode the handoff is suppressed — the user is already on Grove Home. */}
      {step === 'done' && !busy && !isPanel && (
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
  );

  return (
    <div className={`${styles.chatRoot} ${isPanel ? styles.chatRootPanel : ''}`}>
      {/* Engine idle/blink animation rules — included once per surface. */}
      <style dangerouslySetInnerHTML={{ __html: creatureCss }} />

      {/* focal variant: full-bleed content + 2-col sprite layout */}
      {!isPanel && (
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
              {log}
              {composer}
            </div>
          </div>
        </div>
      )}

      {/* panel variant: compact single-column log + sticky composer */}
      {isPanel && (
        <div className={styles.panelBody}>
          {log}
          {composer}
        </div>
      )}
    </div>
  );
}
