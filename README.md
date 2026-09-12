# RoomMind

[![HACS Default](https://img.shields.io/badge/HACS-Default-orange.svg)](https://github.com/hacs/integration)
[![Home Assistant](https://img.shields.io/badge/Home%20Assistant-2026.6%2B-blue.svg)](https://www.home-assistant.io/)
[![License](https://img.shields.io/github/license/snazzybean/roommind)](https://github.com/snazzybean/roommind/blob/main/LICENSE)
[![Tests](https://github.com/snazzybean/roommind/actions/workflows/ci.yml/badge.svg)](https://github.com/snazzybean/roommind/actions/workflows/ci.yml)
![Coverage](https://raw.githubusercontent.com/snazzybean/roommind/python-coverage-comment-action-data/badge.svg)
[![GitHub Release](https://img.shields.io/github/v/release/snazzybean/roommind)](https://github.com/snazzybean/roommind/releases/latest)

[![ko-fi](https://ko-fi.com/img/githubbutton_sm.svg)](https://ko-fi.com/Y8Y31VP2VK)

**Intelligent room climate control for Home Assistant** - self-learning thermal model, proportional valve control, and a dedicated management panel.

![Dashboard](docs/images/page-dashboard.png)

## Features

- **Self-Learning MPC** - Per-room thermal model (Extended Kalman Filter) that learns your home's heating/cooling behavior over time. Automatic fallback to on/off control while learning.
- **Proportional Valve Control** - TRVs receive calculated setpoints instead of simple on/off, producing smoother temperature curves with less overshoot.
- **Solar Gain Awareness** - Estimates solar irradiance from sun position and weather data. The model learns each room's solar response and reduces unnecessary heating.
- **Multi-Scheduler** - Multiple `schedule.*` entities per room with selector switching via `input_boolean` or `input_number`.
- **Manual Override** - Boost, eco, or custom temperature with configurable duration and instant UI feedback.
- **Presence Detection** - Link `person.*`, `device_tracker.*`, `binary_sensor.*`, or `input_boolean.*` entities globally or per room. Eco temperature is used when all assigned persons are away.
- **Ignore Presence per Room** - Rooms can opt out of presence detection to always follow their schedule.
- **Vacation Mode** - Global setback temperature with end date for all rooms.
- **Window/Door Pause** - Pauses climate control when windows or doors are open, with configurable open/close delays.
- **Mold Risk Detection & Prevention** - Surface humidity estimation using the DIN 4108-2 method. Configurable notifications and automatic temperature raise to prevent mold growth.
- **Automatic Blind/Cover Shading** - Smart cover deployment based on predicted solar overheating. Includes night close, manual override detection, and cover schedules.
- **Valve Protection** - Periodic cycling of idle TRV valves to prevent seizing and calcification.
- **Heat Source Orchestration** - Rooms with both TRVs and ACs automatically route heating demand to the most efficient device based on temperature gap and outdoor conditions.
- **Compressor Group Protection** - Define groups of climate devices sharing an outdoor compressor. Enforces minimum run and off times to prevent short-cycling.
- **Fan-only & Setback Idle Modes** - AC and heat pump devices can switch to fan-only or setback mode instead of turning off, keeping air circulation or low-load operation active. Setback offsets are configurable globally or per room from 1–5°C (default 2°C).
- **Airflow-Aware Comfort** - Circulation, ventilation, and HVAC fan devices feed the thermal model, perceived temperature, and sensor disagreement analysis.
- **Multi-Sensor Fusion Diagnostics** - Temperature sensors expose freshness, bias correction, variance, and conflict status in the room interface.
- **Physical Feedback Provenance** - Uses device observation timestamps when available, keeps stale activity unknown, and shares one observation snapshot across planning and learning.
- **Per-Device Setpoint Mode** - Choose proportional (boost setpoint) or direct (exact target) control per device for optimal results with different hardware.
- **Quiet AC Actuation** - Pace small output increases, apply night accessories before climate commands, and keep dispatch, deferred adjustments and physical feedback distinct.
- **Room Comfort Controls** - A dedicated HA comfort entity and a calm room interface separate effective comfort targets, device plans and observed feedback. Expand device details when needed.
- **Separate Heat/Cool Targets** - Independent comfort and eco temperatures for heating and cooling in auto mode, creating a natural dead-band.
- **Per-Room Climate Toggle** - Disable climate control for individual rooms while keeping other rooms active.
- **Outdoor Areas** - Mark rooms as outdoor (e.g. balcony) to disable climate control while keeping monitoring.
- **Analytics Dashboard** - Temperature charts with heating power, solar irradiance, and model predictions over 24h to 90 days.
- **Mobile Ready** - Responsive layout with HA-native toolbar for the companion app.
- **Multilingual** - English, German, and Simplified Chinese, auto-detected from your HA language setting.

## Installation

[![Open your Home Assistant instance and open RoomMind inside HACS.](https://my.home-assistant.io/badges/hacs_repository.svg)](https://my.home-assistant.io/redirect/hacs_repository/?owner=snazzybean&repository=roommind&category=integration)

### HACS (Recommended)

1. Open HACS in Home Assistant
2. Search for "RoomMind" and install
3. Restart Home Assistant
4. Go to **Settings > Devices & Services > Add Integration > RoomMind**

### Manual

1. Copy `custom_components/roommind/` to your `config/custom_components/` directory
2. Restart Home Assistant
3. Go to **Settings > Devices & Services > Add Integration > RoomMind**

## Quick Start

After installation, RoomMind appears as a panel in the HA sidebar.

1. **Open RoomMind** from the sidebar - you'll see all your HA areas as room cards
2. **Click a room card** to open the detail view
3. **Add devices** - assign at least one thermostat or AC (`climate.*` entity)
4. **Add a temperature sensor** (optional but recommended) - enables Full Control with proportional valve control
5. **Add a schedule** - create a `schedule.*` helper in HA and assign it
6. **Set temperatures** - configure comfort (schedule on) and eco (schedule off) temperatures

RoomMind starts controlling immediately. If MPC is enabled (default), the thermal model begins learning in the background.

## Analytics

![Analytics](docs/images/page-analytics.png)

Select a room and time range (24h / 7d / 30d / 90d / custom) to view temperature history, heating/cooling power, solar irradiance, and model predictions. Export as CSV or diagnostics report.

## How It Works

### Target Temperature Priority

```
Manual Override > Vacation > Presence Away > Schedule Block > Comfort / Eco  (+Mold Delta)
```

### Full Control vs. Managed Mode

An external temperature sensor unlocks the full potential of the thermal model, MPC optimization, and proportional device control. It is the single most impactful addition for any room.

| | Full Control | Managed Mode |
|---|---|---|
| **When** | External temperature sensor assigned | No external sensor |
| **How** | RoomMind decides heating/cooling/idle | Device self-regulates |
| **Setpoints** | Proportional device setpoint within configured overdrive limits | Room target adapted to device steps |
| **Thermal model** | EKF learns room behavior, MPC optimizes | No learning, no optimization |

In **Full Control**, RoomMind translates control demand into dynamic device setpoints.
A TRV or AC can receive a higher heating setpoint or lower cooling setpoint than
the room's comfort target, within the configured maximum offset. The device's
actual output is observed separately. Each room shows its current mode ("Full
Control" or "Managed") in the detail view. See [AC Setpoint Planning and Quiet
Control](docs/ac-setpoint-planning.md) for modulation, quiet hours and feedback.

### MPC Climate Control

The Extended Kalman Filter observes temperature changes and learns each room's heat loss rate, heating/cooling power, and solar responsiveness. Once calibrated (prediction accuracy < 0.5 C), the MPC optimizer plans ahead and calculates proportional power for smoother control.

Until calibrated (~60 idle + ~20 active samples), RoomMind falls back to simple on/off control with hysteresis.

For a more detailed explanation of the `Priority` slider, device types, setpoint modes, idle behavior, and smart source selection, see the [Control and Device Guide](docs/control-and-devices.md).

For HA state freshness, sensor fusion, airflow modeling, and comfort diagnostics, see the [Observer and Airflow Guide](docs/observer-and-airflow.md).

For AC output interpretation, feedback gaps, consistent observations, and dispatch evidence, see [AC Observation and Control](docs/ac-observation-and-control.md).

For daily controls, the new comfort climate entity, legacy override compatibility and device feedback, see [Room Comfort and Device Feedback / 房间舒适度与设备反馈](docs/room-comfort-and-feedback.md).

## Entities Created

| Entity | Description |
|--------|-------------|
| `climate.roommind_{area_id}_comfort` | Room comfort target with `schedule` / `hold` presets; `auto` regulation, with observed activity kept separate |
| `switch.roommind_{area_id}_climate_control` | Enable or pause RoomMind's control of the room |
| `sensor.roommind_{area_id}_target_temp` | Current effective room target temperature |
| `sensor.roommind_{area_id}_mode` | Observed activity: `idle`, `heating`, `cooling`, or `fan_only`; unknown without feedback |
| `climate.roommind_{area_id}_override` | Legacy override endpoint; `off` still resumes room policy. Disabled by default for new registrations |
| `switch.roommind_vacation` | Global vacation mode toggle |
| `switch.roommind_{area_id}_cover_auto` | Per-room automatic cover control toggle |
| `binary_sensor.roommind_{area_id}_cover_paused` | On when manual cover override is detected |

These can be used in HA automations, dashboards, or other integrations.

## Troubleshooting

**MPC shows "learning" for a long time** - The model needs ~60 idle and ~20 heating/cooling observations. This can take a few days for rooms that heat rarely. Check progress in the Analytics tab.

**Room not heating/cooling when expected** - Check outdoor gating thresholds in Settings > Control. Default: no cooling below 16 C, no heating above 22 C.

**Thermal model seems wrong after room changes** - If you have changed insulation, radiators, or moved sensors, reset the model in Settings > Reset Thermal Data.

**Frontend not updating after update** - Hard-refresh: **Cmd+Shift+R** (Mac) or **Ctrl+Shift+R** (Windows/Linux).

## Requirements

- **Home Assistant** 2026.6+
- **HACS** custom repository or default listing
- At least one HA area with a `climate.*` entity
- Optional: temperature sensor, humidity sensor, window sensors, weather entity, schedule helpers, person entities

No cloud service is required. Everything runs locally.

## Feedback & Contributing

- 🐛 **Bug reports** - [Open an issue](https://github.com/snazzybean/roommind/issues/new?template=bug_report.yml)
- 💡 **Feature requests & ideas** - [Post in Discussions](https://github.com/snazzybean/roommind/discussions/categories/feature-requests) so the community can vote and discuss
- 🙋 **Questions & usage help** - [Ask in Q&A](https://github.com/snazzybean/roommind/discussions/categories/q-a)
- 📣 **Announcements** - [Follow Announcements](https://github.com/snazzybean/roommind/discussions/categories/announcements)
