import {
  buildCreature,
  PALETTES,
  STAGES,
  STAGE_LABEL,
  ACCS,
  MARKS,
  USER_SPECIES,
  SPECIES,
} from '@nibbin/creatures';

export const metadata = {
  title: 'Creature harness — Nibbin',
  robots: { index: false },
};

const cellStyle: React.CSSProperties = {
  border: '1px solid var(--line)',
  padding: 10,
  textAlign: 'center',
};

const thStyle: React.CSSProperties = {
  ...cellStyle,
  fontFamily: 'var(--mono)',
  fontSize: 10,
  letterSpacing: '.1em',
  textTransform: 'uppercase',
  color: 'var(--ink-soft)',
  background: '#FCFDF9',
  fontWeight: 600,
};

const nameStyle: React.CSSProperties = {
  fontFamily: 'var(--mono)',
  fontSize: 10,
  fontWeight: 600,
  display: 'block',
};

const traitStyle: React.CSSProperties = {
  fontSize: 10.5,
  color: 'var(--ink-soft)',
  display: 'block',
  maxWidth: '14ch',
  margin: '2px auto 0',
};

function Creature({ svg }: { svg: string }) {
  return <span dangerouslySetInnerHTML={{ __html: svg }} />;
}

export default function Harness() {
  return (
    <main style={{ padding: '40px 0 64px' }}>
      <div className="wrap">
        <span className="eyebrow">Component harness · engine v2</span>
        <h1>Species × lifecycle matrix</h1>
        <p className="sub">
          Every species at every stage, rendered by <code>@nibbin/creatures</code> — the TypeScript
          port of the creature lab. One engine renders everything.
        </p>

        <div className="card" style={{ overflowX: 'auto', marginTop: 24 }}>
          <table style={{ borderCollapse: 'collapse', width: '100%' }}>
            <thead>
              <tr>
                <th style={thStyle}>Species</th>
                {STAGES.map((st) => (
                  <th key={st} style={thStyle}>
                    {STAGE_LABEL[st]}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {USER_SPECIES.map((sp, i) => (
                <tr key={sp}>
                  <td style={cellStyle}>
                    <span style={nameStyle}>{sp}</span>
                    <span style={traitStyle}>{SPECIES[sp].trait}</span>
                  </td>
                  {STAGES.map((st) => (
                    <td key={st} style={cellStyle}>
                      <Creature
                        svg={buildCreature({
                          species: sp,
                          stage: st,
                          color: PALETTES[i % PALETTES.length]!.c,
                          acc: 'none',
                          mark: 'none',
                          size: 80,
                        })}
                      />
                    </td>
                  ))}
                </tr>
              ))}
              <tr>
                <td style={cellStyle}>
                  <span style={nameStyle}>Keeper</span>
                  <span style={traitStyle}>canonical — the brand Nibbin</span>
                </td>
                <td style={cellStyle} colSpan={4}>
                  <Creature svg={buildCreature({ species: 'Keeper', size: 96 })} />
                  <div style={{ fontFamily: 'var(--mono)', fontSize: 9.5, color: 'var(--ink-soft)', marginTop: 4 }}>
                    one form, every account, fixed moss &amp; honey — never palette-shifted, never capped
                  </div>
                </td>
              </tr>
            </tbody>
          </table>
        </div>

        <h2 style={{ marginTop: 44 }}>Accessories</h2>
        <p className="sub" style={{ margin: '6px 0 16px' }}>
          Senior Sprout wearing each of the seven accessories.
        </p>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          {ACCS.map((acc) => (
            <div key={acc} className="card" style={{ padding: '10px 6px 8px', textAlign: 'center', minWidth: 104 }}>
              <Creature svg={buildCreature({ species: 'Sprout', stage: 'senior', color: PALETTES[0]!.c, acc, size: 80 })} />
              <span style={{ ...nameStyle, color: 'var(--ink-soft)', marginTop: 2 }}>{acc}</span>
            </div>
          ))}
        </div>

        <h2 style={{ marginTop: 44 }}>Markings</h2>
        <p className="sub" style={{ margin: '6px 0 16px' }}>
          Senior Longear with each marking.
        </p>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          {MARKS.map((mark) => (
            <div key={mark} className="card" style={{ padding: '10px 6px 8px', textAlign: 'center', minWidth: 104 }}>
              <Creature svg={buildCreature({ species: 'Longear', stage: 'senior', color: PALETTES[3]!.c, mark, size: 80 })} />
              <span style={{ ...nameStyle, color: 'var(--ink-soft)', marginTop: 2 }}>{mark}</span>
            </div>
          ))}
        </div>

        <h2 style={{ marginTop: 44 }}>Palettes</h2>
        <p className="sub" style={{ margin: '6px 0 16px' }}>
          Student Puff in every palette.
        </p>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          {PALETTES.map((p) => (
            <div key={p.n} className="card" style={{ padding: '10px 6px 8px', textAlign: 'center', minWidth: 104 }}>
              <Creature svg={buildCreature({ species: 'Puff', stage: 'student', color: p.c, size: 80 })} />
              <span style={{ ...nameStyle, color: 'var(--ink-soft)', marginTop: 2 }}>{p.n}</span>
            </div>
          ))}
        </div>
      </div>
    </main>
  );
}
