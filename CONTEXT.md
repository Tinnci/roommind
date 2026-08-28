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

**Room Configuration**:
The normalized, persistence-compatible definition of a room's sensors, climate devices, targets, schedules, covers, and control preferences.
_Avoid_: Draft, live room state

**Control Intent**:
The device-independent heating, cooling, airflow, or idle effect requested by one Control Cycle.
_Avoid_: Command, applied state

**Actuation Plan**:
The device-specific desired states produced after a Control Intent passes through routing, capability, and protection constraints.
_Avoid_: Service calls, command list

**Actuation Evidence**:
Facts about dispatch, transport acceptance, device application, and later observation for one planned device state.
_Avoid_: Success flag, commanded state

**Control Outcome**:
The Control Intent, Actuation Plan, and available Actuation Evidence retained as the result of one Control Cycle.
_Avoid_: Coordinator state, command result

## Relationships

- A **Room Configuration** supplies the durable policy inputs for each **Control Cycle**.
- A **Control Cycle** prepares exactly one **Effective Target Plan** per room.
- An **Effective Target Plan** supplies immediate targets and can produce one or more **Target Forecasts**.
- Analytics prepares an **Effective Target Plan** from current observations before producing a **Target Forecast**.
- A **Target Forecast** never changes the **Effective Target Plan** that produced it.
- A **Control Cycle** produces one or more **Control Intents** from its Effective Target Plans.
- A **Control Intent** produces an **Actuation Plan** only after global and device constraints are applied.
- An **Actuation Plan** accumulates **Actuation Evidence** without blocking the next Control Cycle.
- A **Control Outcome** never treats dispatch alone as proof that a device applied an Actuation Plan.

## Example dialogue

> **Dev:** "Should Analytics rebuild the room's schedule and mold rules?"
> **Domain expert:** "No — Analytics asks for an **Effective Target Plan** and evaluates it to produce its **Target Forecast**."

> **Dev:** "The Home Assistant call returned, so is the room heating?"
> **Domain expert:** "Not necessarily — the **Control Intent** was dispatched, but the **Control Outcome** needs **Actuation Evidence** before treating heating as a physical fact."

## Flagged ambiguities

- "target" previously meant configured comfort values, effective current values, and forecast points; use **Effective Target Plan** for composed policy and **Target Forecast** for evaluated future points.
- "applied" previously meant both a completed Home Assistant call and a device-confirmed state; use **Actuation Evidence** to state which fact is known.
