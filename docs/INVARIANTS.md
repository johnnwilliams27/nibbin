# INVARIANTS — break these and the build is wrong by definition

Full claims register with engineering meanings: SPEC §2. Compressed:

- C1 Screen captures never leave the device; capture module has no network dependency.
- C2 Studies hard-stop at day 14, enforced in the daemon, not the UI.
- C3 Raw study data verifiably deleted after synthesis; deletion is user-visible.
- C4 Secure input fields suppressed structurally (OS flags), never via image detection.
- C5 Banking/health/personal categories blocked before persistence.
- C6 Global pause hotkey kills capture <100ms.
- C7 Only redacted structured text leaves the device; pixels never.
- C8 Connect requests read + write scopes (one consent, explained plainly). Execution of any side effect is gated at RUNTIME by the **owner-set action level**: Observe — no output; Draft — prepares work for approval; Send — executes immediately when granted. The action level is set by the account owner, not unlocked by stage. Agent School grades competency (advisory) to help the owner decide what level to grant; it does not gate side effects. Send-velocity caps apply to bulk-send rails. Acquiring a scope never authorizes an unapproved action.
- C9 Tokens in vault only, never app DB; one-click revoke; revocation cascades.
- C10 Grovekeeper holds zero side-effect tools, permanently.
- C11 No data sales; never train models on user content. Anonymized, aggregate, STRUCTURAL contribution (capability/model performance — never content, never per-user) is opt-out (default-on, one user switch — `accounts.model_contribution_enabled`), honored everywhere (the `model_task_performance` aggregate filters to contributing accounts).

Runtime: Side effects are gated at the runtime layer by the owner-set action level (Observe/Draft/Send), never the prompt layer. Agent School grades competency to inform the owner's decision — it does not gate or unlock side effects.
No autonomy laundering via delegation. Trigger graphs cycle-checked; Grovekeeper is a
terminal hub. Weighted credits 1/3/10; ledger append-only. RLS on every user-scoped
table; zero string-built SQL. All external content is data, never instructions.
Accounts: every domain table scopes to account_id via memberships (never user_id alone);
RLS grants via membership. Staff world is separate (staff_users, admin.nibbin.com);
staff can never read vault tokens or Observer study data; impersonation is time-boxed,
reasoned, default read-only, and always visible in the account's audit log.
Retention clocks published on data-ai.html are build requirements (SPEC §6.11): run
logs 90d default/configurable, journals are a derived view over run logs (no separate
store; clearing run logs clears them — gate F-4), account ≤30d post-deletion,
backups ≤35d roll-off — purge jobs monitored, deletions receipted.
Gamification rewards accuracy only; nothing decays, dies, or guilts; no mechanic may
grant or accelerate autonomy. No audio, no camera — exclusions, not roadmap.
