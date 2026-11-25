import { describe, expect, it } from "bun:test";
import { buildTimelineModel, formatMinutesHhmm } from "./schedule-timeline";

describe("schedule-timeline", () => {
  it("merges schedule blocks and phased sleep setbacks across 24 hours", () => {
    const model = buildTimelineModel({
      weekday: "monday",
      nowMinutes: 22 * 60 + 45, // inside pre_warm
      blocks: [{ from: "07:00:00", to: "23:00:00", data: { temperature: 21.5 } }],
      climateMode: "heat_only",
      comfortHeat: 21.0,
      comfortCool: 24.0,
      ecoHeat: 17.5,
      ecoCool: 27.0,
      nightModeEnabled: true,
      quietHours: { start: "23:00", end: "07:00" },
      prewarmMinutes: 30,
      prewakeMinutes: 30,
      sleepRampC: 0.5,
      coupledOffsetC: 1.5,
      sleepDevice: { power_entity: "switch.blanket", prewarm_gear_a: 5, sleep_gear_a: 2 },
      maxFanLevelNight: 0.3,
    });

    expect(model.sleepSegments.map((s) => `${s.phase}:${s.startMin}-${s.endMin}`)).toEqual([
      "sleep:0-390",
      "pre_wake:390-420",
      "pre_warm:1350-1380",
      "sleep:1380-1440",
    ]);

    // Deep sleep (00:00-06:30) drops Eco 17.5 by 2.0C (ramp 0.5 + coupled 1.5) -> 15.5C
    expect(model.airSegments[0]?.targetC).toBe(15.5);
    expect(model.airSegments[0]?.coupledOffsetApplied).toBe(true);
    // Pre-wake (06:30-07:00) lifts ramp cleanly
    expect(model.airSegments[1]?.sleepPhase).toBe("pre_wake");
    expect(model.airSegments[1]?.targetC).toBe(17.5);
    // Day schedule (07:00-22:30) holds 21.5C
    expect(model.airSegments[2]?.targetC).toBe(21.5);
    // Pre-warm (22:30-23:00) prepares bed without premature cooling setback
    expect(model.currentSegment?.sleepPhase).toBe("pre_warm");
    expect(model.currentSegment?.targetC).toBe(21.5);
    expect(model.nextTransition?.minute).toBe(1380);
    expect(model.nextTransition?.inMinutes).toBe(15);
    expect(formatMinutesHhmm(1380)).toBe("23:00");
  });
});
