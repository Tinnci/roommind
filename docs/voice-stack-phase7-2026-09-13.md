# Phase 7 voice stack iteration / 语音交互迭代

本轮代码归属各自仓库，RoomMind 记录跨仓库交付与验收事实。已部署到 kukui
实机并完成合成语音双轮闭环；人工触屏、远场听说与完整声学验收仍待补齐，
不能以软件测试或播放器成功退出代替。

Changes stay in their owning repositories. This iteration has deployed-device
and controlled near-field evidence; human touch, far-field and complete acoustic
acceptance remain open.

## Implementation / 实现

| Repository | Changes |
| --- | --- |
| `phosh-ha-status` | 大面积 GTK 语音页、录音结束提示、实时 PCM 波形、独立追问音、静音/夜间快捷操作；设置串行保存与热应用；按播放实例关联事件；取消清理播放器而不误杀卫星 |
| `llm-gateway` | Lit 声音设置卡片、400 ms 防抖、逐项试听和失败重试；15 个提示音高通/压缩/限幅；区分反馈计划、服务下发和播放证据；HTTP 410 支持既有备用服务 |
| `doubao-asr-for-ha` | Wyoming 断连取消并等待上游任务，清理队列；首帧前取消进入明确终态 |
| `hass-edge-tts` | 验证并打包自动化发布工作流（0.9.0），依赖锁定与真实合成链路回归全通 |
| `roommind` | 记录全生态跨仓库交付与物理实机事实；确立 Phase 8 架构演进与设置优化基线 |

Maintained source paths: `/Users/driezy/Downloads/ha-voice-stack/repos/<repository>`.
The workspace remains a set of independent Git repositories.

## Observed device behavior / 实机观测

1. **双轮闭环**：合成唤醒词和中文问答通过平板物理扬声器/麦克风运行；真实
   wake → ASR → Gateway → TTS → playback → follow-up capture → ASR → reply
   完成，两轮保持同一个 HA conversation ID，Gateway 耗时 1,219/1,375 ms，
   错误数均为 0。追问音在重新收音回调后播放，播放器耗时 245.7 ms（含音频时长）。
2. **配置故障恢复**：实机 Fast/Mid 原模型 MiniMax M3 已退役，返回 HTTP 410。
   查询当前目录并探测后，改用同服务商、原已配置的 Nemotron Super，保留
   各路由的 token 和超时设置；记录模型目录、探测和修改前配置。
3. **音量闭环**：六项试听成功；数字播放链峰值 −1.01 dBFS，无满幅样本。
   日/夜播报实测线性增益约 0.999/0.719，处理中约 0.579。硬件音量保持原有
   91%。同一播放流热调依次达到半幅、静音、夜间 0.72 和满幅；卫星不重启。
4. **取消与故障**：零音频断连进入 ASR `cancelled`；停止请求清除播放器而保留
   卫星 PID；故意失败的播放器保持失败状态。所有测试后恢复声音设置。
5. **原生界面**：实机编译及重载成功；中英、横竖屏预览和真实锁屏状态矩阵通过。
   最终 STT 截图完整显示标题、结束收音提示及四阶段指示。常亮五分钟对比中，
   移除模糊阴影后 Phosh 平均 CPU 从八核总算力的 12.03% 降到 9.07%；
   15 次显示采样均为开启，31 次状态刷新期间无进程样本丢失。这不是长期功耗结论。

These are separate observations, not one boolean “success.” A HA service call
is dispatch evidence. The satellite establishes capture lifecycle; the player
establishes process completion. None alone proves physical hearing, room-device
application or far-field reliability. Pending settings and applied settings use
separate immutable snapshots and serialized writes.

## Local verification / 本地验证

| Repository | Python | Frontend / Native | Other checks |
| --- | ---: | --- | --- |
| RoomMind | 2,315 | 75 Bun tests | Ruff, tsgo, build |
| Phosh | 279 | 13 native Meson tests; 15/15 evaluations | Ruff, format, target build |
| Gateway | 385 | 28 Bun tests | Ruff, format, tsgo, panel build |
| Earcon tool | 7 | 15 audio assets checked | Lockfile, measured peak/crest/loudness |
| Doubao ASR | 35 | Deployed cancellation check | Ruff, format |
| Edge TTS | 36 | Real synthesis used by the voice test | Ruff, format |

The settings card also passed desktop/mobile Chinese and mobile English browser
checks, including 390 px width, save/preview ordering and mute. Browser transport
was mocked; device audio was checked independently.

## Evidence and remaining acceptance / 证据与剩余验收

详细运行语义和实测数值见 Phosh 仓库
`docs/phase7-target-validation-2026-09-13.md`、`docs/voice-lifecycle.md`，以及
Gateway 的 `docs/voice-feedback-runtime-verification.md`。

Private evidence is retained at `/home/user/phase7-evidence` on the tablet and
`/private/tmp/roommind-phase7` locally. Backups precede deployment. Recordings,
household transcripts, credentials and generated binaries are excluded from Git.

Still required before full acceptance:

- Human physical swipes, taps and perceived responsiveness on the tablet.
- Human far-field wake/recognition, follow-up and listening-comfort checks.
- Aligned false-VAD, echo-suppression and spoken barge-in measurements.
- A current package rollback window before a formal native release.

ASTRA_TASKS.md separates the completed engineering work from these open checks.
No release tag or formal release is created by this iteration.

## Forward Vision: Lockscreen Choreography & Layout Flexibility / 锁屏动态演进

为贯彻业界顶级人机交互实践，针对 Phosh 锁屏（含常态待机与语音激活态）确立以下演进契约：

1. **全场景动态编排与微动画（All-State Dynamic Choreography & Micro-Interactions）**：
   - **常态待机态（Ambient Standby）**：未唤醒时彻底摆脱死板静态，引入随环境温湿度/昼夜自适应的极克制流光背景（Subtle Ambient Breathing Glow）；状态胶囊（Pill）采用平滑淡入与秒级微动画；
   - **激活态平滑形态变换（Morphing & Spring Physics）**：唤醒瞬间由环境小卡片向大面积语音板面实施弹性展开（Spring Motion），波形与发光光晕根据实时 PCM 起伏，录音截止平滑收缩为脉冲微光并辅以明确文字指引；
   - **性能底线**：采用轻量 GPU 加速渲染（Cairo Clip / Wayland Surface Commit），待机锁定 1fps 超低功耗，交互时 60fps 丝滑响应，杜绝 CPU 浪费。

2. **模块化自适应布局与可编辑灵活性（Modular Bento Grid & Declarative Layout）**：
   - **声明式卡片架构（Declarative Card Schema）**：对标 iOS Lockscreen Widgets 与 Material You 规范，将时钟天气、空间气候（RoomMind）、语音中枢、快捷控制解耦为独立可插拔微卡片；
   - **可配置与自由排版（User Customizability）**：支持用户声明或切换卡片排序、显隐与密度；
   - **多端触控基准**：严格保证平板（10.1 寸横竖屏）与手机端（390px）自适应，触控目标最小 $\ge 44\text{px}$。

