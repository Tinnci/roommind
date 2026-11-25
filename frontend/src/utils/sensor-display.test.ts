import { describe, expect, it } from "bun:test";
import type { HomeAssistant, SensorFusionStatus } from "../types";
import {
  formatSensorAge,
  formatSensorValue,
  freshnessSourceLabel,
  isGlobalSensorCandidate,
  resolveSensorHealth,
} from "./sensor-display";

function makeHass(
  states: Record<string, { state: string; attributes?: Record<string, unknown> }>,
): HomeAssistant {
  return {
    language: "en",
    config: { unit_system: { temperature: "°C" } },
    entities: {},
    states,
  } as unknown as HomeAssistant;
}

describe("sensor-display helpers", () => {
  it("formats ages across seconds, minutes, and hours", () => {
    expect(formatSensorAge(-5)).toBe("0s");
    expect(formatSensorAge(42)).toBe("42s");
    expect(formatSensorAge(180)).toBe("3m");
    expect(formatSensorAge(7200)).toBe("2h");
  });

  it("formats sensor and climate temperature/humidity values and handles unavailable states", () => {
    const hass = makeHass({
      "sensor.temp": { state: "21.46" },
      "sensor.hum": { state: "55.6" },
      "sensor.bad": { state: "unavailable" },
      "climate.ac": { state: "heat", attributes: { current_temperature: 20.25 } },
    });
    expect(formatSensorValue(hass, "sensor.temp", "temp")).toBe("21.5°C");
    expect(formatSensorValue(hass, "sensor.hum", "humidity")).toBe("56%");
    expect(formatSensorValue(hass, "sensor.bad", "temp")).toBe("");
    expect(formatSensorValue(hass, "climate.ac", "temp")).toBe("20.3°C");
  });

  it("resolves health from fusion diagnostics or state fallback and maps source labels", () => {
    const hass = makeHass({
      "sensor.stale": { state: "unavailable" },
      "sensor.ok": { state: "21.0" },
    });
    const fusion = [
      { entity_id: "sensor.temp", freshness_status: "aging" },
    ] as unknown as SensorFusionStatus[];

    expect(resolveSensorHealth(hass, fusion, "sensor.temp").className).toBe("aging");
    expect(resolveSensorHealth(hass, fusion, "sensor.stale").className).toBe("unavailable");
    expect(resolveSensorHealth(hass, fusion, "sensor.ok").className).toBe("fresh");
    expect(freshnessSourceLabel("observed_at", "en")).toBeTruthy();
  });

  it("filters global sensor candidates accurately", () => {
    const hass = makeHass({
      "sensor.temp": { state: "21.0", attributes: { device_class: "temperature" } },
      "sensor.power": { state: "50", attributes: { device_class: "power" } },
      "binary_sensor.win": { state: "off", attributes: { device_class: "window" } },
      "climate.ac": { state: "cool", attributes: { current_temperature: 23 } },
    });
    const configured = {
      temperatureSensor: "sensor.temp",
      temperatureSensors: new Set<string>(),
      humiditySensor: "",
      humiditySensors: new Set<string>(),
      occupancySensors: new Set<string>(),
      windowSensors: new Set<string>(),
    };
    expect(isGlobalSensorCandidate(hass, "sensor.temp", configured)).toBe(false);
    expect(isGlobalSensorCandidate(hass, "sensor.power", configured)).toBe(false);
    expect(isGlobalSensorCandidate(hass, "binary_sensor.win", configured)).toBe(true);
    expect(isGlobalSensorCandidate(hass, "climate.ac", configured)).toBe(true);
  });
});
