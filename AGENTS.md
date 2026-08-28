# RoomMind repository guidance

## Control semantics

- Use the domain language in `CONTEXT.md`. Abstractions must introduce precise rules; do not use them merely to hide details.
- Keep the Control Cycle ordered as observe, plan, constrain, submit, reconcile, learn, publish, persist.
- Freeze primary room observations before any room actuation begins. Extend the observation value object when another input must be cycle-consistent instead of adding opportunistic reads inside execution code.
- A Home Assistant service call completing is dispatch evidence, not proof that a physical device accepted or applied the requested state.
- Represent device work as Control Intent -> Actuation Plan -> Actuation Evidence -> Control Outcome. Preserve dispatch, acceptance, application, and later observation as distinct facts.
- Never report a device active when a required operation failed or was unsupported. Keep failed, skipped, sent, accepted, confirmed, and not-confirmed states distinguishable.
- Correlate integration evidence by Home Assistant context ID. Consumers must tolerate evidence arriving before the dispatch record.
- Feed learning and prediction from observed or confirmed physical state. Do not train from requested or merely dispatched state as if it were ground truth.

## Persistence

- Treat mutation plus persistence as one serialized write transaction.
- Pass immutable snapshots to Home Assistant storage; do not expose live internal dictionaries across an await boundary.
- Return copies of stored room, settings, and thermal state rather than mutable internal references.

## Verification

- Add a regression test for each concrete semantic failure before expanding the abstraction.
- Run the full test suite and Ruff after changes to control, coordinator, learning, or persistence behavior.
