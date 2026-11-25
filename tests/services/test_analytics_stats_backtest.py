"""Tests for analytics_stats and model_backtest services."""

from __future__ import annotations

from custom_components.roommind.control.thermal_model import RCModel
from custom_components.roommind.services.analytics_stats import compute_period_stats, compute_rhythm
from custom_components.roommind.services.model_backtest import backtest


def test_backtest_produces_1h_mae_rmse_and_bias():
    model = RCModel(C=2.0, U=0.1, Q_heat=1500.0, Q_cool=1500.0)
    base_ts = 1_700_000_000.0
    points = []
    temp = 20.0
    outdoor = 10.0
    # 16 steps of 5 min -> more than 12 one-hour windows
    for i in range(28):
        ts = base_ts + i * 300.0
        points.append(
            {
                "ts": ts,
                "room_temp": round(temp, 3),
                "outdoor_temp": outdoor,
                "mode": "idle",
                "heating_power": 0.0,
                "window_open": False,
                "solar_irradiance": 0.0,
                "occupancy": False,
                "q_vent": 0.0,
            }
        )
        temp = model.predict(temp, outdoor, 0.0, 5.0)

    res = backtest(points, model, k_window=3.0)
    figs = res.figures()
    assert figs["horizon_minutes"] == 60
    assert figs["idle"]["n"] >= 12
    assert figs["idle"]["mae"] is not None
    assert figs["idle"]["mae"] < 0.05
    assert figs["overall"]["rmse"] is not None


def test_compute_period_stats_and_rhythm():
    base_ts = 1_700_000_000.0
    points = [
        {
            "ts": base_ts,
            "room_temp": 20.5,
            "outdoor_temp": 10.0,
            "heat_target": 20.5,
            "cool_target": 24.0,
            "mode": "heating",
            "window_open": False,
            "humidity": 48.0,
        },
        {
            "ts": base_ts + 300.0,
            "room_temp": 20.6,
            "outdoor_temp": 10.0,
            "heat_target": 20.5,
            "cool_target": 24.0,
            "mode": "idle",
            "window_open": False,
            "humidity": 47.0,
        },
        {
            "ts": base_ts + 86400.0,
            "room_temp": 20.5,
            "outdoor_temp": 11.0,
            "heat_target": 20.5,
            "cool_target": 24.0,
            "mode": "idle",
            "window_open": False,
            "humidity": 46.0,
        },
    ]
    stats = compute_period_stats(points, "auto")
    assert stats["heating_hours"] > 0
    assert stats["comfort"] is not None
    assert stats["comfort"]["within_pct"] == 100.0

    rhythm = compute_rhythm(points, "auto", base_ts + 86400.0, days_shown=2)
    assert rhythm is not None
    assert len(rhythm["days"]) == 2
