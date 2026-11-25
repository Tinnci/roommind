import { describe, expect, test } from "bun:test";
import {
  getComfortDelta,
  getObservedMode,
  isRoomMindEntity,
  isTemperatureCached,
  resolveRoomModePresentation,
} from "./room-state";

describe("room observation presentation", () => {
  test("renaming a room entity does not turn it into a physical input", () => {
    expect(
      isRoomMindEntity("climate.bedroom", { "climate.bedroom": { platform: "roommind" } }),
    ).toBe(true);
    expect(isRoomMindEntity("climate.roommind_bedroom_comfort")).toBe(true);
    expect(isRoomMindEntity("climate.ac", { "climate.ac": { platform: "tcl_udp_ac" } })).toBe(
      false,
    );
  });
  test("a room inside its heat/cool range is comfortable even when the active target is the heat boundary", () => {
    const live = { current_temp: 23, target_temp: 21, heat_target: 21, cool_target: 24 };
    expect(getComfortDelta(live, "auto")).toBe(0);
    expect(getComfortDelta({ ...live, current_temp: 25 }, "auto")).toBe(1);
    expect(getComfortDelta({ ...live, current_temp: 20 }, "auto")).toBe(-1);
    expect(getComfortDelta({ ...live, current_temp_raw: null }, "auto")).toBeNull();
  });

  test("comfort comparison uses the configured perceived-temperature target", () => {
    expect(
      getComfortDelta(
        {
          current_temp: 25,
          perceived_temp: 23,
          effective_control_target: "perceived_temperature",
          target_temp: 24,
          heat_target: 21,
          cool_target: 24,
        },
        "auto",
      ),
    ).toBe(0);
  });
  test("unknown physical activity overrides a legacy display mode", () => {
    expect(getObservedMode({ mode: "cooling", observation_status: "unknown" })).toBeNull();
    expect(getObservedMode({ mode: "heating", observed_mode: null })).toBeNull();
    expect(getObservedMode(undefined)).toBeNull();
  });

  test("the observation wins over requested or legacy display activity", () => {
    expect(getObservedMode({ mode: "cooling", observed_mode: "idle" })).toBe("idle");
    expect(getObservedMode({ mode: "heating" })).toBe("heating");
  });

  test("only explicit missing raw feedback marks a retained temperature as cached", () => {
    expect(isTemperatureCached({ current_temp: 24, current_temp_raw: null })).toBe(true);
    expect(isTemperatureCached({ current_temp: 24, current_temp_raw: 24 })).toBe(false);
    expect(isTemperatureCached({ current_temp: null, current_temp_raw: null })).toBe(false);
    expect(isTemperatureCached({ current_temp: 24 })).toBe(false);
  });

  test("distinguishes confirmed mode-only devices from offline, assumed, conflict, and waiting", () => {
    expect(
      resolveRoomModePresentation({ mode: "heating", observation_status: "observed" }),
    ).toEqual({ mode: "heating", source: "observed", labelKey: "mode.heating" });

    expect(
      resolveRoomModePresentation({
        mode: "idle",
        observation_status: "unknown",
        device_observations: [
          {
            entity_id: "climate.ac_2",
            available: true,
            assumed_state: false,
            hvac_mode: "heat",
            temperature: 28,
            target_temp_low: null,
            target_temp_high: null,
          },
        ],
      }),
    ).toEqual({
      mode: "heating",
      source: "mode_only",
      labelKey: "mode.heating_mode",
      hintKey: "hero.mode_only_hint",
    });

    expect(
      resolveRoomModePresentation({
        mode: "idle",
        observation_status: "unknown",
        device_observations: [
          {
            entity_id: "climate.ac_2",
            available: true,
            assumed_state: false,
            hvac_mode: "cool",
            temperature: 24,
            target_temp_low: null,
            target_temp_high: null,
          },
        ],
      }),
    ).toMatchObject({ mode: "cooling", source: "mode_only", labelKey: "mode.cooling_mode" });

    expect(
      resolveRoomModePresentation({
        mode: "idle",
        observation_status: "unknown",
        device_observations: [
          {
            entity_id: "climate.ac_2",
            available: true,
            assumed_state: false,
            hvac_mode: "auto",
            temperature: 22,
            target_temp_low: null,
            target_temp_high: null,
          },
        ],
      }),
    ).toMatchObject({ mode: "idle", source: "mode_only", labelKey: "mode.auto_mode" });

    expect(
      resolveRoomModePresentation({
        mode: "idle",
        observation_status: "unknown",
        device_observations: [
          {
            entity_id: "climate.ac_1",
            available: true,
            assumed_state: false,
            hvac_mode: "heat",
            temperature: 25,
            target_temp_low: null,
            target_temp_high: null,
          },
          {
            entity_id: "climate.ac_2",
            available: true,
            assumed_state: false,
            hvac_mode: "cool",
            temperature: 22,
            target_temp_low: null,
            target_temp_high: null,
          },
        ],
      }),
    ).toMatchObject({ mode: null, source: "conflict", labelKey: "hero.output_conflict" });

    expect(
      resolveRoomModePresentation({
        mode: "idle",
        observation_status: "unknown",
        device_observations: [
          {
            entity_id: "climate.ac_2",
            available: false,
            assumed_state: false,
            hvac_mode: null,
            temperature: null,
            target_temp_low: null,
            target_temp_high: null,
          },
        ],
      }),
    ).toMatchObject({ mode: null, source: "offline", labelKey: "hero.device_offline" });

    expect(
      resolveRoomModePresentation({
        mode: "idle",
        observation_status: "unknown",
        device_observations: [
          {
            entity_id: "climate.ir_ac",
            available: true,
            assumed_state: true,
            hvac_mode: "heat",
            temperature: 25,
            target_temp_low: null,
            target_temp_high: null,
          },
        ],
      }),
    ).toMatchObject({ mode: null, source: "assumed", labelKey: "hero.assumed_state" });

    expect(
      resolveRoomModePresentation({ mode: "idle", observation_status: "unknown" }),
    ).toMatchObject({ mode: null, source: "waiting", labelKey: "hero.output_unknown" });
  });
});
