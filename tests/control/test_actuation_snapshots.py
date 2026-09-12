"""A retained actuation plan must not change when its consumers mutate data."""

import pytest

from custom_components.roommind.control.actuation import ActuationLedger, DeviceActuationResult, DispatchStatus


def test_dispatch_snapshot_detaches_and_protects_the_desired_setpoint():
    payload = {"entity_id": "climate.ac", "temperature": 23.0}
    result = DeviceActuationResult("climate.ac", DispatchStatus.SENT, "set_temperature", payload, context_id="test")
    ledger = ActuationLedger()
    ledger.record_dispatch(result)

    payload["temperature"] = 16.0

    assert ledger.snapshot()[0].result.desired["temperature"] == 23.0
    with pytest.raises(TypeError):
        ledger.snapshot()[0].result.desired["temperature"] = 16.0
