/**
 * Pure functions to build ECharts series and options for analytics charts.
 */
import type { AnalyticsDataPoint, HomeAssistant } from "../types";
import { localize } from "./localize";
import { formatTemp, tempUnit, toDisplay } from "./temperature";

const FORECAST_MS = 3 * 3600_000;

export type AnalyticsChartLens = "temperature" | "activity" | "humidity";

export interface ChartBuildContext {
  hass: HomeAssistant;
  language: string;
  chartAnchor: number;
  rangeStart: number;
  rangeEnd: number;
  forecast?: AnalyticsDataPoint[];
  isOutdoor?: boolean;
  lens?: AnalyticsChartLens;
}

function pushEventBands(
  series: Array<Record<string, unknown>>,
  points: AnalyticsDataPoint[],
  language: string,
  ceiling: number,
): void {
  const heatingBandData: Array<[number, number | null]> = [];
  const coolingBandData: Array<[number, number | null]> = [];
  const dryBandData: Array<[number, number | null]> = [];
  const fanBandData: Array<[number, number | null]> = [];
  const windowBandData: Array<[number, number | null]> = [];

  let hasHeating = false;
  let hasCooling = false;
  let hasDry = false;
  let hasFan = false;
  let hasWindow = false;

  for (const p of points) {
    const ts = p.ts * 1000;
    if (p.mode === "heating") {
      heatingBandData.push([ts, ceiling]);
      hasHeating = true;
    } else {
      heatingBandData.push([ts, null]);
    }
    if (p.mode === "cooling") {
      coolingBandData.push([ts, ceiling]);
      hasCooling = true;
    } else {
      coolingBandData.push([ts, null]);
    }
    if (p.mode === "dry") {
      dryBandData.push([ts, ceiling]);
      hasDry = true;
    } else {
      dryBandData.push([ts, null]);
    }
    if (p.mode === "fan_only") {
      fanBandData.push([ts, ceiling]);
      hasFan = true;
    } else {
      fanBandData.push([ts, null]);
    }
    if (p.window_open) {
      windowBandData.push([ts, ceiling]);
      hasWindow = true;
    } else {
      windowBandData.push([ts, null]);
    }
  }

  const bandBase = {
    type: "line",
    showSymbol: false,
    lineStyle: { width: 0 },
    tooltip: { show: false },
    yAxisIndex: 0,
    z: -1,
    connectNulls: false,
  };

  if (hasHeating) {
    series.push({
      ...bandBase,
      id: "heating_events",
      name: localize("analytics.heating_period", language),
      color: "rgb(244, 67, 54)",
      data: heatingBandData,
      areaStyle: { color: "rgba(244, 67, 54, 0.09)", origin: "start" },
    });
  }

  if (hasCooling) {
    series.push({
      ...bandBase,
      id: "cooling_events",
      name: localize("analytics.cooling_period", language),
      color: "rgb(33, 150, 243)",
      data: coolingBandData,
      areaStyle: { color: "rgba(33, 150, 243, 0.09)", origin: "start" },
    });
  }

  if (hasDry) {
    series.push({
      ...bandBase,
      id: "dry_events",
      name: localize("analytics.dry_period", language),
      color: "rgb(0, 172, 193)",
      data: dryBandData,
      areaStyle: { color: "rgba(0, 172, 193, 0.1)", origin: "start" },
    });
  }

  if (hasFan) {
    series.push({
      ...bandBase,
      id: "fan_events",
      name: localize("analytics.fan_period", language),
      color: "rgb(38, 166, 154)",
      data: fanBandData,
      areaStyle: { color: "rgba(38, 166, 154, 0.09)", origin: "start" },
    });
  }

  if (hasWindow) {
    series.push({
      ...bandBase,
      id: "window_events",
      name: localize("analytics.window_open_period", language),
      color: "rgb(255, 193, 7)",
      data: windowBandData,
      areaStyle: { color: "rgba(255, 193, 7, 0.14)", origin: "start" },
    });
  }
}

function pushNowMarker(
  series: Array<Record<string, unknown>>,
  chartAnchor: number,
  floor: number,
  ceiling: number,
): void {
  series.push({
    id: "now_marker",
    type: "line",
    name: "",
    color: "rgba(128, 128, 128, 0.55)",
    data: [
      [chartAnchor, floor],
      [chartAnchor, ceiling],
    ],
    showSymbol: false,
    lineStyle: { width: 1.2, type: "dashed" },
    yAxisIndex: 0,
    tooltip: { show: false },
    z: -2,
  });
}

export function buildChartSeries(
  points: AnalyticsDataPoint[],
  ctx: ChartBuildContext,
): Array<Record<string, unknown>> {
  const { hass, language: l, chartAnchor, forecast, isOutdoor, lens = "temperature" } = ctx;

  if (lens === "activity") {
    const powerData: Array<[number, number]> = [];
    const airflowData: Array<[number, number]> = [];
    const blindData: Array<[number, number]> = [];

    for (const p of points) {
      const ts = p.ts * 1000;
      if (p.heating_power != null) powerData.push([ts, p.heating_power]);
      if (p.airflow_plan_level != null)
        airflowData.push([ts, Math.round(p.airflow_plan_level * 100)]);
      if (p.blind_position != null) blindData.push([ts, 100 - p.blind_position]);
    }

    const series: Array<Record<string, unknown>> = [];
    if (powerData.length > 0) {
      series.push({
        id: "heating_power",
        type: "line",
        name: localize("analytics.series_hvac_power", l),
        color: "rgb(244, 67, 54)",
        data: powerData,
        showSymbol: false,
        step: "end",
        lineStyle: { width: 2 },
        areaStyle: { color: "rgba(244, 67, 54, 0.16)", origin: "start" },
        yAxisIndex: 0,
      });
    }
    if (airflowData.length > 0) {
      series.push({
        id: "airflow_level",
        type: "line",
        name: localize("analytics.series_airflow_level", l),
        color: "rgb(0, 150, 136)",
        data: airflowData,
        showSymbol: false,
        smooth: true,
        lineStyle: { width: 2 },
        areaStyle: { color: "rgba(0, 150, 136, 0.1)", origin: "start" },
        yAxisIndex: 0,
      });
    }
    if (blindData.length > 0) {
      series.push({
        id: "blind_position",
        type: "line",
        name: localize("analytics.blind_position", l),
        color: "rgb(121, 85, 72)",
        data: blindData,
        showSymbol: false,
        step: "end",
        lineStyle: { width: 1.8, type: "dashed" },
        yAxisIndex: 0,
      });
    }

    pushEventBands(series, points, l, 100);
    pushNowMarker(series, chartAnchor, 0, 100);
    return series;
  }

  if (lens === "humidity") {
    const roomRhData: Array<[number, number]> = [];
    const outdoorRhData: Array<[number, number]> = [];
    const moldRhData: Array<[number, number]> = [];

    for (const p of points) {
      const ts = p.ts * 1000;
      if (p.room_humidity != null) roomRhData.push([ts, p.room_humidity]);
      if (p.outdoor_humidity != null) outdoorRhData.push([ts, p.outdoor_humidity]);
      if (!isOutdoor && p.mold_surface_rh != null) moldRhData.push([ts, p.mold_surface_rh]);
    }

    const series: Array<Record<string, unknown>> = [];
    if (roomRhData.length > 0) {
      series.push({
        id: "room_humidity",
        type: "line",
        name: localize("analytics.series_room_humidity", l),
        color: "rgb(3, 169, 244)",
        data: roomRhData,
        showSymbol: false,
        smooth: true,
        lineStyle: { width: 2.5 },
        areaStyle: { color: "rgba(3, 169, 244, 0.1)", origin: "start" },
        yAxisIndex: 0,
      });
    }
    if (moldRhData.length > 0) {
      series.push({
        id: "mold_surface_rh",
        type: "line",
        name: localize("analytics.series_mold_rh", l),
        color: "rgb(255, 112, 67)",
        data: moldRhData,
        showSymbol: false,
        smooth: true,
        lineStyle: { width: 1.8, type: "dotted" },
        yAxisIndex: 0,
      });
    }
    if (outdoorRhData.length > 0) {
      series.push({
        id: "outdoor_humidity",
        type: "line",
        name: localize("analytics.series_outdoor_humidity", l),
        color: "rgb(158, 158, 158)",
        data: outdoorRhData,
        showSymbol: false,
        smooth: true,
        lineStyle: { width: 1.5 },
        yAxisIndex: 0,
      });
    }

    pushEventBands(series, points, l, 100);
    pushNowMarker(series, chartAnchor, 0, 100);
    return series;
  }

  // Default: Temperature lens
  const d = (c: number) => toDisplay(c, hass);

  const roomData: Array<[number, number]> = [];
  const targetData: Array<[number, number]> = [];
  const predictedData: Array<[number, number]> = [];
  const deviceSetpointData: Array<[number, number]> = [];
  const perceivedData: Array<[number, number]> = [];
  const outdoorData: Array<[number, number]> = [];

  for (const p of points) {
    const ts = p.ts * 1000;
    if (p.room_temp !== null) roomData.push([ts, d(p.room_temp)]);
    if (!isOutdoor && p.target_temp !== null) targetData.push([ts, d(p.target_temp)]);
    if (!isOutdoor && p.predicted_temp !== null) predictedData.push([ts, d(p.predicted_temp)]);
    if (!isOutdoor && p.device_setpoint != null)
      deviceSetpointData.push([ts, d(p.device_setpoint)]);
    if (!isOutdoor && p.perceived_temp != null) perceivedData.push([ts, d(p.perceived_temp)]);
    if (p.outdoor_temp !== null) outdoorData.push([ts, d(p.outdoor_temp)]);
  }

  for (const p of forecast ?? []) {
    const ts = p.ts * 1000;
    if (!isOutdoor && p.target_temp !== null) targetData.push([ts, d(p.target_temp)]);
    if (!isOutdoor && p.predicted_temp !== null) predictedData.push([ts, d(p.predicted_temp)]);
  }

  const series: Array<Record<string, unknown>> = [
    {
      id: "room_temp",
      type: "line",
      name: localize("analytics.temperature", l),
      color: "rgb(255, 152, 0)",
      data: roomData,
      showSymbol: false,
      smooth: true,
      lineStyle: { width: 2.5 },
      areaStyle: { color: "rgba(255, 152, 0, 0.08)", origin: "start" },
      yAxisIndex: 0,
    },
  ];

  if (!isOutdoor) {
    series.push({
      id: "target_temp",
      type: "line",
      name: localize("analytics.target", l),
      color: "rgb(76, 175, 80)",
      data: targetData,
      showSymbol: false,
      step: "end",
      lineStyle: { width: 2, type: "dashed" },
      yAxisIndex: 0,
    });
  }

  if (predictedData.length > 0) {
    series.push({
      id: "predicted_temp",
      type: "line",
      name: localize("analytics.prediction", l),
      color: "rgb(33, 150, 243)",
      data: predictedData,
      showSymbol: false,
      smooth: true,
      lineStyle: { width: 2, type: "dotted" },
      yAxisIndex: 0,
    });
  }

  if (deviceSetpointData.length > 0) {
    series.push({
      id: "device_setpoint",
      type: "line",
      name: localize("analytics.series_device_setpoint", l),
      color: "rgb(171, 71, 188)",
      data: deviceSetpointData,
      showSymbol: false,
      step: "end",
      lineStyle: { width: 1.5, type: "dashed" },
      yAxisIndex: 0,
    });
  }

  if (perceivedData.length > 0) {
    series.push({
      id: "perceived_temp",
      type: "line",
      name: localize("analytics.series_perceived_temp", l),
      color: "rgb(0, 188, 212)",
      data: perceivedData,
      showSymbol: false,
      smooth: true,
      lineStyle: { width: 1.5 },
      yAxisIndex: 0,
    });
  }

  if (outdoorData.length > 0) {
    series.push({
      id: "outdoor_temp",
      type: "line",
      name: localize("analytics.outdoor", l),
      color: "rgb(158, 158, 158)",
      data: outdoorData,
      showSymbol: false,
      smooth: true,
      lineStyle: { width: 1.5 },
      yAxisIndex: 0,
    });
  }

  pushEventBands(series, points, l, 999);
  pushNowMarker(series, chartAnchor, -999, 999);

  return series;
}

export function buildChartOptions(
  visibleY: number[],
  points: AnalyticsDataPoint[],
  ctx: ChartBuildContext,
): Record<string, unknown> {
  const { hass, language: l, chartAnchor, rangeStart, rangeEnd, lens = "temperature" } = ctx;
  const isPercentLens = lens === "activity" || lens === "humidity";
  const unit = isPercentLens ? "%" : tempUnit(hass);

  const yAxis: Record<string, unknown> = {
    type: "value",
    name: unit,
    splitLine: {
      lineStyle: {
        color: "rgba(128, 128, 128, 0.14)",
      },
    },
  };

  if (lens === "activity") {
    yAxis.min = 0;
    yAxis.max = 100;
  } else if (visibleY.length > 0) {
    let minVal = Infinity;
    let maxVal = -Infinity;
    for (const v of visibleY) {
      if (v < minVal) minVal = v;
      if (v > maxVal) maxVal = v;
    }
    const range = maxVal - minVal;
    if (lens === "humidity") {
      const pad = Math.max(range * 0.12, 3);
      yAxis.min = Math.max(0, Math.floor((minVal - pad) / 5) * 5);
      yAxis.max = Math.min(100, Math.ceil((maxVal + pad) / 5) * 5);
    } else {
      const pad = Math.max(range * 0.1, 0.5);
      yAxis.min = Math.floor((minVal - pad) * 2) / 2;
      yAxis.max = Math.ceil((maxVal + pad) * 2) / 2;
    }
  }

  const isLive = Math.abs(rangeEnd - Date.now()) < 3600_000;
  const modeLabelMap: Record<string, string> = {
    heating: localize("analytics.heating_period", l),
    cooling: localize("analytics.cooling_period", l),
    dry: localize("analytics.dry_period", l),
    fan_only: localize("analytics.fan_period", l),
    idle: localize("analytics.idle_period", l),
  };

  return {
    xAxis: {
      type: "time",
      min: rangeStart,
      max: lens === "temperature" && isLive ? chartAnchor + FORECAST_MS : rangeEnd,
      splitLine: { show: false },
    },
    yAxis,
    dataZoom: [
      {
        type: "inside",
        xAxisIndex: 0,
        filterMode: "none",
      },
    ],
    tooltip: {
      trigger: "axis",
      axisPointer: { snap: false },
      valueFormatter: (v: number) =>
        (isPercentLens ? Math.round(v).toString() : v.toFixed(1)) + "\u00A0" + unit,
      formatter: (
        params: Array<{
          seriesName: string;
          color: string;
          value: [number, number];
          seriesId: string;
        }>,
      ) => {
        if (!Array.isArray(params) || params.length === 0) return "";
        const firstParam = params[0];
        if (!firstParam) return "";
        const date = new Date(firstParam.value[0]);
        const stamp = date.toLocaleString(l, {
          month: "2-digit",
          day: "2-digit",
          hour: "2-digit",
          minute: "2-digit",
        });
        let markup = `<div style="font-weight:600;margin-bottom:4px">${stamp}</div>`;
        let roomVal: number | null = null;
        let targetVal: number | null = null;
        let predVal: number | null = null;
        for (const p of params) {
          if ((p.seriesId as string)?.endsWith("_events") || p.seriesId === "now_marker") continue;
          const v = p.value?.[1];
          if (v == null) continue;
          const formatted = isPercentLens ? Math.round(v).toString() : v.toFixed(1);
          markup += `<div style="display:flex;justify-content:space-between;gap:12px"><span>${p.color ? `<span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${p.color};margin-right:6px"></span>` : ""}${p.seriesName}</span><strong style="font-variant-numeric:tabular-nums">${formatted}\u00A0${unit}</strong></div>`;
          if (p.seriesId === "room_temp") roomVal = v;
          if (p.seriesId === "target_temp") targetVal = v;
          if (p.seriesId === "predicted_temp") predVal = v;
        }
        if (
          lens === "temperature" &&
          roomVal !== null &&
          (targetVal !== null || predVal !== null)
        ) {
          const deltas: string[] = [];
          if (roomVal !== null && targetVal !== null) {
            const drift = roomVal - targetVal;
            const sign = drift >= 0 ? "+" : "";
            deltas.push(`Target ${sign}${drift.toFixed(1)}\u00A0${unit}`);
          }
          if (roomVal !== null && predVal !== null) {
            const delta = roomVal - predVal;
            const sign = delta >= 0 ? "+" : "";
            deltas.push(`Pred ${sign}${delta.toFixed(2)}\u00A0${unit}`);
          }
          if (deltas.length > 0) {
            markup += `<div style="border-top:1px solid rgba(128,128,128,0.28);margin-top:4px;padding-top:4px;font-size:12px;opacity:0.85">${deltas.join(" \u00B7 ")}</div>`;
          }
        }
        if (points.length > 0) {
          const hoverTs = firstParam.value[0] / 1000;
          let closest: AnalyticsDataPoint | null = null;
          let minDist = Infinity;
          for (const pt of points) {
            const dist = Math.abs(pt.ts - hoverTs);
            if (dist < minDist) {
              minDist = dist;
              closest = pt;
            }
          }
          if (closest) {
            const parts: string[] = [];
            const modeText = modeLabelMap[closest.mode] ?? closest.mode;
            if (closest.mode && closest.mode !== "idle") {
              if (
                closest.mode === "heating" &&
                closest.heating_power != null &&
                closest.heating_power > 0 &&
                closest.heating_power < 100
              ) {
                parts.push(`${modeText} ${closest.heating_power}%`);
              } else {
                parts.push(modeText);
              }
              if (closest.device_setpoint != null) {
                const devLabel = closest.mode === "heating" ? "TRV" : "AC";
                parts.push(
                  `${devLabel} ${formatTemp(closest.device_setpoint, hass)}\u00A0${tempUnit(hass)}`,
                );
              }
            }
            if (closest.room_humidity != null && lens !== "humidity") {
              parts.push(`${Math.round(closest.room_humidity)}% RH`);
            }
            if (closest.window_open) parts.push(localize("analytics.window_open_period", l));
            if (parts.length > 0) {
              markup += `<div style="border-top:1px solid rgba(128,128,128,0.28);margin-top:4px;padding-top:4px;font-size:12px;opacity:0.82">${parts.join(" \u00B7 ")}</div>`;
            }
            if (closest.blind_position != null) {
              markup += `<div style="font-size:12px;opacity:0.82">${localize("analytics.blind_position", l)} ${100 - closest.blind_position}%</div>`;
            }
          }
        }
        const tooltipEl = document.createElement("div");
        tooltipEl.innerHTML = markup;
        return tooltipEl;
      },
    },
    grid: {
      top: 18,
      left: 10,
      right: 14,
      bottom: 8,
      containLabel: true,
    },
  };
}
