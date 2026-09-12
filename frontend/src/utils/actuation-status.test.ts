import { describe, expect, it } from "bun:test";
import {
  actuationFeedback,
  nightControlFeedback,
  summarizeNightControls,
} from "./actuation-status";
import type { DeviceActuationStatus } from "../types";

describe("device command feedback", () => {
  const operation: DeviceActuationStatus = {
    entity_id: "climate.ac",
    service: "set_temperature",
    desired: { temperature: 22 },
    dispatch: "sent",
    acceptance: "unknown",
    application: "pending",
  };

  it("keeps sending, transport acceptance and physical confirmation distinct", () => {
    expect(actuationFeedback(operation)).toBe("sent");
    expect(actuationFeedback({ ...operation, acceptance: "accepted" })).toBe("accepted");
    expect(actuationFeedback({ ...operation, application: "confirmed" })).toBe("confirmed");
    expect(actuationFeedback({ ...operation, application: "not_confirmed" })).toBe("not_confirmed");
  });

  it("never promotes failed, deferred or skipped work using a confirmation flag", () => {
    for (const dispatch of ["failed", "unsupported", "deferred", "skipped"] as const) {
      expect(actuationFeedback({ ...operation, dispatch, application: "confirmed" })).toBe(
        dispatch,
      );
    }
  });
});

describe("night accessory feedback", () => {
  it("keeps failed and unsupported accessories visible despite older confirmation", () => {
    for (const outcome of ["failed", "unsupported", "skipped"] as const) {
      expect(
        nightControlFeedback({
          entity_id: "switch.beep",
          role: "beeper",
          active: true,
          outcome,
          dispatch: "sent",
          application: "confirmed",
        }),
      ).toBe(outcome);
    }
    expect(
      nightControlFeedback({
        entity_id: "switch.beep",
        role: "beeper",
        active: true,
        outcome: "unavailable",
        application: "confirmed",
      }),
    ).toBe("unknown");
  });

  it("keeps pending accessory acceptance separate from an observed match", () => {
    const status = {
      entity_id: "switch.beep",
      role: "beeper",
      active: true,
      outcome: "pending",
      dispatch: "sent" as const,
      acceptance: "accepted" as const,
      application: "pending" as const,
    };
    expect(nightControlFeedback(status)).toBe("accepted");
    expect(nightControlFeedback({ ...status, application: "confirmed" })).toBe("confirmed");
    expect(nightControlFeedback({ ...status, outcome: "observed" })).toBe("observed");
  });

  it("counts observed or confirmed settings separately from dispatch", () => {
    const configs = ["observed", "sent", "confirmed", "legacy"].map((id) => ({
      entity_id: `switch.${id}`,
    }));
    const statuses = configs.map((config, index) => ({
      ...config,
      role: "beeper",
      active: true,
      outcome: ["observed", "sent", "pending", "applied"][index]!,
      dispatch: "sent" as const,
      application: index === 2 ? ("confirmed" as const) : ("pending" as const),
    }));

    expect(summarizeNightControls(configs, statuses)).toEqual({
      total: 4,
      observed: 2,
      pending: 1,
    });
  });

  it("does not count disabled controls or stale failed confirmation", () => {
    expect(
      summarizeNightControls(
        [{ entity_id: "switch.beep", enabled: false }, { entity_id: "switch.led" }],
        [
          { entity_id: "switch.beep", role: "beeper", active: true, outcome: "observed" },
          {
            entity_id: "switch.led",
            role: "display",
            active: true,
            outcome: "unavailable",
            application: "confirmed",
          },
        ],
      ),
    ).toEqual({ total: 1, observed: 0, pending: 0 });
  });
});
