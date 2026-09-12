import type { NightControlConfig, NightControlStatus } from "../types";

export function summarizeNightControls(
  configs: NightControlConfig[],
  statuses: NightControlStatus[],
): { total: number; observed: number; pending: number } {
  const enabled = new Set(
    configs.filter((config) => config.enabled !== false).map((config) => config.entity_id),
  );
  const current = [
    ...new Map(statuses.map((status) => [status.entity_id, status])).values(),
  ].filter((status) => enabled.has(status.entity_id));
  const observed = current.filter(
    (status) =>
      status.outcome === "observed" ||
      (status.application === "confirmed" && ["sent", "pending"].includes(status.outcome)),
  ).length;
  const pending = current.filter(
    (status) =>
      status.dispatch === "sent" &&
      status.application !== "confirmed" &&
      ["sent", "pending"].includes(status.outcome),
  ).length;
  return { total: enabled.size, observed, pending };
}
