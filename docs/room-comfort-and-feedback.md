# 房间舒适度与设备反馈 / Room comfort and device feedback

RoomMind 的日常操作对象是房间的舒适目标。空调或暖气阀的机身设定是系统达到目标的执行手段，两者可以不同。
例如房间目标为 24°C、空调计划设定为 22°C、设备上次报告为 25°C，这三个数字分别描述目标、计划和观测，没有一个能单独证明压缩机正在运行。

Daily controls express the comfort you want in the room. A device setpoint is a means of reaching that comfort.
A 24°C room target, a planned 22°C AC setting and a last reported 25°C device setting describe different facts.
None of those temperatures alone establishes compressor activity.

## 日常界面 / Daily interface

- **室温与舒适目标 / Room temperature and comfort target**：顶部和房间卡片显示观测温度与生效目标。自动模式保留供暖/制冷舒适区间；23°C 在 21–24°C 区间内时不会显示“高于目标 2°C”。使用体感控制时，舒适判断采用体感温度，并在详情顶部说明依据。
  The hero and room cards show observed temperature and the effective comfort target. Auto mode preserves the heat/cool range. Comfort comparisons use the configured air or perceived temperature basis.
- **调温与保持 / Adjust and hold**：编辑区提供目标、保持时长、模式和舒适/节能快捷操作。编辑和保存反馈留在编辑区，顶部目标由下一份控制快照更新。
  The editor provides a target, hold duration, regulation mode and comfort/eco shortcuts. Local edit feedback stays in the editor; the hero reads the published room snapshot.
- **未知与缓存 / Unknown and cached**：缺失活动反馈保持“未知”，不计为稳定或待机。暂存的室温标为“上次已知温度”，不据此宣称房间已舒适。
  Missing activity is unknown, including before the first observation. Retained temperatures are labeled “Last known temperature” and cannot establish comfort.
- **渐进详情 / Details on demand**：“设备计划与反馈”默认折叠，展开后显示主传感器、控制请求、逐设备报告和计划，以及静音/显示附件的目标与报告。未确认、失败、不支持、等待调节仍可从摘要看到。
  Device plans and feedback load when expanded. Pending, unconfirmed, failed, unsupported and deferred work remains visible in the summary. Device names open HA more-info.
- **视觉与操作 / Visuals and interaction**：轻量冷暖底色仅跟随观测活动；留白和字体层级突出温度。温度步进按钮至少 44px，选择按钮提供按下状态和键盘焦点；减少动态效果偏好会关闭这些过渡。
  Subtle warm/cool surfaces follow observed activity. Spacing and type prioritize temperature. Temperature step buttons have 44px touch targets; selected controls expose pressed state and keyboard focus. Reduced-motion preferences disable the new transitions.

高级传感器、设备和模型设置继续从房间配置进入，不挤占日常调温区域。
Advanced sensors, devices and model settings remain in room configuration.

## Home Assistant 实体 / Home Assistant entities

| Entity | Responsibility / 职责 |
| --- | --- |
| `climate.roommind_{area_id}_comfort` | Daily room comfort policy; effective target and observed room activity. 日常舒适目标入口。 |
| `switch.roommind_{area_id}_climate_control` | Enable or pause RoomMind for this room. 房间自动控制开关。 |
| `sensor.roommind_{area_id}_target_temp` | Effective scalar target used by the Control Cycle. 当前生效的单值目标。 |
| `sensor.roommind_{area_id}_mode` | Observed heating, cooling, fan-only or idle; unknown without feedback. 观测活动，缺失即未知。 |
| `climate.roommind_{area_id}_override` | Existing compatibility endpoint for temporary overrides. 旧手动覆盖入口。 |
| Hardware climate, switch, select and sensor entities | Device settings, physical reports and hardware controls, owned by their driver. 驱动负责设备设置、观测和硬件操作。 |

### Comfort endpoint

The new comfort endpoint supports `climate.set_temperature` and two presets:

- `schedule`: clear the temporary override and resume room policy, including schedule, presence, vacation and comfort constraints.
- `hold`: retain the current effective scalar target until the override is cleared. If there is no target yet, the service returns an error instead of inventing 21°C. An existing hold is left intact.

新舒适实体支持设温、`schedule`（恢复房间策略）和 `hold`（保持当前生效的单值目标）。
直接设温也创建永久手动目标；有时长的覆盖仍可使用 RoomMind 面板。防霉、夜间等已有策略约束继续生效。

Its sole HVAC mode is `auto`, meaning RoomMind regulates the room according to its configured policy.
Heat-only/cool-only selection stays in RoomMind's mode controls. The endpoint does not offer a power button.
Use the room control switch to pause RoomMind before taking manual control of the hardware.
It is unavailable before a room snapshot exists, for outdoor/device-less rooms, or while room/global control is disabled.

唯一 HVAC 模式 `auto` 表示由 RoomMind 自动调节；允许供暖、制冷的范围仍由房间模式决定。
此实体不提供容易与“取消覆盖”混淆的电源按钮。需要直接操作硬件时，可先暂停房间自动控制，再使用驱动实体。
未取得房间快照、室外、没有温控设备或自动控制暂停时，此入口不可用。

`current_temperature` uses the coordinator's room temperature observation. Full Control uses the configured external sensor;
Managed Mode may use the device's reported current temperature, as explained by its control-mode information.
If the current reading is missing, a retained value is not exposed as a fresh measurement.
`target_temperature` comes from the Effective Target Plan, never from a device overdrive setting.
With an auto comfort range, `heat_target` and `cool_target` expose both bounds.
`hvac_action` is set only from observed physical activity; accepted or confirmed settings cannot set it.

`current_temperature` 是房间空气温度；`target_temperature` 是生效目标。
体感控制依据由 `control_target` 与 `perceived_temperature` 表达。
`override_temperature` 保留手动请求，`override_suppressed` 表明覆盖是否受抑制，避免把请求值误读为生效值。
额外温度属性采用摄氏度，并由 `target_temperature_unit` 明示；HA 自身的标准温度属性按其单位设置展示。

The extra attributes retain the requested override and whether it is suppressed, plus observation and dispatch status.
Extra temperature attributes use Celsius with an explicit `target_temperature_unit`; HA handles unit conversion for its standard temperature attributes.
Policy writes are serialized by the store and request a Control Cycle. Entity services never directly command hardware.

### Compatibility and automations / 兼容与自动化

Existing `_override` entity IDs and unique IDs remain unchanged. Their `off` action still clears the override and resumes policy.
Newly registered legacy endpoints are disabled by default; HA preserves the enabled/disabled state of existing registry entries.
No existing dashboard or automation is rewritten automatically.

旧 `_override` 的 ID 和 `off` 语义保持兼容；已有实体注册状态不变，新注册的旧入口默认禁用。
新的日常仪表盘和自动化建议指向 `_comfort`。迁移旧的“关闭覆盖”动作时，使用 `preset_mode: schedule`。
不要把它替换成物理设备关机。

Example actions for a Celsius HA installation / 摄氏 HA 的动作示例:

```yaml
action: climate.set_temperature
target:
  entity_id: climate.roommind_bedroom_comfort
data:
  temperature: 24
```

```yaml
action: climate.set_preset_mode
target:
  entity_id: climate.roommind_bedroom_comfort
data:
  preset_mode: schedule
```

RoomMind-generated entities cannot be configured as their own room's sensors or actuators.
Validation also checks entity registry ownership, so renaming an entity cannot bypass this rule.
RoomMind 自建实体不可作为物理输入或执行器；前后端同时按实体注册表归属识别重命名后的实体，避免控制或观测自引用。
The same rule applies to compressor group members and master devices. 压缩机组成员与主机同样只能选择物理设备，不能指向房间舒适实体。

## 证据如何更新 / How evidence updates

The existing sequence remains:

`Control Intent → Actuation Plan → Actuation Evidence → Control Outcome`

| Fact / 事实 | Meaning / 含义 |
| --- | --- |
| Sent / 已发送 | The HA service call completed; physical application is still unproven. |
| Transport accepted / 传输接收 | The transport accepted the request; the device may not have applied it. |
| Device confirmed settings / 设备确认设定 | Matching device evidence confirms this command's settings. It does not prove compressor heat flow. |
| Observed / 已观测 | A frozen observation from a Control Cycle describes reported device state. Assumed states are explicitly labeled. |
| Not confirmed, failed, unsupported, skipped, deferred | Separate outcomes remain distinguishable. 缺少确认、下发失败、不支持、跳过和延后互不替代。 |

Late integration evidence is correlated by HA context ID and publishes replacement room snapshots.
Previously published snapshots and physical observations remain unchanged.
Evidence that arrives before its dispatch record is retained by the ledger.
If a first room receives feedback while another room is being processed, the final publication includes it.
Evidence for a superseded context cannot confirm the current plan.

迟到反馈按 context ID 对账，通过替换快照更新显示，不改写周期开始前的观测，也不重置下一控制周期的计时。
房间列表接口传输完整的逐操作证据和独立设备观测，并复制嵌套载荷。
规划参数使用派发时的 HA 温度单位；设备观测规范为摄氏度，显示时再转换。
学习和预测继续使用观测事实，不把界面的保存状态或指令确认当作压缩机活动。

## 验证边界 / Validation limits

Regression coverage includes entity policy writes and compatibility, missing observations, late and superseded evidence,
immutable publication, renamed self-entities, range comfort, and browser interactions in Celsius/Fahrenheit.
Desktop/mobile and light/dark previews cover disclosure updates, touch targets and reduced motion.

本阶段验证在本地测试和浏览器预览中完成，没有部署、重启 Home Assistant 或下发实机操作。
这些结果验证软件语义与交互，不代表家庭噪声、节能率或舒适度的实测结论。
Related: [AC observation](ac-observation-and-control.md), [setpoint planning and quiet control](ac-setpoint-planning.md).
