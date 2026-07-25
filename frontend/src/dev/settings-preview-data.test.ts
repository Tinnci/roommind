import { describe, expect, test } from "bun:test";
import type { GlobalSettings } from "../types";
import { createSettingsPreviewModel } from "./settings-preview-data";

describe("settings preview model", () => {
  test("loads global control settings with horizon optimizer visible to the preview", async () => {
    const model = createSettingsPreviewModel();
    const result = await model.hass.callWS<{ settings: GlobalSettings }>({
      type: "roommind/settings/get",
    });

    expect(result.settings.control_mode).toBe("mpc");
    expect(result.settings.optimizer_strategy).toBe("horizon_search");
    expect(result.settings.compressor_groups?.[0]?.members).toContain("climate.bedroom_ac");
    expect(Object.keys(model.rooms)).toContain("bedroom");
  });

  test("records settings save calls so preview interactions are inspectable", async () => {
    const model = createSettingsPreviewModel();

    await model.hass.callWS({
      type: "roommind/settings/save",
      optimizer_strategy: "greedy",
    });

    expect(model.savedSettings).toHaveLength(1);
    expect(model.savedSettings[0]?.optimizer_strategy).toBe("greedy");
  });
});
