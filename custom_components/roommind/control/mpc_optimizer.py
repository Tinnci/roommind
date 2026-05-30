"""MPC Optimizer using Dynamic Programming for RoomMind."""

from __future__ import annotations

import math
from dataclasses import dataclass, field

from ..const import HEATING_SYSTEM_PROFILES, MIN_POWER_FRACTION, MODE_COOLING, MODE_FAN_ONLY, MODE_HEATING, MODE_IDLE
from .residual_heat import compute_residual_heat
from .thermal_model import RCModel

# Base lookahead for per-block decision cost evaluation. Radiator / unknown
# systems stay at this value; systems with long thermal time constants scale up.
LOOKAHEAD_BASE_BLOCKS = 6
# How many tau time-constants to include in the lookahead beyond min_run. Set to
# 1.0 so UFH lookahead (24 blocks = 120 min) matches the outer horizon minimum,
# avoiding silent clamping. See issue #131.
LOOKAHEAD_HORIZON_SCALE = 1.0


@dataclass
class MPCPlan:
    """Result of MPC optimization — a planned sequence of actions."""

    actions: list[str]
    temperatures: list[float]  # len = len(actions) + 1 (includes initial)
    dt_minutes: float = 5.0
    power_fractions: list[float] = field(default_factory=list)
    airflow_levels: list[float] = field(default_factory=list)
    mix_levels: list[float] = field(default_factory=list)
    vent_levels: list[float] = field(default_factory=list)
    # Per-system decision lookahead used when building this plan. Exposed so
    # the controller's safety guard can align its horizon with the optimizer's.
    lookahead_blocks: int = LOOKAHEAD_BASE_BLOCKS

    def get_current_action(self) -> str:
        """Return the action for the current (first) time block."""
        if not self.actions:
            return MODE_IDLE
        return self.actions[0]

    def get_current_power_fraction(self) -> float:
        """Power fraction for the current block. Backward-compatible."""
        if not self.power_fractions:
            return 1.0 if self.actions and self.actions[0] != MODE_IDLE else 0.0
        return self.power_fractions[0]

    def get_current_airflow_level(self) -> float:
        """Backward-compatible maximum airflow level for the current block."""
        return max(self.get_current_mix_level(), self.get_current_vent_level())

    def get_current_mix_level(self) -> float:
        """Mixing airflow level for the current block."""
        if self.mix_levels:
            return self.mix_levels[0]
        if self.airflow_levels:
            return self.airflow_levels[0]
        return 0.0

    def get_current_vent_level(self) -> float:
        """Ventilation airflow level for the current block."""
        if self.vent_levels:
            return self.vent_levels[0]
        return 0.0


@dataclass
class MPCOptimizer:
    """Dynamic Programming optimizer for heating/cooling control.

    Plans the optimal on/off schedule over a prediction horizon
    to minimize a weighted sum of temperature deviation and energy use.
    """

    model: RCModel
    can_heat: bool = True
    can_cool: bool = True
    w_comfort: float = 10.0
    w_energy: float = 1.0
    min_run_blocks: int = 2  # minimum 2 blocks (10 min) per run
    outdoor_cooling_min: float = 16.0
    outdoor_heating_max: float = 22.0
    temp_min: float = 5.0  # frost protection
    temp_max: float = 30.0  # overheat protection
    override_active: bool = False
    heating_system_type: str = ""  # key into HEATING_SYSTEM_PROFILES; "" = unknown
    airflow_levels: list[float] | None = None
    mix_levels: list[float] | None = None
    vent_levels: list[float] | None = None
    airflow_has_ventilation: bool = False
    airflow_has_hvac_fan: bool = False
    airflow_mix_score: float = 0.0
    airflow_energy_weight: float = 0.05
    airflow_mix_weight: float = 0.3
    airflow_active_hvac_mix_weight: float = 0.02
    airflow_hvac_power_weight: float = 0.25
    airflow_capacity_curve: list[dict[str, float]] | None = None
    airflow_power_curve: list[dict[str, float]] | None = None
    control_target: str = "air_temperature"
    current_humidity: float | None = None
    night_quiet_penalty: float = 0.0
    coupling_terms: list[dict] | None = None
    optimizer_strategy: str = "greedy"

    def __post_init__(self) -> None:
        # Set before optimize() runs so callers / patched optimize() still expose
        # a sensible default. optimize() refreshes this from dt_minutes per call.
        self._lookahead_blocks = LOOKAHEAD_BASE_BLOCKS

    def optimize(
        self,
        T_room: float,
        T_outdoor_series: list[float],
        heat_target_series: list[float],
        cool_target_series: list[float] | None = None,
        dt_minutes: float = 5.0,
        *,
        solar_series: list[float] | None = None,
        residual_series: list[float] | None = None,
        occupancy_series: list[float] | None = None,
    ) -> MPCPlan:
        """Find optimal action sequence over the planning horizon.

        Uses forward simulation with greedy optimization per block,
        considering minimum run time constraints.

        Accepts dual target series (heat_target_series + cool_target_series)
        for dead-band-aware optimization. If cool_target_series is None,
        it defaults to heat_target_series (single-target behavior).
        """
        if self.optimizer_strategy == "horizon_search":
            return self._optimize_horizon_search(
                T_room,
                T_outdoor_series,
                heat_target_series,
                cool_target_series,
                dt_minutes,
                solar_series=solar_series,
                residual_series=residual_series,
                occupancy_series=occupancy_series,
            )
        if self.optimizer_strategy != "greedy":
            raise ValueError(f"Unknown optimizer_strategy: {self.optimizer_strategy}")

        if cool_target_series is None:
            cool_target_series = list(heat_target_series)

        # Clamp inverted targets: cool must be >= heat
        cool_target_series = [max(h, c) for h, c in zip(heat_target_series, cool_target_series, strict=False)]

        # Per-system decision lookahead. UFH (tau=90min) scales up so the cost
        # function can see post-heating residual afterglow; radiator / "" stay
        # at LOOKAHEAD_BASE_BLOCKS for byte-identical behaviour. Hybrid UFH+AC
        # rooms (can_cool=True) also keep the base lookahead: extending the
        # horizon without a matching cooling-side synthesis would shift the
        # energy/comfort ratio for COOLING and cause more aggressive AC use.
        profile = HEATING_SYSTEM_PROFILES.get(self.heating_system_type) if self.heating_system_type else None
        if profile and dt_minutes > 0 and not self.can_cool:
            tau_blocks = math.ceil(profile["tau_minutes"] / dt_minutes)
            self._lookahead_blocks = max(
                LOOKAHEAD_BASE_BLOCKS,
                self.min_run_blocks + math.ceil(LOOKAHEAD_HORIZON_SCALE * tau_blocks),
            )
        else:
            self._lookahead_blocks = LOOKAHEAD_BASE_BLOCKS

        n_blocks = min(len(T_outdoor_series), len(heat_target_series), len(cool_target_series))
        if n_blocks == 0 or not math.isfinite(T_room):
            return MPCPlan(actions=[], temperatures=[T_room], dt_minutes=dt_minutes)

        q_solar = solar_series or [0.0] * n_blocks
        q_residual = residual_series or [0.0] * n_blocks
        q_occupancy = occupancy_series or [0.0] * n_blocks
        mix_candidates = self._normalized_mix_levels()
        vent_candidates = self._normalized_vent_levels()

        actions: list[str] = []
        temperatures: list[float] = [T_room]
        power_fractions: list[float] = []
        legacy_airflow_plan: list[float] = []
        mix_plan: list[float] = []
        vent_plan: list[float] = []
        current_temp = T_room
        current_mode = MODE_IDLE
        blocks_in_mode = 0

        for i in range(n_blocks):
            T_out = T_outdoor_series[i]
            heat_tgt = heat_target_series[i]
            cool_tgt = cool_target_series[i]
            qs = q_solar[i] if i < len(q_solar) else 0.0
            qr = q_residual[i] if i < len(q_residual) else 0.0
            qo = q_occupancy[i] if i < len(q_occupancy) else 0.0

            # Determine available actions this block
            available = [MODE_IDLE]
            if self.can_heat and not self._is_outdoor_gated(MODE_HEATING, T_out):
                available.append(MODE_HEATING)
            if self.can_cool and not self._is_outdoor_gated(MODE_COOLING, T_out):
                available.append(MODE_COOLING)

            # If in a run and below min_run_blocks, must continue
            if current_mode != MODE_IDLE and blocks_in_mode < self.min_run_blocks:
                if current_mode in available:
                    best_action = current_mode
                else:
                    best_action = MODE_IDLE  # forced off by constraint
                best_mix, best_vent = self._best_airflow_for_action(
                    best_action,
                    current_temp,
                    T_out,
                    heat_tgt,
                    cool_tgt,
                    T_outdoor_series[i:],
                    heat_target_series[i:],
                    cool_target_series[i:],
                    dt_minutes,
                    mix_candidates,
                    vent_candidates,
                    future_solar=q_solar[i:] if q_solar else None,
                    future_residual=q_residual[i:] if q_residual else None,
                    future_occupancy=q_occupancy[i:] if q_occupancy else None,
                )
            else:
                # Evaluate each action: look ahead to find best
                best_action = MODE_IDLE
                best_mix = 0.0
                best_vent = 0.0
                best_cost = float("inf")
                future_solar = q_solar[i:] if q_solar else None
                future_residual = q_residual[i:] if q_residual else None
                future_occupancy = q_occupancy[i:] if q_occupancy else None
                for action in available:
                    for mix_level in mix_candidates:
                        for vent_level in vent_candidates:
                            cost = self._evaluate_action(
                                action,
                                current_temp,
                                T_out,
                                heat_tgt,
                                cool_tgt,
                                T_outdoor_series[i:],
                                heat_target_series[i:],
                                cool_target_series[i:],
                                dt_minutes,
                                mix_level=mix_level,
                                vent_level=vent_level,
                                future_solar=future_solar,
                                future_residual=future_residual,
                                future_occupancy=future_occupancy,
                            )
                            if cost < best_cost:
                                best_cost = cost
                                best_action = action
                                best_mix = mix_level
                                best_vent = vent_level

            # Compute proportional power fraction for this block
            # Use heat target for heating power, cool target for cooling power
            pf_target = heat_tgt if best_action == MODE_HEATING else cool_tgt
            pf, _ = self.compute_optimal_power(
                current_temp,
                T_out,
                pf_target,
                dt_minutes,
                q_solar=qs,
                q_residual=qr,
                q_occupancy=qo,
                q_vent=best_vent,
                q_mix=best_mix,
            )
            if best_action in (MODE_IDLE, MODE_FAN_ONLY):
                pf = 0.0
            elif best_action != MODE_IDLE and pf == 0.0:
                pf = 1.0  # min_run_blocks enforcement: keep full power

            # Apply action with proportional Q for accurate forward prediction
            if best_action == MODE_HEATING:
                Q = pf * self._effective_hvac_capacity(MODE_HEATING, best_mix)
            elif best_action == MODE_COOLING:
                Q = -(pf * self._effective_hvac_capacity(MODE_COOLING, best_mix))
            else:
                Q = 0.0
            next_temp = self.model.predict(
                current_temp,
                T_out,
                Q,
                dt_minutes,
                q_solar=qs,
                q_residual=qr if Q == 0.0 else 0.0,
                q_occupancy=qo,
                q_vent=best_vent,
                coupling_terms=self.coupling_terms,
            )
            next_temp = max(self.temp_min, min(next_temp, self.temp_max))

            plan_action = (
                MODE_FAN_ONLY if best_action == MODE_IDLE and best_mix > 0.0 and best_vent <= 0.0 else best_action
            )
            actions.append(plan_action)
            temperatures.append(round(next_temp, 2))
            power_fractions.append(round(pf, 3))
            mix_plan.append(round(best_mix, 3))
            vent_plan.append(round(best_vent, 3))
            legacy_airflow_plan.append(round(max(best_mix, best_vent), 3))

            # Track run length
            if best_action == current_mode:
                blocks_in_mode += 1
            else:
                current_mode = best_action
                blocks_in_mode = 1

            current_temp = next_temp

        return MPCPlan(
            actions=actions,
            temperatures=temperatures,
            dt_minutes=dt_minutes,
            power_fractions=power_fractions,
            airflow_levels=legacy_airflow_plan,
            mix_levels=mix_plan,
            vent_levels=vent_plan,
            lookahead_blocks=self._lookahead_blocks,
        )

    def _optimize_horizon_search(
        self,
        T_room: float,
        T_outdoor_series: list[float],
        heat_target_series: list[float],
        cool_target_series: list[float] | None = None,
        dt_minutes: float = 5.0,
        *,
        solar_series: list[float] | None = None,
        residual_series: list[float] | None = None,
        occupancy_series: list[float] | None = None,
    ) -> MPCPlan:
        """Experimental horizon-search entrypoint.

        The strategy is intentionally isolated behind a setting while it is
        benchmarked against the production greedy lookahead path.
        """
        previous = self.optimizer_strategy
        self.optimizer_strategy = "greedy"
        try:
            return self.optimize(
                T_room,
                T_outdoor_series,
                heat_target_series,
                cool_target_series,
                dt_minutes,
                solar_series=solar_series,
                residual_series=residual_series,
                occupancy_series=occupancy_series,
            )
        finally:
            self.optimizer_strategy = previous

    def _best_airflow_for_action(
        self,
        action: str,
        current_temp: float,
        T_out: float,
        heat_tgt: float,
        cool_tgt: float,
        future_T_outdoor: list[float],
        future_heat_targets: list[float],
        future_cool_targets: list[float],
        dt_minutes: float,
        mix_candidates: list[float],
        vent_candidates: list[float],
        *,
        future_solar: list[float] | None = None,
        future_residual: list[float] | None = None,
        future_occupancy: list[float] | None = None,
    ) -> tuple[float, float]:
        best_mix = 0.0
        best_vent = 0.0
        best_cost = float("inf")
        for mix_level in mix_candidates:
            for vent_level in vent_candidates:
                cost = self._evaluate_action(
                    action,
                    current_temp,
                    T_out,
                    heat_tgt,
                    cool_tgt,
                    future_T_outdoor,
                    future_heat_targets,
                    future_cool_targets,
                    dt_minutes,
                    mix_level=mix_level,
                    vent_level=vent_level,
                    future_solar=future_solar,
                    future_residual=future_residual,
                    future_occupancy=future_occupancy,
                )
                if cost < best_cost:
                    best_cost = cost
                    best_mix = mix_level
                    best_vent = vent_level
        return best_mix, best_vent

    def _evaluate_action(
        self,
        action: str,
        T_room: float,
        T_outdoor: float,
        heat_target: float,
        cool_target: float,
        future_T_outdoor: list[float],
        future_heat_targets: list[float],
        future_cool_targets: list[float],
        dt_minutes: float,
        *,
        mix_level: float = 0.0,
        vent_level: float = 0.0,
        future_solar: list[float] | None = None,
        future_residual: list[float] | None = None,
        future_occupancy: list[float] | None = None,
    ) -> float:
        """Evaluate the cost of taking an action, looking a few steps ahead.

        Per-system lookahead (self._lookahead_blocks) extends the window for
        slow heating systems. For UFH, the HEATING hypothesis synthesizes its
        own post-heating residual afterglow so the cost function values the
        sustained-comfort benefit of pre-heating. Radiator / "" lookahead stays
        at LOOKAHEAD_BASE_BLOCKS and synthesis is gated off — byte-identical
        to pre-fix behaviour.
        """
        lookahead = min(self._lookahead_blocks, len(future_T_outdoor))
        Q = self._action_to_Q(action, mix_level)
        total_cost = 0.0
        T = T_room
        solar = future_solar or []
        residual = future_residual or []
        occupancy = future_occupancy or []
        synthesis_enabled = (
            action == MODE_HEATING
            and self._lookahead_blocks > LOOKAHEAD_BASE_BLOCKS
            and self.min_run_blocks > 0
            and bool(self.heating_system_type)
        )
        heating_duration_minutes = self.min_run_blocks * dt_minutes

        for j in range(lookahead):
            qs = solar[j] if j < len(solar) else 0.0
            qo = occupancy[j] if j < len(occupancy) else 0.0
            qv = vent_level
            # Simulate HVAC for min_run_blocks (not just 1 block) to correctly
            # value sustained heating/cooling over the lookahead horizon.
            block_Q = Q if j < self.min_run_blocks else 0.0
            # Residual for the idle / post-run blocks. For the HEATING
            # hypothesis on a gated slow system, synthesize the afterglow this
            # hypothetical run would generate; otherwise fall back to the
            # controller-provided current-state decay.
            if synthesis_enabled and j >= self.min_run_blocks:
                elapsed = (j - self.min_run_blocks) * dt_minutes
                qr = compute_residual_heat(
                    elapsed,
                    self.heating_system_type,
                    last_power_fraction=1.0,
                    heating_duration_minutes=heating_duration_minutes,
                )
            else:
                qr = residual[j] if j < len(residual) else 0.0
            T = self.model.predict(
                T,
                future_T_outdoor[j],
                block_Q,
                dt_minutes,
                q_solar=qs,
                q_residual=qr if block_Q == 0.0 else 0.0,
                q_occupancy=qo,
                q_vent=qv,
                coupling_terms=self.coupling_terms,
            )
            # Clamp temperature in lookahead to prevent cost explosion
            # from implausible model predictions
            T = max(self.temp_min, min(self.temp_max, T))
            h_tgt = future_heat_targets[j] if j < len(future_heat_targets) else heat_target
            c_tgt = future_cool_targets[j] if j < len(future_cool_targets) else cool_target
            # Dead-band-aware comfort cost. When configured, compare targets
            # against perceived temperature so airflow can be valued for comfort
            # without needing to overcool/overheat the actual room air.
            comfort_temp = self._comfort_temperature(T, action, mix_level)
            if comfort_temp < h_tgt:
                total_cost += self.w_comfort * (comfort_temp - h_tgt) ** 2
            elif comfort_temp > c_tgt:
                total_cost += self.w_comfort * (comfort_temp - c_tgt) ** 2
            # else: inside dead band, no comfort cost
            # Energy cost: proportional to HVAC power for min_run blocks
            if j < self.min_run_blocks and action != MODE_IDLE:
                total_cost += self.w_energy * abs(Q) / 1000.0
            if mix_level > 0.0:
                airflow_energy = self._airflow_power_cost(mix_level)
                total_cost += self.w_energy * airflow_energy
                total_cost += self.night_quiet_penalty * mix_level
                total_cost -= self.airflow_mix_weight * max(0.0, min(1.0, self.airflow_mix_score)) * mix_level
                if action != MODE_IDLE:
                    total_cost -= self.airflow_active_hvac_mix_weight * mix_level
            if vent_level > 0.0:
                total_cost += self.w_energy * self.airflow_energy_weight * vent_level

        if action == MODE_IDLE and mix_level > 0.0 and vent_level <= 0.0:
            total_cost -= 1e-6
        return total_cost

    def _action_to_Q(self, action: str, mix_level: float = 0.0) -> float:
        if action == MODE_HEATING:
            return self._effective_hvac_capacity(MODE_HEATING, mix_level)
        if action == MODE_COOLING:
            return -self._effective_hvac_capacity(MODE_COOLING, mix_level)
        return 0.0

    def _is_outdoor_gated(self, mode: str, T_outdoor: float) -> bool:
        if self.override_active:
            return False
        if mode == MODE_COOLING and T_outdoor < self.outdoor_cooling_min:
            return True
        if mode == MODE_HEATING and T_outdoor > self.outdoor_heating_max:
            return True
        return False

    def compute_optimal_power(
        self,
        T_room: float,
        T_outdoor: float,
        target: float,
        dt_minutes: float,
        *,
        q_solar: float = 0.0,
        q_residual: float = 0.0,
        q_occupancy: float = 0.0,
        q_vent: float = 0.0,
        q_mix: float = 0.0,
    ) -> tuple[float, str]:
        """Analytical closed-form optimal heating/cooling power.

        Returns (power_fraction in [0,1], mode).
        """
        if not math.isfinite(T_room) or not math.isfinite(target):
            return 0.0, MODE_IDLE

        dt_h = dt_minutes / 60.0
        alpha = self.model.U + max(0.0, self.model.beta_vent) * max(0.0, min(1.0, q_vent))
        if alpha < 0.01:
            beta = alpha * dt_h  # Euler approx for tiny alpha
        else:
            beta = 1.0 - math.exp(-alpha * dt_h)

        if beta < 1e-9:
            return 0.0, MODE_IDLE

        # Drift temperature: where the room would go with no HVAC
        T_drift = T_room + beta * (T_outdoor - T_room)
        # Add predicted solar gain to drift
        if alpha > 0.01:
            T_drift += beta * self.model.Q_solar * q_solar / alpha
        else:
            T_drift += self.model.Q_solar * q_solar * dt_h
        # Add residual heat from thermal mass to drift
        if q_residual > 0:
            if alpha > 0.01:
                T_drift += beta * self.model.Q_heat * q_residual / alpha
            else:
                T_drift += self.model.Q_heat * q_residual * dt_h
        # Add predicted occupancy gain to drift
        if q_occupancy > 0:
            if alpha > 0.01:
                T_drift += beta * self.model.Q_occupancy * q_occupancy / alpha
            else:
                T_drift += self.model.Q_occupancy * q_occupancy * dt_h

        Q_required = (target - T_drift) * alpha / beta

        # Energy penalty: bias toward less power based on comfort/energy weights
        energy_bias = (self.w_energy / max(self.w_comfort, 0.01)) * alpha / beta * 0.1
        if Q_required > 0:
            Q_required = max(0.0, Q_required - energy_bias)
        elif Q_required < 0:
            Q_required = min(0.0, Q_required + energy_bias)

        if Q_required > 0 and self.can_heat and not self._is_outdoor_gated(MODE_HEATING, T_outdoor):
            frac = min(Q_required / max(self._effective_hvac_capacity(MODE_HEATING, q_mix), 0.01), 1.0)
            return max(frac, MIN_POWER_FRACTION), MODE_HEATING
        elif Q_required < 0 and self.can_cool and not self._is_outdoor_gated(MODE_COOLING, T_outdoor):
            frac = min(abs(Q_required) / max(self._effective_hvac_capacity(MODE_COOLING, q_mix), 0.01), 1.0)
            return max(frac, MIN_POWER_FRACTION), MODE_COOLING
        else:
            return 0.0, MODE_IDLE

    def _effective_hvac_capacity(self, action: str, mix_level: float) -> float:
        if action == MODE_HEATING:
            base = self.model.Q_heat
        elif action == MODE_COOLING:
            base = self.model.Q_cool
        else:
            return 0.0
        if not self.airflow_has_hvac_fan:
            return base
        mix = max(0.0, min(1.0, mix_level))
        curve_factor = self._curve_value(self.airflow_capacity_curve, mix, "capacity_factor")
        if curve_factor is not None:
            return base * max(0.0, curve_factor)
        return base * (1.0 + self.airflow_hvac_power_weight * mix)

    def _comfort_temperature(self, temp: float, action: str, mix_level: float) -> float:
        if self.control_target != "perceived_temperature":
            return temp
        q = max(0.0, min(1.0, mix_level))
        humidity_penalty = 0.0
        if self.current_humidity is not None:
            humidity_penalty = max(0.0, float(self.current_humidity) - 60.0) * 0.03
        if action == MODE_COOLING:
            return temp - 1.2 * math.sqrt(q) + humidity_penalty
        if action == MODE_HEATING:
            return temp - 0.6 * math.sqrt(q)
        return temp - 0.8 * math.sqrt(q) + humidity_penalty

    def _airflow_power_cost(self, mix_level: float) -> float:
        power_w = self._curve_value(self.airflow_power_curve, mix_level, "power_w")
        if power_w is not None:
            return max(0.0, power_w) / 1000.0
        return self.airflow_energy_weight * mix_level

    @staticmethod
    def _curve_value(curve: list[dict[str, float]] | None, level: float, key: str) -> float | None:
        points: list[tuple[float, float]] = []
        for item in curve or []:
            try:
                x = max(0.0, min(1.0, float(item.get("level", 0.0))))
                y = float(item[key])
            except (KeyError, TypeError, ValueError):
                continue
            points.append((x, y))
        if not points:
            return None
        points.sort(key=lambda item: item[0])
        x = max(0.0, min(1.0, level))
        if x <= points[0][0]:
            return points[0][1]
        if x >= points[-1][0]:
            return points[-1][1]
        for (x0, y0), (x1, y1) in zip(points, points[1:], strict=False):
            if x0 <= x <= x1:
                if abs(x1 - x0) < 1e-9:
                    return y1
                return y0 + (y1 - y0) * ((x - x0) / (x1 - x0))
        return points[-1][1]

    def _normalized_mix_levels(self) -> list[float]:
        levels = self.mix_levels if self.mix_levels is not None else self.airflow_levels
        return self._normalized_levels(levels or [0.0])

    def _normalized_vent_levels(self) -> list[float]:
        levels = (
            self.vent_levels
            if self.vent_levels is not None
            else (self.airflow_levels if self.airflow_has_ventilation else [0.0])
        )
        return self._normalized_levels(levels or [0.0])

    def _normalized_airflow_levels(self) -> list[float]:
        return self._normalized_levels(self.airflow_levels or [0.0])

    def _normalized_levels(self, levels: list[float]) -> list[float]:
        result = {0.0}
        for level in levels:
            if math.isfinite(level):
                result.add(round(max(0.0, min(1.0, level)), 3))
        return sorted(result)
