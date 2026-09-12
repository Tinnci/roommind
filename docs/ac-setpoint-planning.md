# AC Setpoint Planning and Quiet Control / 空调设定规划与安静控制

## Comfort and device settings / 舒适目标与设备设定

The Effective Target Plan remains the room's comfort policy. A device setpoint is
an execution choice. Changing that setpoint never rewrites a schedule, override,
heat target or cool target. A requested percentage describes control demand;
it is not measured inverter capacity or electrical power.

Effective Target Plan 始终表达房间舒适策略；设备设定值属于执行手段。动态调整
设备设定不会改写时间表、临时覆盖或冷热目标。请求百分比是调节需求，不能作为
实测变频容量或电功率。

In Full Control, proportional devices interpolate from observed room temperature
toward their permitted overdrive endpoint. A configured maximum offset limits
that endpoint **before** interpolation. Partial demand therefore relaxes overdrive
instead of repeatedly saturating the same cap. Direct devices use the comfort
target. Device limits, temperature units, range thermostats and step rounding
are then applied; rounding cannot cross a configured offset limit. An impossible
combination of limits is reported as unsupported.

完整控制下，比例设备从观测室温向允许的调节端点插值；最大偏移量在插值前限制
端点，使部分需求可以逐渐回收调节幅度，而非持续顶在上限。直接控制使用舒适目标。
随后处理设备范围、温度单位、双设定值和步长；取整不得越过偏移限制。设备范围与
策略无法兼容时，明确报告不支持。

Example with a 26°C room, 24°C cooling target and 2°C maximum offset:

示例：室温 26°C、制冷目标 24°C、最大偏移 2°C：

| Demand / 需求 | Proportional setpoint / 比例设定 | Direct setpoint / 直接设定 |
| --- | --- | --- |
| 50% | 24°C | 24°C |
| 75% | 23°C | 24°C |
| 100% | 22°C | 24°C |

An empty offset preserves the previous device-range endpoint. Zero uses the room
target, subject to representable device steps. These settings bound the command;
they do not promise a particular room overshoot, compressor speed or recovery time.

偏移留空沿用原有设备范围端点；设为零使用房间目标，并服从设备可表达的步长。
这些规则限制的是指令，不能保证实际室温过冲、压缩机转速或恢复时间。

## Fewer disturbances / 减少打扰

- AC shutdown sends off without first requesting the minimum temperature. TRVs
  retain setpoint-before-off protection. Low, Setback, Fan only and devices without
  an off mode retain their dedicated fallbacks.
- Proportional AC temperature increases in heating, or decreases in cooling,
  smaller than 2°C are coalesced for up to 120 seconds after the preceding write;
  quiet hours extend this to 300 seconds. This requires a matching observed mode
  and feedback matching the preceding setpoint. The latest plan is recomputed
  every cycle, so obsolete intermediate settings are never queued for replay.
- An unchanged temperature request with unchanged, contradictory feedback uses
  the same bounded retry interval. A new observed override can be corrected
  immediately. Dispatch failures remain retryable on the next cycle.
- Load reduction, changed comfort targets or offset limits, changes of at least
  2°C, Direct/Managed control, rapid recovery and compressor-protection commands
  bypass this pacing. Window pauses and off remain immediate.

空调关机直接发送 off，避免先压到最低温度；TRV 的关阀保护保留。比例空调的小幅
加力调节按日间 120 秒、安静时段 300 秒合并；每周期重新计算最新计划，不排队重放
旧设定。反馈未变化时限制重复请求频率；观测到外部修改后可立即纠正。降负载、
舒适目标或偏移限制变化、大幅修正、直接/托管控制、快速恢复、压缩机保护及开窗
停机均不受该等待限制。时间间隔是控制策略，尚未通过家庭实机校准。

A deterministic 18-cycle test alternates requests for 24°C and 23.5°C at 30-second
intervals. With immediate simulated device feedback, quiet control sends three
temperature writes and promptly returns to 24°C when demand drops. This measures
command traffic in a simulation, not household comfort, noise or energy savings.

确定性测试以 30 秒周期交替请求 24°C 与 23.5°C，在模拟立即反馈的条件下，18 个周期
只产生 3 次调温，并在降负载时及时回到 24°C。这是指令流量模拟，不是家庭舒适度、
噪声或节能率的实测结论。

## Night accessories and evidence / 夜间附件与证据

Accessory observations are captured with climate observations before any room
actuates. Configured beepers and sound controls are dispatched before displays,
climate commands and airflow commands. Service completion means **sent**, with
physical application still pending. TCL events reconcile by HA context ID even
when they arrive before the dispatch record.

夜间附件与气候设备共用执行前观测；先处理蜂鸣器/声音，再处理显示屏、空调和气流。
服务完成只表示 **已发送**。TCL 的物理确认通过 HA context ID 对账，兼容确认事件
先于派发记录到达的情况。

Unknown or unavailable accessory values are not saved as restoration values.
Observed changes can trigger reapplication of the configured night policy.
Missing feedback or failed dispatch retries after 2, 4, 8, then at most 15 minutes.
Restoration retains its saved value until matching observation or confirmation;
an outstanding night command cannot erase a pending day restoration. Assumed
state can suppress duplicate writes but cannot establish physical confirmation.

未知或不可用状态不会被保存为白天恢复值；观测到修改后可以重申夜间策略。缺少反馈或
下发失败按 2、4、8、最多 15 分钟退避重试。恢复期间保留原值直到匹配观测或确认，
避免迟到的夜间指令令恢复丢失。假定状态可以用于去重，不能证明物理应用。

The room's `device_setpoint` summarizes the actual device plan after constraints,
not a second calculation and not a reported physical setting. The per-operation
`device_actuation_status` includes desired HA-unit payloads, dispatch, acceptance,
application, context ID and diagnostics. **Deferred** is distinct from failed,
sent, skipped and confirmed. Deferred work cannot claim that the new plan is active.

房间 `device_setpoint` 摘要来自约束后的实际计划，不另算近似值，也不是设备物理报告。
`device_actuation_status` 按操作提供 HA 单位的目标载荷、派发、接收、应用、context ID
与诊断。**延后** 与失败、已发送、跳过、已确认分别表达；延后不能声称新计划已生效。

## TCL protocol work / TCL 协议协同

The companion driver uses standalone temperature writes when heating or cooling
mode is unchanged. It preserves fan, beep and display settings; the existing
capture-supported Turbo reset remains part of a Legacy temperature write. Actual
mode transitions still use the profile's grouped power/mode/temperature command,
and its confirmation now requires temperature feedback as well as power and mode.

配套驱动在冷热模式不变时使用独立调温，保留风速、蜂鸣与显示设置；Legacy 调温中原有
且有抓包支持的 Turbo 复位仍保留。真正切换模式继续使用协议配置的整组指令，其确认
同时要求电源、模式与温度反馈。

Legacy integer-Fahrenheit encoding and the half-Celsius flag introduce up to
0.2°C of decoded representation difference for nominal half-degree targets. All
31 targets from 16°C to 31°C are checked. Legacy profiles declare a 0.25°C target
comparison tolerance, carried through receipt and confirmation tracking. A 0.5°C
mismatch still fails; TSL native-Celsius comparisons retain their existing precision.
Reported values are preserved. Accessory entities also expire their own field
feedback, independently of unrelated temperature reports.

The driver exposes `target_temp_step_c` and `target_temp_tolerance_c` as protocol
capabilities. RoomMind uses the native Celsius grid before converting a command
to HA units, and converts tolerance as a temperature difference. This prevents
both a Celsius/Fahrenheit rounding mismatch and repeated writes for an equivalent
encoded report. Deduplication remains distinct from confirmation.

Legacy 整数华氏字段和半摄氏度标志可能令名义半度设定在解码后产生最多 0.2°C 表达差；
测试覆盖 16–31°C 的全部 31 个半度设定点。Legacy 配置声明 0.25°C 温度比较容差，
随派发凭据进入确认流程；相差 0.5°C 仍拒绝确认，TSL 原生摄氏比较精度不变。
设备报告值不被改写。蜂鸣器等附件也按自身字段报告过期，不被无关温度更新续期。

驱动通过 `target_temp_step_c` 与 `target_temp_tolerance_c` 声明协议能力。RoomMind
先按原生摄氏步长取整，再转换为 HA 单位；容差按温差转换，避免摄氏/华氏二次取整
与编码等价报告引发重复下发。去重仍不代表物理确认。

These local changes do not establish that a particular device honors beep/display
settings, nor do they calibrate household thermal capacity. Physical observation
and the remaining household validation are still required.

本地实现不能证明某台实机确实执行了静音/熄屏，也不构成家庭热容量校准；这些结论仍
需要后续实机观测与验证。
