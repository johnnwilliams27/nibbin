'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '../ui';
import { AdoptHatch } from './AdoptHatch';
import type { AdoptOutcome } from './types';

type Appearance = Extract<AdoptOutcome, { ok: true }>;

export function AdoptButton({
  action,
  templateKey,
  label,
  variant = 'primary',
  className,
}: {
  action: (templateKey: string) => Promise<AdoptOutcome>;
  templateKey: string;
  label: string;
  variant?: 'primary' | 'secondary' | 'ghost';
  className?: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [hatch, setHatch] = useState<Appearance | null>(null);

  function adopt() {
    startTransition(async () => {
      const outcome = await action(templateKey);
      if (!outcome.ok) {
        router.push(outcome.redirectTo);
        return;
      }
      setHatch(outcome);
    });
  }

  return (
    <>
      <Button type="button" variant={variant} className={className} onClick={adopt} disabled={pending}>
        {pending ? 'Adopting…' : label}
      </Button>
      {hatch && (
        <AdoptHatch
          name={hatch.name}
          species={hatch.species}
          stage={hatch.stage}
          palette={hatch.palette}
          accessory={hatch.accessory}
          marking={hatch.marking}
          isFirstAdoption={hatch.isFirstAdoption}
          onDismiss={() => router.push(hatch.ctaPath)}
        />
      )}
    </>
  );
}
