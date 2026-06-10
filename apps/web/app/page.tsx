import { buildCreature } from '@nibbin/creatures';

export default function Home() {
  const keeper = buildCreature({ species: 'Keeper', size: 180 });
  return (
    <main>
      <header style={{ padding: '64px 0 40px', borderBottom: '1px solid var(--line)' }}>
        <div className="wrap">
          <span className="eyebrow">Nibbin</span>
          <h1>AI agents that nibble your busywork away.</h1>
          <p className="sub">
            Hatch a grove of small, careful creature agents. Each one earns its autonomy in Agent
            School — drafts first, verified accuracy, your approval — before it ever acts on its
            own. The Grovekeeper looks after the grove and explains everything in plain terms.
          </p>
        </div>
      </header>
      <section style={{ padding: '48px 0' }}>
        <div className="wrap" style={{ display: 'flex', alignItems: 'center', gap: 32, flexWrap: 'wrap' }}>
          <span dangerouslySetInnerHTML={{ __html: keeper }} />
          <div style={{ maxWidth: '52ch' }}>
            <h2>The grove is still growing</h2>
            <p className="sub" style={{ marginTop: 8 }}>
              We&apos;re building Nibbin for people who work for themselves. The Grovekeeper is
              getting the grove ready — hatch day isn&apos;t far off.
            </p>
            <p
              style={{
                fontFamily: 'var(--mono)',
                fontSize: 12,
                color: 'var(--ink-soft)',
                marginTop: 16,
              }}
            >
              hello@nibbin.com
            </p>
          </div>
        </div>
      </section>
    </main>
  );
}
