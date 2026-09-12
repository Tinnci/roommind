import type { DeviceActuationStatus, NightControlConfig, NightControlStatus } from "../types";

export type ActuationFeedback =
  | DeviceActuationStatus["dispatch"]
  | "accepted"
  | "confirmed"
  | "not_confirmed";

export function actuationFeedback(
  operation: Pick<DeviceActuationStatus, "dispatch" | "application" | "acceptance">,
): ActuationFeedback {
  if (operation.dispatch !== "sent") return operation.dispatch;
  if (operation.application === "confirmed") return "confirmed";
  if (operation.application === "not_confirmed") return "not_confirmed";
  if (operation.acceptance === "accepted") return "accepted";
  return "sent";
}

export function nightControlFeedback(
  status: NightControlStatus,
): ActuationFeedback | "observed" | "unknown" {
  switch (status.outcome) {
    case "observed":
    case "failed":
    case "unsupported":
    case "skipped":
    case "deferred":
      return status.outcome;
    case "sent":
    case "pending":
      if (status.dispatch) {
        return actuationFeedback({
          dispatch: status.dispatch,
          acceptance: status.acceptance ?? "unknown",
          application: status.application ?? "unknown",
        });
      }
  }
  return "unknown";
}

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
