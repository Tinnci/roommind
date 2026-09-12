import type { HVACOutputStatus } from "../types";
import { localize, type TranslationKey } from "./localize";

const STAGE_LABELS: Record<string, TranslationKey> = {
  off: "airflow.output_off",
  fan: "airflow.output_fan",
  compressor_active: "airflow.output_active",
  compressor_low: "airflow.output_low",
  compressor_mid: "airflow.output_mid",
  compressor_high: "airflow.output_high",
};

export function describeHvacOutput(status: HVACOutputStatus, language: string): string {
  let stage = localize(STAGE_LABELS[status.stage] ?? "airflow.confidence_unknown", language);
  if (
    status.confidence === "estimated" &&
    STAGE_LABELS[status.stage] &&
    status.stage !== "compressor_active"
  ) {
    stage += ` (${localize("airflow.output_estimated", language)})`;
  }
  const power = status.electric_power_w;
  if (power == null || !Number.isFinite(power) || power < 0) return stage;

  const powerLabel =
    status.electric_power_source === "sensor"
      ? "airflow.output_measured_power"
      : status.electric_power_source === "fan_curve"
        ? "airflow.output_fan_power"
        : "airflow.output_power";
  return `${stage} · ${localize(powerLabel, language, { power: Number(power.toFixed(1)) })}`;
}
