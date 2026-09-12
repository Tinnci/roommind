import { describe, expect, it } from "bun:test";
import { summarizeNightControls } from "./actuation-status";

describe("night accessory feedback", () => {
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
