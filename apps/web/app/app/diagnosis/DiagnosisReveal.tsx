import { Badge, Button, Card } from '../../../components/ui';
import type { DiagnosisMap, Frequency } from '../../../lib/diagnosis/types';
import { adoptRecommendation } from './actions';
import styles from './diagnosis.module.css';

/** Shop-template display names + frequency tone/label maps. Shared by the
 *  diagnosis page (newest reveal) and the per-diagnosis detail route. */
export const NIBBIN_NAME: Record<string, string> = {
  sweep: 'Sweep',
  echo: 'Echo',
  brief: 'Brief',
  tally: 'Tally',
  hopper: 'Hopper',
  scribe: 'Scribe',
};
export const FREQ_TONE: Record<Frequency, 'honey' | 'sky' | 'neutral'> = {
  daily: 'honey',
  weekly: 'sky',
  occasional: 'neutral',
};
export const FREQ_LABEL: Record<Frequency, string> = {
  daily: 'Daily',
  weekly: 'Weekly',
  occasional: 'Now and then',
};

/** The hero reveal: the Grovekeeper's letter, the weekly total, the workflow
 *  map ("Where the hours go"), and the adoptable recommendations. Extracted
 *  verbatim from the diagnosis page so the detail route can reuse it. */
export function DiagnosisReveal({ map, letter }: { map: DiagnosisMap; letter: string | null }) {
  return (
    <>
      {letter && (
        <Card className={styles.letterCard}>
          <p className={styles.letterEyebrow}>A letter from the Grovekeeper</p>
          <p className={styles.letter}>{letter}</p>
        </Card>
      )}

      <div className={styles.total}>
        <span className={styles.totalValue}>{map.totalHoursPerWeek}h</span>
        <span className={styles.totalLabel}>
          of routine a week, mapped across {map.workflows.length}{' '}
          {map.workflows.length === 1 ? 'workflow' : 'workflows'}
        </span>
      </div>

      <h2 className={styles.sectionTitle}>Where the hours go</h2>
      <div className={styles.wfList}>
        {map.workflows.map((w) => (
          <Card key={w.key} className={styles.wfCard}>
            <div className={styles.wfHead}>
              <span className={styles.wfName}>{w.label}</span>
              <span className={styles.wfHours}>~{w.hoursPerWeek}h / week</span>
            </div>
            <div className={styles.wfMeta}>
              <Badge tone={FREQ_TONE[w.frequency]}>{FREQ_LABEL[w.frequency]}</Badge>
              <Badge tone="neutral">{w.category}</Badge>
              {(w.automatable ?? 0) > 0 && <Badge tone="sky">~{w.automatable}% automatable</Badge>}
              {w.recommendedNibbin && (
                <Badge tone="moss">{NIBBIN_NAME[w.recommendedNibbin] ?? w.recommendedNibbin} can help</Badge>
              )}
            </div>
            {w.description && <p className={styles.wfDesc}>{w.description}</p>}
            {w.friction && <p className={styles.wfFriction}>{w.friction}</p>}
          </Card>
        ))}
      </div>

      {map.topRecommendations.length > 0 && (
        <>
          <h2 className={styles.sectionTitle}>Ready to take the first slices</h2>
          <div className={styles.wfList}>
            {map.topRecommendations.map((key) => (
              <Card key={key} className={styles.wfCard}>
                <div className={styles.recRow}>
                  <span className={styles.recText}>
                    Adopt <strong>{NIBBIN_NAME[key] ?? key}</strong> to start handling this — drafts
                    only, for your approval, until it earns more.
                  </span>
                  <form className={styles.recForm} action={adoptRecommendation}>
                    <input type="hidden" name="templateKey" value={key} />
                    <Button type="submit" variant="primary">
                      Adopt {NIBBIN_NAME[key] ?? key}
                    </Button>
                  </form>
                </div>
              </Card>
            ))}
          </div>
        </>
      )}
    </>
  );
}
