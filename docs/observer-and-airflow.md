# Observer And Airflow Guide

This guide documents the Home Assistant state metadata and airflow signals that RoomMind uses for room observation and comfort control.

## HA State Freshness

RoomMind reads live entity state through `hass.states.get(entity_id)`.

For observation age, prefer timestamps in this order:

1. `State.last_reported`: the entity reported a state, even if the value did not change.
2. `State.last_updated`: state attributes or the state value changed.
3. `State.last_changed`: only the state value changed.

This matters for stable temperature sensors. A sensor can keep reporting `20.5 C` for a long time; `last_changed` may look old even though the sensor is healthy. `last_reported` is therefore the best freshness signal on current Home Assistant releases.

RoomMind exposes the selected source as `freshness_source` and the computed age as `age_s` in live diagnostics.

## Temperature Fusion

Configured temperature channels produce `TemperatureObservation` values for the EKF.

Each observation carries:

- raw temperature value
- variance
- primary or auxiliary role
- age in seconds
- `last_reported`, `last_updated`, and `last_changed`

Fresh but conflicting sensors are kept visible. Stale or unavailable states are dropped before EKF training. Aging sensors stay usable but receive higher variance, so they contribute less confidence to the fused observation.

The room live payload includes:

- `sensor_conflict`: normalized 0..1 disagreement between active temperature channels
- `sensor_fusion_status`: per-entity value, corrected value, learned bias, variance, age, freshness source, and timestamps

## Airflow Observation

Airflow devices are read from configured fan and climate entities.

RoomMind distinguishes:

- `circulation`: mixes room air and can reduce sensor disagreement
- `ventilation`: exchanges room air with outdoor or adjacent air
- `hvac_fan`: climate-device fan control used for comfort and delivery

The room live payload includes `q_fan_mix`, `q_vent`, `airflow_ach`, `airflow_devices_status`, and `airflow_command_status`.

Airflow status entries also carry HA freshness metadata. This lets future control decisions reduce trust in stale fan or climate state instead of assuming the last observed mode is still true.

## Comfort Control

When `control_target` is `perceived_temperature`, RoomMind evaluates comfort using air temperature, humidity, and mixing airflow. Circulation can reduce perceived heat during cooling, while draft penalties apply during heating.

The thermal model also accepts residual heat, solar exposure, occupancy heat, ventilation, and adjacent-room coupling. Optional inputs are designed to degrade to deterministic defaults when unavailable.

## UI Diagnostics

The Sensors tab shows compact fusion diagnostics:

- primary versus auxiliary role
- corrected temperature
- learned bias
- observation variance
- age and timestamp source
- room-level sensor conflict

Use this view to spot bad sensor placement, stale HA entities, or cases where airflow mixing explains a temporary temperature spread.
