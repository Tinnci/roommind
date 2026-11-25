import { describe, expect, it } from "bun:test";
import {
  SETTINGS_SECTIONS,
  filterSettingsSections,
  findSettingsSection,
  getSettingsSectionTone,
} from "./settings-hub";

describe("settings-hub", () => {
  it("contains all 13 global settings sections across categories", () => {
    expect(SETTINGS_SECTIONS).toHaveLength(13);
    expect(filterSettingsSections("all")).toHaveLength(13);
    expect(filterSettingsSections("automation").map((s) => s.id)).toEqual([
      "control",
      "presence",
      "vacation",
      "price",
      "compressor",
    ]);
    expect(filterSettingsSections("hardware").map((s) => s.id)).toEqual([
      "general",
      "sensors",
      "valve",
      "coil_dry",
      "mold",
    ]);
    expect(filterSettingsSections("maintenance").map((s) => s.id)).toEqual([
      "notifications",
      "learning",
      "reset",
    ]);
  });

  it("finds section metadata by id including beta flag", () => {
    expect(findSettingsSection("vacation")?.icon).toBe("mdi:airplane");
    expect(findSettingsSection("notifications")?.isBeta).toBe(true);
  });

  it("resolves section badge tones from global state", () => {
    const baseInput = {
      climateControlActive: true,
      controlMode: "mpc" as const,
      presenceEnabled: true,
      presencePersonsCount: 2,
      vacationActive: false,
      priceEntityConfigured: false,
      valveProtectionEnabled: true,
      coilDryEnabled: false,
      outdoorSensorConfigured: true,
      weatherEntityConfigured: false,
      compressorGroupsCount: 1,
      moldDetectionEnabled: false,
      moldPreventionEnabled: false,
      notificationsEnabled: true,
      learningDisabledCount: 0,
    };

    expect(getSettingsSectionTone("general", baseInput)).toBe("ok");
    expect(getSettingsSectionTone("general", { ...baseInput, climateControlActive: false })).toBe(
      "warning",
    );
    expect(getSettingsSectionTone("control", baseInput)).toBe("accent");
    expect(getSettingsSectionTone("presence", baseInput)).toBe("ok");
    expect(getSettingsSectionTone("presence", { ...baseInput, presencePersonsCount: 0 })).toBe(
      "warning",
    );
    expect(getSettingsSectionTone("vacation", { ...baseInput, vacationActive: true })).toBe(
      "accent",
    );
    expect(
      getSettingsSectionTone("sensors", {
        ...baseInput,
        outdoorSensorConfigured: false,
        weatherEntityConfigured: false,
      }),
    ).toBe("warning");
    expect(getSettingsSectionTone("learning", { ...baseInput, learningDisabledCount: 1 })).toBe(
      "warning",
    );
  });
});
