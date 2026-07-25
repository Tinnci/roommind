# RoomMind Climate Control

RoomMind turns room configuration and live Home Assistant observations into coordinated climate decisions and forecasts.

## Language

**Effective Target Plan**:
A per-room snapshot of current heat/cool targets and their future resolver after presence, schedule, mold-prevention, and night policies are composed.
_Avoid_: Raw targets, target forecast

**Control Cycle**:
One coordinator pass that observes a room, prepares its effective target plan, applies constraints and commands, and records the outcome.
_Avoid_: Refresh, update loop

**Target Forecast**:
The time series produced by evaluating an effective target plan for analytics or predictive control.
_Avoid_: Effective target plan

## Relationships

- A **Control Cycle** prepares exactly one **Effective Target Plan** per room.
- An **Effective Target Plan** supplies immediate targets and can produce one or more **Target Forecasts**.
- Analytics prepares an **Effective Target Plan** from current observations before producing a **Target Forecast**.
- A **Target Forecast** never changes the **Effective Target Plan** that produced it.

## Example dialogue

> **Dev:** "Should Analytics rebuild the room's schedule and mold rules?"
> **Domain expert:** "No — Analytics asks for an **Effective Target Plan** and evaluates it to produce its **Target Forecast**."

## Flagged ambiguities

- "target" previously meant configured comfort values, effective current values, and forecast points; use **Effective Target Plan** for composed policy and **Target Forecast** for evaluated future points.
