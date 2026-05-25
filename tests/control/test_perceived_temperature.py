"""Tests for perceived temperature engineering approximation."""

from custom_components.roommind.control.perceived_temperature import perceived_temperature


def test_cooling_airflow_lowers_perceived_temperature():
    still = perceived_temperature(air_temp_c=27.0, humidity=50.0, q_mix=0.0, mode="cooling")
    breezy = perceived_temperature(air_temp_c=27.0, humidity=50.0, q_mix=1.0, mode="cooling")

    assert breezy < still


def test_heating_airflow_adds_draft_penalty():
    still = perceived_temperature(air_temp_c=20.0, humidity=45.0, q_mix=0.0, mode="heating")
    drafty = perceived_temperature(air_temp_c=20.0, humidity=45.0, q_mix=1.0, mode="heating")

    assert drafty < still
