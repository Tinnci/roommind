# Observer and Airflow Guide

This guide documents the Home Assistant state metadata and airflow signals that RoomMind uses for room observation and comfort control.

## HA State Freshness

RoomMind reads live entity state through `hass.states.get(entity_id)`.

For observation age, prefer timestamps in this order:

1. A field's explicit `observed_at` attribute. Climate inputs can provide
   `current_temperature_observed_at` or `current_humidity_observed_at`.
2. `State.last_reported`: the entity reported a state, even if the value did not change.
3. `State.last_updated`: state attributes or the state value changed.
4. `State.last_changed`: only the state value changed.

This matters for stable temperature sensors. A sensor can keep reporting `20.5 C`
for a long time; `last_changed` can look old even though the sensor is healthy.
Conversely, an integration can republish a cached reading when only brightness
changes. A field timestamp takes precedence in that case. Without explicit
provenance, `last_reported` remains the preferred HA timestamp.

Malformed, timezone-free or future explicit timestamps are unusable; they do not
fall back to HA publication time. Non-finite values are rejected. Temperature
selection, humidity fusion and temperature fusion exclude readings aged 300 seconds
or more. A dropout cache expires 300 seconds after the original report, so repeated
reads or later unavailability cannot extend it. A fresh auxiliary can replace an
expired primary; old humidity is not retained as a fallback measurement.

温湿度以逐字段观测时间为准。部分设备更新不会刷新其他字段，缓存期限从原始报告起算。
参见 [M1 观测链分析](zm1-observation-chain.md)中的实机证据与驱动属性说明。

RoomMind exposes the selected source as `freshness_source` and the computed age as `age_s` in live diagnostics.

## Temperature Fusion

Configured temperature channels produce `TemperatureObservation` values for the EKF.

Each observation carries:

- raw temperature value
- variance
- primary or auxiliary role
- age in seconds
- `last_reported`, `last_updated`, and `last_changed`
- explicit `observed_at` and its source when the integration provides them

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

The HVAC output summary distinguishes measured electrical power from estimated fan power and unknown compressor load. See [AC Observation and Control](ac-observation-and-control.md) for the interpretation rules and feedback-gap behavior.
