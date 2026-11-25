"""Figures derived from the recorded history for the analytics page."""

from __future__ import annotations

from collections.abc import Iterator
from datetime import date, timedelta
from math import ceil

from homeassistant.util import dt as dt_util

from ..const import CLIMATE_MODE_COOL_ONLY, CLIMATE_MODE_HEAT_ONLY, MODE_COOLING, MODE_HEATING

COMFORT_TOLERANCE_K = 0.5
MAX_SAMPLE_GAP_S = 900
RHYTHM_DAYS = 14
RHYTHM_MAX_DAYS = 31
RHYTHM_MIN_DAYS = 2
RHYTHM_MEANS = {"temp": "room_temp", "humidity": "humidity", "outdoor": "outdoor_temp"}
OVERSHOOT_WINDOW_S = 3600
PREHEAT_LOOKAHEAD_S = 12 * 3600


def _weighted(points: list[dict]) -> Iterator[tuple[dict, float]]:
    """Yield each sample with the seconds it stands for."""
    last_weight = 0.0
    for i, point in enumerate(points):
        if i + 1 < len(points):
            last_weight = min(points[i + 1]["ts"] - point["ts"], MAX_SAMPLE_GAP_S)
        yield point, last_weight


def _deviations(points: list[dict], climate_mode: str) -> list[float | None]:
    """Signed distance of each sample from the wanted band, None where it cannot be judged."""
    result: list[float | None] = []
    for point in points:
        temp = point.get("room_temp")
        shift = point.get("price_shift") or 0.0
        low = None if climate_mode == CLIMATE_MODE_COOL_ONLY else point.get("heat_target")
        high = None if climate_mode == CLIMATE_MODE_HEAT_ONLY else point.get("cool_target")
        low = low - shift if low is not None else None
        high = high + shift if high is not None else None
        if temp is None or (low is None and high is None) or point.get("window_open"):
            result.append(None)
        elif low is not None and temp < low:
            result.append(round(temp - low, 3))
        elif high is not None and temp > high:
            result.append(round(temp - high, 3))
        else:
            result.append(0.0)
    return result


def _comfort_side(deviation: float) -> str:
    if deviation < -COMFORT_TOLERANCE_K:
        return "below"
    if deviation > COMFORT_TOLERANCE_K:
        return "above"
    return "within"


def _run_target(point: dict, target_key: str, sign: int) -> float | None:
    target = point.get(target_key)
    if target is None:
        return None
    schedule = target - sign * (point.get("price_shift") or 0.0)
    return float(max(target, schedule) if sign > 0 else min(target, schedule))


def _extreme(point: dict, sign: int) -> float | None:
    value = point.get("room_temp_max" if sign > 0 else "room_temp_min")
    return point.get("room_temp") if value is None else value


def _reference_target(points: list[dict], run_start: int, end: int, target_key: str, sign: int) -> float | None:
    strictest = max if sign > 0 else min
    end_ts = points[end]["ts"]
    targets: list[float] = []
    for p in points[run_start:]:
        if p["ts"] - end_ts > OVERSHOOT_WINDOW_S:
            break
        if (t := _run_target(p, target_key, sign)) is not None:
            targets.append(t)
    if not targets:
        return None
    reference = strictest(targets)
    first = _extreme(points[run_start], -sign)
    if first is None or sign * (first - reference) < 0:
        return reference
    for p in points[end:]:
        if p["ts"] - end_ts > PREHEAT_LOOKAHEAD_S:
            break
        t = _run_target(p, target_key, sign)
        if t is not None and sign * (t - reference) > 0:
            return t
    return reference


def _run_overshoot(points: list[dict], mode: str, target_key: str, sign: int) -> dict | None:
    strictest = max if sign > 0 else min
    start_key = "heat_starts" if sign > 0 else "cool_starts"

    def begins(i: int) -> bool:
        counted = points[i].get(start_key)
        if counted is not None:
            return bool(counted > 0)
        return points[i].get("mode") == mode and (i == 0 or points[i - 1].get("mode") != mode)

    def in_run(i: int) -> bool:
        return points[i].get("mode") == mode or bool(points[i].get(start_key))

    overshoots: list[float] = []
    run_start = 0
    for i, point in enumerate(points[:-1]):
        if not in_run(i):
            continue
        if i == 0 or begins(i) or not in_run(i - 1):
            run_start = i
        if in_run(i + 1) and not begins(i + 1):
            continue
        reference = _reference_target(points, run_start, i, target_key, sign)
        if reference is None:
            continue
        peak: float | None = None
        for j in range(i, len(points)):
            later = points[j]
            if later["ts"] - point["ts"] > OVERSHOOT_WINDOW_S or (j > i and begins(j)):
                break
            temp = _extreme(later, sign)
            if temp is None or later.get("window_open"):
                continue
            peak = temp if peak is None else strictest(peak, temp)
        if peak is not None:
            overshoots.append(max(0.0, sign * (peak - reference)))
    if not overshoots:
        return None
    return {
        "runs": len(overshoots),
        "mean": round(sum(overshoots) / len(overshoots), 2),
        "max": round(max(overshoots), 2),
    }


def compute_period_stats(points: list[dict], climate_mode: str) -> dict:
    """Sum up a time-sorted list of history points."""
    seconds = {"total": 0.0, "heating": 0.0, "cooling": 0.0, "window": 0.0}
    starts = {MODE_HEATING: 0, MODE_COOLING: 0}
    start_keys = {MODE_HEATING: "heat_starts", MODE_COOLING: "cool_starts"}
    comfort = {"below": 0.0, "within": 0.0, "above": 0.0}
    by_price: dict[str, dict[str, float]] = {MODE_HEATING: {}, MODE_COOLING: {}}
    priced = shifted = 0.0
    deviation_sum = 0.0
    miss_sum = 0.0
    previous_mode = None
    for (point, weight), deviation in zip(_weighted(points), _deviations(points, climate_mode), strict=True):
        mode = point.get("mode")
        seconds["total"] += weight
        if mode in starts:
            seconds[mode] += weight
        if any(point.get(key) is not None for key in start_keys.values()):
            for run, key in start_keys.items():
                starts[run] += point.get(key) or 0
        elif mode in starts and previous_mode is not None and previous_mode != mode:
            starts[mode] += 1
        previous_mode = mode
        if point.get("window_open"):
            seconds["window"] += weight
        level = point.get("price_level")
        if level:
            priced += weight
            if mode in by_price:
                by_price[mode][level] = by_price[mode].get(level, 0.0) + weight
            if point.get("price_shift"):
                shifted += weight
        if deviation is None:
            continue
        deviation_sum += abs(deviation) * weight
        side = _comfort_side(deviation)
        comfort[side] += weight
        if side != "within":
            miss_sum += abs(deviation) * weight

    judged = sum(comfort.values())
    missed = comfort["below"] + comfort["above"]
    return {
        "hours": round(seconds["total"] / 3600, 2),
        "heating_hours": round(seconds[MODE_HEATING] / 3600, 2),
        "cooling_hours": round(seconds[MODE_COOLING] / 3600, 2),
        "window_hours": round(seconds["window"] / 3600, 2),
        "heating_starts": starts[MODE_HEATING],
        "cooling_starts": starts[MODE_COOLING],
        "price": (
            {
                "heating_hours": {lv: round(v / 3600, 2) for lv, v in by_price[MODE_HEATING].items()},
                "cooling_hours": {lv: round(v / 3600, 2) for lv, v in by_price[MODE_COOLING].items()},
                "shifted_hours": round(shifted / 3600, 2),
            }
            if priced > 0
            else None
        ),
        "heat_overshoot": (
            _run_overshoot(points, MODE_HEATING, "heat_target", 1) if climate_mode != CLIMATE_MODE_COOL_ONLY else None
        ),
        "cool_overshoot": (
            _run_overshoot(points, MODE_COOLING, "cool_target", -1) if climate_mode != CLIMATE_MODE_HEAT_ONLY else None
        ),
        "comfort": (
            {
                "below_pct": round(100 * comfort["below"] / judged, 1),
                "within_pct": round(100 * comfort["within"] / judged, 1),
                "above_pct": round(100 * comfort["above"] / judged, 1),
                "mean_deviation": round(deviation_sum / judged, 2),
                "miss_deviation": round(miss_sum / missed, 2) if missed > 0 else None,
            }
            if judged > 0
            else None
        ),
    }


def _local_date(ts: float) -> date:
    local: date = dt_util.as_local(dt_util.utc_from_timestamp(ts)).date()
    return local


def rhythm_window(start_ts: float, end_ts: float, now: float) -> tuple[int, float]:
    """Days of the grid and the moment it ends for a selected range."""
    days = min(max(ceil((end_ts - start_ts) / 86400), RHYTHM_DAYS), RHYTHM_MAX_DAYS)
    if _local_date(start_ts) >= _local_date(now) - timedelta(days=days - 1):
        return days, now
    return days, min(end_ts, now)


def _empty_day(date_str: str) -> dict:
    keys = ("heat", "cool", "window", "deviation", "below", "above", *RHYTHM_MEANS)
    return {"date": date_str, **{key: [None] * 24 for key in keys}, "within": None}


def compute_rhythm(points: list[dict], climate_mode: str, end_ts: float, days_shown: int = RHYTHM_DAYS) -> dict | None:
    """Hour-by-day grid of the local days up to end_ts, newest day first."""
    last_day = _local_date(end_ts)
    dates = [last_day - timedelta(days=i) for i in range(days_shown)]
    index = {day: i for i, day in enumerate(dates)}
    days = [_empty_day(day.isoformat()) for day in dates]

    cells: dict[tuple[int, int], dict[str, float]] = {}
    for (point, weight), deviation in zip(_weighted(points), _deviations(points, climate_mode), strict=True):
        local = dt_util.as_local(dt_util.utc_from_timestamp(point["ts"]))
        row = index.get(local.date())
        if row is None or weight <= 0:
            continue
        cell = cells.setdefault((row, local.hour), {})
        cell["seconds"] = cell.get("seconds", 0.0) + weight
        for key, on in (
            ("heat", point.get("mode") == MODE_HEATING),
            ("cool", point.get("mode") == MODE_COOLING),
            ("window", bool(point.get("window_open"))),
        ):
            cell[key] = cell.get(key, 0.0) + (weight if on else 0.0)
        if deviation is not None:
            side = _comfort_side(deviation)
            cell["judged"] = cell.get("judged", 0.0) + weight
            cell[side] = cell.get(side, 0.0) + weight
        values = {key: point.get(field) for key, field in RHYTHM_MEANS.items()}
        for key, value in {**values, "deviation": deviation}.items():
            if value is not None:
                cell[f"{key}_sum"] = cell.get(f"{key}_sum", 0.0) + value * weight
                cell[f"{key}_seconds"] = cell.get(f"{key}_seconds", 0.0) + weight

    for (row, hour), cell in cells.items():
        day = days[row]
        for key in ("heat", "cool", "window"):
            day[key][hour] = round(cell[key] / cell["seconds"], 2)
        for key in ("deviation", *RHYTHM_MEANS):
            if f"{key}_seconds" in cell:
                day[key][hour] = round(cell[f"{key}_sum"] / cell[f"{key}_seconds"], 2)
        if cell.get("judged"):
            for key in ("below", "above"):
                day[key][hour] = round(cell.get(key, 0.0) / cell["judged"], 2)

    for row, day in enumerate(days):
        judged = sum(cell.get("judged", 0.0) for (r, _), cell in cells.items() if r == row)
        if judged > 0:
            within = sum(cell.get("within", 0.0) for (r, _), cell in cells.items() if r == row)
            day["within"] = round(within / judged, 3)

    if len({row for row, _ in cells}) < RHYTHM_MIN_DAYS:
        return None
    while days and all(value is None for value in days[-1]["heat"]):
        days.pop()
    return {"days": days}
