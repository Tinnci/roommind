"""One-hour backtest of the room's learned RC thermal model."""

from __future__ import annotations

import math
from dataclasses import dataclass, field

from ..control.thermal_model import RCModel

BACKTEST_HORIZON_S = 3600.0
MAX_STEP_S = 900.0
MIN_BACKTEST_WINDOWS = 12


@dataclass
class BacktestFigures:
    """Mean absolute, root-mean-square, and signed error after one hour."""

    n: int = 0
    abs_sum: float = 0.0
    sq_sum: float = 0.0
    signed_sum: float = 0.0

    def add(self, error: float) -> None:
        self.n += 1
        self.abs_sum += abs(error)
        self.sq_sum += error * error
        self.signed_sum += error

    def as_dict(self) -> dict:
        if self.n < MIN_BACKTEST_WINDOWS:
            return {"n": self.n, "mae": None, "rmse": None, "bias": None}
        return {
            "n": self.n,
            "mae": round(self.abs_sum / self.n, 3),
            "rmse": round(math.sqrt(self.sq_sum / self.n), 3),
            "bias": round(self.signed_sum / self.n, 3),
        }


@dataclass
class BacktestResult:
    predicted: dict[float, float] = field(default_factory=dict)
    idle: BacktestFigures = field(default_factory=BacktestFigures)
    active: BacktestFigures = field(default_factory=BacktestFigures)

    def figures(self) -> dict:
        total_n = self.idle.n + self.active.n
        if total_n >= MIN_BACKTEST_WINDOWS:
            overall = {
                "n": total_n,
                "mae": round((self.idle.abs_sum + self.active.abs_sum) / total_n, 3),
                "rmse": round(math.sqrt((self.idle.sq_sum + self.active.sq_sum) / total_n), 3),
                "bias": round((self.idle.signed_sum + self.active.signed_sum) / total_n, 3),
            }
        else:
            overall = {"n": total_n, "mae": None, "rmse": None, "bias": None}
        return {
            "horizon_minutes": round(BACKTEST_HORIZON_S / 60),
            "overall": overall,
            "idle": self.idle.as_dict(),
            "active": self.active.as_dict(),
        }


def _power_share(p: dict) -> float | None:
    if p.get("model_power") is not None:
        return float(p["model_power"])
    mode = p.get("mode", "")
    hp = p.get("heating_power")
    frac = 1.0 if hp is None else max(0.0, min(1.0, float(hp) / 100.0))
    if mode == "heating":
        return frac
    if mode == "cooling":
        return -frac
    if mode in ("idle", ""):
        return 0.0
    return None


def _inputs_known(p: dict) -> bool:
    return p.get("room_temp") is not None and p.get("outdoor_temp") is not None and _power_share(p) is not None


def backtest(points: list[dict], model: RCModel, k_window: float) -> BacktestResult:
    """Run the one-hour backtest over time-sorted points."""
    result = BacktestResult()
    n = len(points)
    if n < 2 or model.U <= 0:
        return result

    ts = [p["ts"] for p in points]
    known = [_inputs_known(p) for p in points]
    breaks = [0] * n
    for k in range(1, n):
        bad = not known[k - 1] or ts[k] - ts[k - 1] > MAX_STEP_S or ts[k] <= ts[k - 1]
        breaks[k] = breaks[k - 1] + int(bad)

    j = 0
    for i in range(1, n):
        if not known[i]:
            continue
        start = ts[i] - BACKTEST_HORIZON_S
        while j + 1 < i and ts[j + 1] <= start:
            j += 1
        if ts[j] > start or ts[i] - ts[j] > BACKTEST_HORIZON_S + MAX_STEP_S or not known[j]:
            continue
        if breaks[i] - breaks[j]:
            continue
        T = float(points[j]["room_temp"])
        active = False
        window = False
        for k in range(j, i):
            p = points[k]
            dt = (ts[k + 1] - ts[k]) / 60.0
            if p.get("window_open"):
                window = True
                T = model.predict_window_open(T, p["outdoor_temp"], k_window, dt)
                continue
            share = _power_share(p) or 0.0
            if share > 0:
                Q = share * model.Q_heat
            elif share < 0:
                Q = share * model.Q_cool
            else:
                Q = 0.0
            active = active or Q != 0.0
            T = model.predict(
                T,
                p["outdoor_temp"],
                Q,
                dt,
                q_solar=p.get("model_solar") or p.get("solar_irradiance") or 0.0,
                q_residual=p.get("model_residual") or 0.0,
                q_occupancy=p.get("model_occupancy") or (1.0 if p.get("occupancy") else 0.0),
                q_vent=p.get("q_vent") or 0.0,
            )
        result.predicted[ts[i]] = round(T, 2)
        if not window:
            (result.active if active else result.idle).add(T - float(points[i]["room_temp"]))
    return result
