/**
 * Task 14 — showAll.reducer.ts
 *
 * Pure reducer for the Reference catch-all "Show all / Collapse" toggle.
 *
 * State: boolean — true = expanded (all content visible), false = truncated.
 *
 * This is extracted as a pure function so the logic is unit-testable without
 * a DOM (per the plan's "extract interaction logic into pure reducers" mandate).
 *
 * The component applies:
 *  - aria-expanded={state} on the toggle button
 *  - a CSS class that lifts the max-height constraint on the <pre> when expanded
 *
 * CSS (max-height via class) is the mechanism; the global prefers-reduced-motion
 * rule in globals.css collapses the transition duration to near-zero automatically.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ShowAllState = boolean;

export type ShowAllAction = 'toggle' | 'expand' | 'collapse';

// ---------------------------------------------------------------------------
// Reducer
// ---------------------------------------------------------------------------

/**
 * Pure reducer: (state, action) → next state.
 *
 * toggle   — flips the current value
 * expand   — forces expanded (idempotent)
 * collapse — forces collapsed (idempotent)
 */
export function showAllReducer(
  state: ShowAllState,
  action: ShowAllAction,
): ShowAllState {
  switch (action) {
    case 'toggle':
      return !state;
    case 'expand':
      return true;
    case 'collapse':
      return false;
    default:
      // Exhaustiveness guard
      void (action as never);
      return state;
  }
}

/**
 * Initial state: collapsed (truncated) by default.
 * The "Show all" button only appears when content exceeds the threshold;
 * starting collapsed means the button invites expansion.
 */
export const initialShowAllState: ShowAllState = false;
