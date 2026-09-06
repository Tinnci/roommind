# Control and Device Guide

This page explains the RoomMind control settings and the related device options.

## Requests, observations, and accuracy

RoomMind's regular Control Cycle runs every 30 seconds. Room temperature and climate output observations are captured before any room receives commands. The room page separates the requested mode and output from the observed device mode. Missing or conflicting device feedback is shown as unknown; a failed dispatch is reported separately.

A requested percentage is a control signal, not measured electrical or thermal power. A completed Home Assistant service call, or a skipped repeat command, does not prove physical application. Learning uses device output observations; missing feedback pauses normal thermal learning instead of inferring heating from a setpoint gap. Devices reporting only a mode/setpoint may therefore remain in fallback control. Observed heating/cooling is currently a binary activity signal, not a calibrated compressor-capacity measurement.

## Rapid recovery and quiet hours

`Room configuration -> Comfort & night -> Advanced control constraints` contains the rapid-recovery switch and temperature-gap threshold. With a trained model, recovery increases the optimizer's preference for restoring comfort. It does not replace the optimizer's result with full output or restart a direction the controller disallowed. Predictive braking, window pauses, outdoor restrictions, and compressor protection remain effective.

With fallback on/off control, recovery can request stronger circulation while the controller requests heating or cooling. Quiet-hour fan limits still apply, including when recovery at night is enabled. Circulation and ventilation remain separate controls; recovery does not automatically maximize outdoor-air ventilation.

## Limiting Overdrive

For a proportional device, `Devices -> Maximum setpoint offset` caps the device setpoint beyond the room target: heating uses at most `heat target + offset`, cooling at least `cool target - offset`. For example, a 21°C heating target with a 2°C offset permits at most 23°C on the device. Device steps round toward the permitted range; an incompatible device range is reported as unsupported.

Set the offset to 0 to send the room target, or leave it empty to preserve the existing device-range behavior. This limit bounds the command, not physical room-temperature overshoot. Thermal inertia, delayed feedback, and a device's internal controller can still cause overshoot. Existing installations retain their previous setpoint behavior until an offset is configured.

## What the Priority Slider Does

In `Settings -> Control -> Priority`, the slider balances comfort against runtime/energy use for MPC.

- Toward `Comfort`: RoomMind reacts earlier and works harder to stay close to the target temperature.
- Toward `Efficiency`: RoomMind allows more drift around the target to reduce heating/cooling runtime.

This setting does **not** change your schedule targets, overrides, comfort temperature, or eco temperature. It only changes how aggressively MPC tries to reach and hold those targets.

## Thermostat vs Climate Device

Both options are Home Assistant `climate.*` entities, but RoomMind treats them differently:

- `Thermostat`: a radiator thermostat / TRV style device.
- `Climate Device`: an AC, heat pump, or other climate entity used for cooling or forced-air heating.

In practice:

- Choose `Thermostat` for radiator valves and similar heating-only valve devices.
- Choose `Climate Device` for ACs, minisplits, heat pumps, and other self-contained HVAC units.

## Full Control vs Managed

An external room temperature sensor is the key split:

- `Full Control`: RoomMind uses the external sensor as the room truth and can actively shape device output.
- `Managed`: without an external room sensor, RoomMind sends target temperatures but the device mostly regulates itself using its own internal sensor.

This matters for the options below.

## Setpoint Mode: Proportional vs Direct

`Setpoint mode` is relevant for thermostat/TRV devices in `Full Control` rooms.

### Proportional

RoomMind calculates the required heating power, then sends a boosted device setpoint to achieve roughly that output.

Example:

- room target is `21°C`
- more heat is needed
- RoomMind can send `26-28°C` to the TRV to force the valve open harder

Best for:

- radiator valves / TRVs
- devices that need an exaggerated setpoint to deliver heat

### Direct

RoomMind sends the real target temperature and lets the device regulate itself.

Best for:

- space heaters
- pellet stoves
- devices with their own thermostat logic that stays in control internally

## Idle Behavior: Off, Fan Only, Setback

`When idle` applies to `Climate Device` entries.

### Turn off

RoomMind turns the device off. If the device does not support a true off state, RoomMind uses the device's minimum or off-like behavior.

### Fan only

RoomMind keeps the device running in fan mode without active heating/cooling.

Useful when you want:

- air circulation
- less harsh on/off transitions

### Setback

RoomMind keeps the current HVAC mode active, but moves the target away from the room target:

- heating setback = `heat target - 2°C`
- cooling setback = `cool target + 2°C`

This lets the device back off instead of shutting off completely.

Important:

- the setback offset is fixed at `2°C`
- it is **not configurable** in the current UI

## Idle Behavior for Thermostats: Off, Low

`When idle` also applies to `Thermostat` / TRV entries, with different options.

### Turn off

RoomMind sends the TRV to its `off` state.

### Low

RoomMind keeps the TRV in its current heating mode but lowers the setpoint to the device's minimum temperature.

Useful for battery-powered Zigbee TRVs that enter deep sleep when set to `off` and then stop reacting to commands. `Low` keeps the valve responsive while effectively stopping heating.

## Smart Source Selection

`Smart source selection` only appears when a room has:

- at least one `Thermostat` / TRV
- at least one `Climate Device` / AC
- an external temperature sensor

In that case RoomMind can decide which source should heat:

- TRV / boiler side
- AC / heat pump side
- or both, when the gap is large

It uses temperature gap and outdoor conditions to make that choice.
