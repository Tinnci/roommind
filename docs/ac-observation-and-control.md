# AC Observation and Control / 空调观测与控制

RoomMind separates a requested comfort effect from device dispatch and observed physical activity. An AC's setpoint, an accepted command, room temperature drift, and electrical consumption describe different things.

RoomMind 将舒适需求、设备派发和物理活动观测分开处理。空调设定温度、指令接收、室温变化和耗电量分别描述不同事实，不能相互替代。

## Physical interpretation / 物理解释

An indoor unit's local sensor can disagree with the room sensor because of placement, stratification and coil temperature. Compressor startup, residual heat and inverter modulation also separate a requested setting from heat delivered to the room. RoomMind therefore uses reported `hvac_action` for its thermal activity input. `assumed_state`, missing feedback, conflicting heating/cooling, and `preheating` remain unknown. A successful service call never fills that gap.

内机局部感温可能受安装位置、空气分层和盘管温度影响；压缩机启动、余热和变频调节也会使设备设定与房间实际得热不同。热模型使用设备报告的 `hvac_action`。假定状态、缺失反馈、冷热冲突和预热状态均保留为未知，不以服务调用成功补齐。

Reported attributes also need a reliable origin. The installed TCL 0.10.0 driver synthesizes `hvac_action` from indoor temperature versus setpoint. RoomMind treats that legacy path as estimated, leaving thermal activity unknown. An explicit `hvac_action_is_estimated` attribute takes precedence, so an updated driver can describe its feedback without a version check. Reported power-off remains separate from a thermostat's idle estimate.

设备属性还必须有可靠来源。家庭安装的 TCL 0.10.0 驱动通过内机温度与设定点比较合成 `hvac_action`；RoomMind 将这条旧版路径视为推算，活动保留未知。明确的 `hvac_action_is_estimated` 属性优先，更新后的驱动可直接说明反馈来源，无需版本检查。设备报告关机与恒温器推算空闲分别处理。

The existing thermal model uses a binary activity indicator for observed heating/cooling. Its value of 1 means active during the observation, not measured 100% inverter capacity. The optional output observer provides diagnostics; its coarse capacity factors do not become measured training power.

现有热模型的活动量为二值：1 表示观测到供暖或制冷，不能解释为实测变频功率达到 100%。输出观测器提供诊断估计，其粗略容量系数不会作为实测训练功率。

| Available evidence / 可用证据 | Output interpretation / 输出解释 |
| --- | --- |
| Fresh electrical power / 新鲜电功率 | Normalize W, kW, MW or mW to watts. Generic power bands provide an **estimated** compressor stage. / 统一为瓦；通用功率区间仅提供**估计**档位。 |
| Heating/cooling action without power / 有冷热活动、无功率 | `compressor_active`: activity reported, load unknown. / 已报告压缩机活动，负载未知。 |
| Fan capacity/power curve / 风机容量或功率曲线 | A configured estimate, including fan-only electrical power. / 配置模型的估计值，风机功率不代表整机耗电。 |
| Missing or assumed feedback / 缺失或假定反馈 | Unknown; never infer off from a stored fan setting. / 未知，不能通过保存的风速设定推断停机。 |

Power readings reject nonfinite values, negative consumption and incompatible units such as kWh. Freshness uses `last_reported`, then `last_updated`, then `last_changed`, with the existing 300-second sensor limit. Unitless legacy power sensors retain the watts convention. In explicit power-sensor mode, unavailable power remains unknown; automatic mode can fall back to usable action feedback.

功率读数排除非有限数、负耗电量及 kWh 等不兼容单位。时效性依次采用报告、更新、状态变化时间，沿用现有 300 秒传感器限制。旧有无单位功率传感器继续按瓦解释。显式功率传感器模式下，读数不可用即保持未知；自动模式可退回有效的设备活动反馈。

A room's temperature slope is not a compressor-stage measurement. Solar gain, outdoor conditions, ventilation, thermal mass and startup lag all affect the same slope. Electrical power is also not thermal capacity without device-specific calibration.

室温斜率不能测量压缩机档位：太阳辐射、室外环境、通风、热惯性和启动时滞都会影响同一斜率。未经设备校准，电功率也不能直接当成制冷或制热量。

## One consistent observation / 单周期一致观测

Before any room actuates, the coordinator captures room temperature and humidity, climate feedback and limits, airflow, HVAC output, raw window state, occupancy and shading. These inputs travel in `RoomControlObservation`; temperature channels, airflow capabilities and status collections are tuples. Published lists are fresh copies.

在任一房间执行动作前，协调器先采集各房间的温湿度、设备反馈与限制、气流、暖通输出、原始窗户状态、占用和遮阳。这些输入随 `RoomControlObservation` 传递；温度通道、气流能力和状态集合使用不可变元组，发布时生成新的列表副本。

This prevents an early room's service call or an associated automation from changing another room's learning inputs halfway through the Control Cycle. Later feedback belongs to reconciliation or the next observation; it does not rewrite the interval ending at the captured temperature.

这样可以避免较早房间的服务调用或联动自动化，在控制周期中途改变另一房间的学习输入。后续反馈进入证据对账或下次观测，不回写已采集温度所对应的历史区间。

## Learning through feedback gaps / 反馈中断与学习

Unknown HVAC activity discards the pending thermal batch and updates only the measured temperature state. Thermal coefficients and learning counts remain unchanged, and temperature-to-parameter covariance is cleared because the intervening heat input is unknown. The first known endpoint after a gap starts a new interval. Sensor bias calibration also pauses while thermal activity is unknown. Window heat-loss calibration requires observed idle activity and no residual heat.

暖通活动未知时，丢弃待学习批次，仅同步实测温度。热工系数与学习计数保持不变；由于中间热输入未知，清除温度与参数之间的交叉协方差。恢复反馈后的第一个有效端点开启新区间。活动未知时也暂停传感器偏差校准；窗户换热校准要求观测为空闲且无余热。

## Dispatch evidence and module boundaries / 派发证据与模块边界

`control/hvac_observation.py` interprets captured signals without Home Assistant I/O. `managers/hvac_output_observer.py` reads HA state. `control/climate_actuator.py` handles climate dispatch, deduplication, device setpoint adaptation and idle fallbacks. MPC decides the requested behavior and consumes the operation results.

`control/hvac_observation.py` 纯计算解释观测，`managers/hvac_output_observer.py` 负责 HA 读取，`control/climate_actuator.py` 负责派发、去重、设备设定适配与空闲回退；MPC 负责决策并接收操作结果。

Off, low, setback and fan-only paths retain each required operation's dispatch status and HA context ID. A fan-only mode call and a fan-speed call remain separate evidence, including partial failure and confirmation arriving before the dispatch record. Existing setpoint-before-off valve protection, limits and no-off fallbacks remain in place. Dispatch does not confirm physical inactivity.

停机、低设定点、Setback 和仅送风路径均保留每项必要操作的派发状态与 HA context ID。模式切换与风速设置分别记账，支持部分失败及先于派发记录到达的确认事件。原有先降设定点再关机的阀门保护、设备限制和无关机模式回退继续生效；成功派发不代表物理停机已确认。

## Iteration evidence, 2026-09-12 / 本轮验证证据

Local household history and read-only SSH access to Recorder and raw observations became available during the iteration. The analysis covers 56,514 RoomMind history records and separately matched indoor and room reports. See [Household AC Analysis](household-ac-analysis-2026-09-12.md) for sources, measured temperature differences, plots and driver findings. No deployment, physical actuation, energy-saving claim or household capacity calibration was performed.

本轮使用本地家庭历史，并通过可用的 SSH 只读查询 Recorder 与原始观测；分析 56,514 条 RoomMind 历史，独立对齐内机与室温报告。[家庭空调实测分析](household-ac-analysis-2026-09-12.md)记录了来源、温差、图表和驱动结论。本轮没有部署、物理执行、节能结论或家庭专属容量校准。

Regression execution reproduced and corrected these failures:

回归执行复现并修复了以下问题：

- 0.8 kW was interpreted as 0.8 W and classified as off; it is now 800 W with an estimated medium-load stage.
- An earlier room's actuation changed an 800 W observation to 1200 W inside the same cycle; both rooms now keep the pre-dispatch value and environmental inputs.
- A **synthetic** 26 → 25.9 → 25.8 → 24°C sequence with unknown activity at the final endpoint changed the old model's normalized cooling coefficient from 4.0 to 6.863105. The corrected path keeps 4.0, adds no training update and tracks 24°C exactly.
- Failed or unsupported idle work was reported as inactive. Each required operation now contributes evidence, and incomplete work remains failed or unsupported.
- TCL's temperature-derived activity was treated as physical feedback. The driver now leaves it unknown, and RoomMind recognizes both the corrected source metadata and the legacy estimate.

The next household analysis should align physical compressor/electrical feedback with temperature and command evidence. Separate stable operation from startup and feedback gaps before choosing household-specific compensation or capacity curves.

后续实机分析需要继续对齐压缩机、电气反馈、温度与指令证据，分离稳定运行、启动和反馈中断区间，再选择家庭专属补偿及容量曲线。
