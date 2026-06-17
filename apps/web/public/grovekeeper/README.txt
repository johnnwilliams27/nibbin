Drop the authored Rive asset here as:

    grovekeeper.riv

It must expose a state machine named "Keeper" with inputs:
  - blink   (trigger)
  - wave    (trigger)
  - talking (boolean)
  - mood    (number: 0 idle, 1 happy, 2 thinking)

The <Grovekeeper> component (apps/web/components/grovekeeper/Grovekeeper.tsx)
loads /grovekeeper/grovekeeper.riv and drives these. Until the file exists it
falls back to the code-drawn Keeper. Full brief: reference/grovekeeper-asset-brief.md
