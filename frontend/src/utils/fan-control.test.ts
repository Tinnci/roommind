import { describe, expect, test } from "bun:test";
import type { HomeAssistant, RoomConfig } from "../types";
import {
  buildRoomFanCapabilities,
  fanSpeedBars,
  fanSpeedTone,
  formatFanModeLabel,
} from "./fan-control";

function makeHass(states: HomeAssistant["states"] = {}): HomeAssistant {
  return {
    language: "en",
    states,
    areas: {},
    floors: {},
    entities: {},
    devices: {},
    callWS: (async () => ({})) as HomeAssistant["callWS"],
    callService: async () => undefined,
    config: { unit_system: { temperature: "°C" } },
  };
}

function makeRoom(partial: Partial<RoomConfig> = {}): RoomConfig {
  return {
    area_id: "living",
    thermostats: [],
    acs: [],
    temperature_sensor: "",
    humidity_sensor: "",
    window_sensors: [],
    window_open_delay: 0,
    window_close_delay: 0,
    climate_mode: "cool_only",
    schedules: [],
    schedule_selector_entity: "",
    comfort_heat: 21,
    comfort_cool: 24,
    eco_heat: 17,
    eco_cool: 27,
    ...partial,
  };
}

describe("fan-control", () => {
  test("computes intensity bars and tone consistently across strings and percentages", () => {
    expect(fanSpeedBars("off")).toBe(0);
    expect(fanSpeedBars("quiet")).toBe(1);
    expect(fanSpeedBars("low")).toBe(2);
    expect(fanSpeedBars("medium")).toBe(3);
    expect(fanSpeedBars("high")).toBe(4);
    expect(fanSpeedBars("turbo")).toBe(5);
    expect(fanSpeedBars(80)).toBe(4);

    expect(fanSpeedTone("auto")).toBe("auto");
    expect(fanSpeedTone("quiet")).toBe("calm");
    expect(fanSpeedTone("medium")).toBe("medium");
    expect(fanSpeedTone("turbo")).toBe("strong");
    expect(formatFanModeLabel("turbo", "en")).toBe("Turbo");
    expect(formatFanModeLabel("diffuse_wind", "en")).toBe("Diffuse Wind");
  });

  test("uses exact AC native fan_modes when a room has one AC and no standalone fans", () => {
    const hass = makeHass({
      "climate.living_ac": {
        entity_id: "climate.living_ac",
        state: "cool",
        attributes: {
          friendly_name: "Living AC",
          fan_mode: "quiet",
          fan_modes: ["off", "auto", "quiet", "low", "diffuse", "turbo"],
          swing_modes: ["off", "vertical"],
        },
      },
    });
    const caps = buildRoomFanCapabilities(
      makeRoom({
        devices: [{ entity_id: "climate.living_ac", type: "ac", role: "auto" }],
      }),
      hass,
    );

    expect(caps.hasFanControl).toBe(true);
    expect(caps.roomOptions.map((o) => o.value)).toEqual([
      "auto",
      "quiet",
      "low",
      "diffuse",
      "turbo",
    ]);
    expect(caps.standaloneFans).toEqual([]);
  });

  test("uses canonical tiers when standalone fan.* or multiple AC units exist", () => {
    const hass = makeHass({
      "climate.ac1": {
        entity_id: "climate.ac1",
        state: "cool",
        attributes: { fan_modes: ["low", "high"] },
      },
      "fan.tower": {
        entity_id: "fan.tower",
        state: "on",
        attributes: {
          friendly_name: "Tower Fan",
          percentage: 50,
          percentage_step: 25,
          oscillating: true,
          direction: "forward",
          supported_features: 15,
          preset_modes: ["normal", "breeze"],
        },
      },
    });
    const caps = buildRoomFanCapabilities(
      makeRoom({
        devices: [{ entity_id: "climate.ac1", type: "ac", role: "auto" }],
        airflow_devices: [
          {
            entity_id: "fan.tower",
            role: "circulation",
            controllable: true,
            control_enabled: true,
          },
        ],
      }),
      hass,
    );

    expect(caps.hasFanControl).toBe(true);
    expect(caps.roomOptions.map((o) => o.value)).toEqual([
      "auto",
      "quiet",
      "low",
      "medium",
      "high",
      "turbo",
    ]);
    expect(caps.standaloneFans).toHaveLength(1);
    const [towerFan] = caps.standaloneFans;
    expect(towerFan?.supportsSetSpeed).toBe(true);
    expect(towerFan?.supportsOscillate).toBe(true);
    expect(towerFan?.supportsDirection).toBe(true);
  });
});
