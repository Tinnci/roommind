"""Tests for climate constraint reduction."""

from __future__ import annotations

from custom_components.roommind.const import MODE_COOLING, MODE_HEATING, MODE_IDLE
from custom_components.roommind.control.constraints import ConstraintInput, ConstraintReducer


def test_recovery_preserves_mpc_taper_and_does_not_restart_idle():
    """Recovery must not undo predictive braking or capability gating."""
    for mode, power in ((MODE_HEATING, 0.25), (MODE_IDLE, 0.0), (MODE_COOLING, 0.3)):
        result = ConstraintReducer().reduce(
            ConstraintInput(mode=mode, power_fraction=power, rapid_recovery_mode=MODE_HEATING)
        )
        assert (result.mode, result.power_fraction) == (mode, power)
        assert result.rapid_recovery_active is (mode == MODE_HEATING)


def test_force_off_reduces_to_idle_and_disables_rapid_recovery():
    result = ConstraintReducer().reduce(
        ConstraintInput(
            mode=MODE_HEATING,
            power_fraction=0.7,
            force_off=True,
            rapid_recovery_mode=MODE_COOLING,
        )
    )

    assert result.mode == MODE_IDLE
    assert result.power_fraction == 0.0
    assert result.rapid_recovery_active is False


def test_window_open_wins_after_rapid_recovery():
    result = ConstraintReducer().reduce(
        ConstraintInput(
            mode=MODE_HEATING,
            power_fraction=0.2,
            window_open=True,
            rapid_recovery_mode=MODE_HEATING,
        )
    )

    assert result.mode == MODE_IDLE
    assert result.power_fraction == 0.0
    assert result.rapid_recovery_active is False


def test_compressor_forced_off_all_devices_idles_and_clears_forced_off():
    result = ConstraintReducer().reduce(
        ConstraintInput(
            mode=MODE_COOLING,
            power_fraction=1.0,
            all_device_eids=("climate.ac_1", "climate.ac_2"),
            compressor_forced_off=frozenset({"climate.ac_1", "climate.ac_2"}),
        )
    )

    assert result.mode == MODE_IDLE
    assert result.power_fraction == 0.0
    assert result.compressor_forced_off == frozenset()


class _FakeCompressorManager:
    def get_group_for_entity(self, entity_id: str) -> str | None:
        return "group" if entity_id.startswith("climate.") else None

    def check_can_activate(self, entity_id: str) -> bool:
        return entity_id != "climate.blocked"

    def get_enforced_action(self, entity_id: str) -> str | None:
        return "cool" if entity_id == "climate.enforced_cool" else None

    def check_must_stay_active(self, entity_id: str) -> bool:
        return entity_id == "climate.must_run"


def test_compressor_constraints_are_computed_outside_coordinator():
    forced_on, forced_off = ConstraintReducer().compressor_constraints(
        manager=_FakeCompressorManager(),
        all_device_eids=("climate.blocked", "climate.enforced_cool", "climate.must_run"),
        mode=MODE_HEATING,
        climate_active=True,
        window_open=False,
        force_off=False,
    )

    assert forced_on == frozenset()
    assert forced_off == frozenset({"climate.blocked", "climate.enforced_cool"})


def test_compressor_constraints_keep_min_run_devices_active_when_idle():
    forced_on, forced_off = ConstraintReducer().compressor_constraints(
        manager=_FakeCompressorManager(),
        all_device_eids=("climate.must_run",),
        mode=MODE_IDLE,
        climate_active=True,
        window_open=False,
        force_off=False,
    )

    assert forced_on == frozenset({"climate.must_run"})
    assert forced_off == frozenset()
