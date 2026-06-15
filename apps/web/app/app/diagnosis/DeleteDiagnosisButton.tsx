'use client';

import { Button } from '../../../components/ui';

/**
 * Delete control with a confirm gate. The server action (`deleteDiagnosis`) is
 * passed in as the form action; a native confirm() intercepts submit so a
 * permanent, irreversible delete can't happen on a single stray click. Kept a
 * thin client island so the rest of the detail page stays a server component.
 */
export function DeleteDiagnosisButton({
  id,
  action,
}: {
  id: string;
  action: (formData: FormData) => void | Promise<void>;
}) {
  return (
    <form
      action={action}
      onSubmit={(e) => {
        if (
          !window.confirm(
            'Delete this diagnosis permanently? This removes its map, the Grovekeeper’s letter, and the packet, and cannot be undone.',
          )
        ) {
          e.preventDefault();
        }
      }}
    >
      <input type="hidden" name="id" value={id} />
      <Button type="submit" variant="danger">
        Delete this diagnosis
      </Button>
    </form>
  );
}
