'use client';

import { useState } from 'react';
import { Grovekeeper, type KeeperMood } from '../../components/grovekeeper/Grovekeeper';

/**
 * Scaffold preview for the studio Grovekeeper (Route A — Rive). Until
 * /public/grovekeeper/grovekeeper.riv exists this shows the code-drawn fallback;
 * once the .riv is dropped in (state machine `Keeper`, inputs mood/talking/wave),
 * the controls below drive it live. Not linked from anywhere.
 */
export default function GrovekeeperPreview() {
  const [state, setState] = useState<KeeperMood>('idle');
  const [talking, setTalking] = useState(false);
  const [greet, setGreet] = useState(false);

  const moods: KeeperMood[] = ['idle', 'happy', 'thinking'];

  return (
    <main
      style={{
        minHeight: '100dvh',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 24,
        padding: 32,
        background: 'radial-gradient(120% 100% at 50% 0%, #FFFDF6, #FBF7EC 60%, #F1EBD8)',
        fontFamily: 'ui-sans-serif, system-ui, sans-serif',
        color: '#2C3320',
      }}
    >
      <div style={{ textAlign: 'center' }}>
        <p style={{ font: '700 11px ui-monospace, monospace', letterSpacing: '.18em', textTransform: 'uppercase', color: '#5B7C2E', margin: '0 0 4px' }}>
          Nibbin · Rive scaffold
        </p>
        <h1 style={{ margin: 0, fontSize: 24, letterSpacing: '-.02em' }}>Grovekeeper</h1>
        <p style={{ margin: '6px 0 0', fontSize: 13, opacity: 0.65 }}>
          Showing the code-drawn fallback until <code>/grovekeeper/grovekeeper.riv</code> is added.
        </p>
      </div>

      <div
        style={{
          width: 320,
          height: 320,
          display: 'grid',
          placeItems: 'center',
          background: 'rgba(255,255,255,.5)',
          border: '1px solid #E4DCC6',
          borderRadius: 24,
        }}
      >
        <Grovekeeper state={state} talking={talking} greet={greet} size={280} />
      </div>

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', justifyContent: 'center' }}>
        {moods.map((m) => (
          <button key={m} type="button" onClick={() => setState(m)} style={btn(state === m)}>
            {m}
          </button>
        ))}
        <button type="button" onClick={() => setTalking((v) => !v)} style={btn(talking)}>
          talking: {talking ? 'on' : 'off'}
        </button>
        <button
          type="button"
          onClick={() => {
            setGreet(true);
            setTimeout(() => setGreet(false), 200);
          }}
          style={btn(false)}
        >
          wave 👋
        </button>
      </div>
    </main>
  );
}

function btn(active: boolean): React.CSSProperties {
  return {
    font: '700 13.5px ui-sans-serif, system-ui, sans-serif',
    padding: '9px 16px',
    borderRadius: 999,
    cursor: 'pointer',
    border: '1px solid #5B7C2E',
    background: active ? '#5B7C2E' : 'transparent',
    color: active ? '#fff' : '#5B7C2E',
  };
}
