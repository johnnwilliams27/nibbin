import { appSession } from "../../../lib/auth/app-session";
import { AppShell } from "../../../components/shell/AppShell";
import { HelpHub } from "../../../components/help/HelpHub";
import { HELP_CONTENT } from "../../../lib/help/content";
import { CONNECTORS } from "../../../lib/connections/catalog";
import { getChecklistState } from "../../../lib/help/checklist";

export const dynamic = "force-dynamic";

export default async function HelpPage() {
  const { supabase, user, accountId } = await appSession();
  const checklist = await getChecklistState(supabase, accountId);
  return (
    <AppShell active="help" title="Help & Getting Started" email={user.email ?? undefined}>
      <HelpHub content={HELP_CONTENT} connectors={CONNECTORS} checklist={checklist} />
    </AppShell>
  );
}
