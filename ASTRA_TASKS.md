# RoomMind Autonomous Engineering Charter & Strategic Horizons

本文件是 Astra（`gpt-6-astra`）在 `roommind` 项目中的**自主工程演进宪章与战略愿景指南**。
我们坚信：**不把 Astra 局限在人为设定的边界或死板的工序盒子里（Unbox the Agent）**。Astra 作为具备高阶推理能力的首席架构师与工程专家，拥有完全的自由裁量权，通过深度思考自主评估系统现状、自主识别最具全局杠杆率（Highest Leverage）的演进方向，并做出最优架构决策。

---

## 愿景北极星与核心战略关切 (The North Star & Strategic Dimensions)

Astra 在每一次演进迭代中，可自由权衡并交叉推进以下核心关切维度：

### 1. 真实物理世界与空调气候动态 (Physical Reality & AC Climate Dynamics)
- **家庭实机环境**：Home Assistant 服务器位于 `192.168.3.120:8123`（免密 SSH 别名 `ha-server-root`，密钥 `~/.ssh/id_ed25519_ha_kukui`，配置见 `.env`）；
- **本地已就绪真实遥测数据**：实机历史数据已全量拉取至本地目录 `data/household_telemetry/`（含 `wo_shi_history.csv`、`ke_ting_history.csv`、`roommind_store.json` 等真实家庭运行与温变时序）；
- **核心物理设备**：卧室与客厅以真实空调（如 `climate.tcl_air_conditioner_2`）为主力温控设备，搭配外部环境传感器（如 `sensor.wo_shi_zm1_ad46_temperature`）；
- **战略期望**：Astra 请在后续迭代中**直接加载并深度分析本地这些真实数据**，挖掘真实空调在家庭中的温滞、内机感温偏差与设定点变化，用第一手客观数据验证热工模型、驱动控制闭环与防骚扰设计。

### 1.1 端到端系统工程：硬件驱动与上层控制大脑联合调优 (End-to-End System Engineering: Driver + Control Fusion)
- **协同驱动仓库**：本地底层集成驱动源码仓库位于 `/Users/driezy/ha-tcl-udp-ac`（由同一团队自主维护的 Home Assistant TCL 官方协议插件）；
- **系统工程全景视角**：RoomMind（上层自适应大脑）与 `ha-tcl-udp-ac`（底层硬件通信驱动）是一个完整控制链路的两个端点，**严禁闭门造车将驱动视为不可变的黑盒**。Astra 被正式授权将 `/Users/driezy/ha-tcl-udp-ac` 纳入联合调试、协议分析与协同优化范围：
  1. **驱动协议真实物理状态挖掘**：深入分析 `ha-tcl-udp-ac` 的协议包（如 `protocol_driver.py`、`command_bundles.py`、`tcl_*.jsonl` 原始报文及抓包数据），审查设备在 UDP/TSL 握手与状态广播中是否回传了未暴露的真实压缩机运行位、出风口温变、实际功率/电流、故障码或风速状态；
  2. **驱动层虚假启发式治理与状态契约重塑**：如果驱动协议确实没有压缩机硬件状态回传，驱动应提供诚实清晰的实体状态与属性契约，避免向上层伪造合成的 `hvac_action`；
  3. **源头治理声光骚扰 (Root-cause Disturbance Mitigation)**：在 `ha-tcl-udp-ac` 中探究设备是否支持蜂鸣器抑制（`beep`/`mute`）、熄屏（`display`/`light`）或无感调温指令，从驱动层根除“每次下发指令空调必响必亮”的真实痛点，与 RoomMind 的节律控制形成完美闭环；
  4. **跨仓库测试与质量底线**：改动驱动仓库代码时，需运行驱动自身的测试套件进行严格校验（`uv run --with aiohttp --with cryptography --with voluptuous --with yarl python -m unittest discover -s tests -p 'test_*.py'`），确保两端协同演进、彼此增益。


### 2. 架构优雅性、代码自解释性与领域解耦 (Architecture Elegance & Clean Domain Modeling)
- **代码可读性与结构治理**：拒绝复杂混乱的大泥球（God Objects），持续解耦庞大模块（如 `mpc_controller.py`、大型前端视图）；
- **领域纯粹性 (DDD)**：严格契合 `CONTEXT.md` 控制语义与八步控制循环管道（`observe -> plan -> constrain -> submit -> reconcile -> learn -> publish -> persist`），分离纯计算逻辑与外部副作用；
- **自解释与低心智负担**：推崇强类型值对象、单一职责、清晰命名与优雅的设计模式，使整个系统结构清晰、赏心悦目。

### 3. 多场景物理防护与系统自愈 (Physical Safeguards & Fault Healing)
- 包括水暖 TRV 与 AC 的协同防竞争、非预期“幽灵供暖”渗漏识别、闲置阀门防钙化自愈冲刷、窗户感应暂停与压缩机防短循环等综合安全包络。

### 4. 极致前端体验与生产级工程底线 (Scale UX & Quality Invariants)
- **不可妥协的工程底线**：
  - 前端 Lit + TypeScript **严禁使用 npm，统一使用 bun**（`bun test`，`bun run typecheck`，`bun run build`）；
  - 后端 Python 3.12+ 严格通过 `uv run pytest` 与 `uv run ruff check`；
  - 严格保持状态单向数据流与不可变快照，跨异步边界零状态泄漏，所有升级严格平滑向后兼容；
  - 交互体验流畅丝滑，支撑十数个房间与密集传感器的高频更新。

### 5. 清晰、严密与极简：以真实经验为锚，剪除冗余关卡 (Clarity, Rigour & Pruning: Real-World Experience Over Redundant Gates)
- **真正的清晰与严密（Clarity & Rigour via Simplification）**：绝不是堆砌无休止的防御性判断或冗余关卡（Gates），而是**清理与精简代码库（Tidy up the codebase）**，寻找更简洁直接的功能实现路径，重新审视并精炼目标达成方式（Redesign Goal Realization）。
- **做减法与优先级排序（Prioritize the Necessary vs the Redundant）**：明确区分“真正不可或缺的核心逻辑”与“多余繁琐的冗余关卡”。主动审视现有代码与函数，剔除那些无实际收益的过度防御、重复校验与繁琐门禁。
- **真实数据与真实经验驱动（Real-World Data & Experience）**：深入分析已采集的设备与家庭环境真实数据，去伪存真，区分有用真实的物理信号与虚假无意义的噪声。一切优化必须扎根于真实空调的物理特性、家庭热工惯性与实际居住体验，而非闭门造车式的理论空转。

### 6. 持续交付闭环：代码提交推送与实机部署 (Continuous Delivery: Commit, Push & Deployment to 192.168.3.120)
- **双端代码仓库规范推送 (Git Commit & Push)**：
  - 本地两个代码仓库（`roommind` 与 `/Users/driezy/ha-tcl-udp-ac`）在通过全套自动化测试（Python + Bun + 驱动 unittest）后，必须执行规范的 Git 提交并推送至各自的 GitHub 远程仓库（`git push origin main`）；
- **实机无缝部署与容器验证 (Deploy to 192.168.3.120)**：
  - 使用项目根目录下的 `./deploy.sh` 部署脚本，将最新的 `roommind` 及其配套驱动 `tcl_udp_ac` 同步部署到实机 `192.168.3.120` 的 Home Assistant 配置目录（`/home/user/homeassistant/config/custom_components/`）；
  - 自动触发 Home Assistant 容器重启（`docker restart homeassistant`），并在第一线真实家庭环境中验证组件加载、实体注册与后台运行无异常。

### 7. 空间环境感知源头与传感器软硬件/固件协同 (Perception Grounding: Phicomm M1 / EMW3080 & zM1 Firmware/Protocol Co-Design)
- **物理观测源头不可伪造**：RoomMind 的一切控制决策与自适应学习，完全建立在以卧室悟空 M1 / ZM1 为代表的物理环境传感器真实读数之上。传感器回传抖动、UDP 超时与不可用闪烁，将直接动摇整个气候系统的单周期观测纯粹性与决策信心。
- **关联工程仓库授权与全链路协同**：
  - 当前实机运行固件项目：[`a2633063/zM1`](https://github.com/a2633063/zM1)（卧室设备当前搭载的第三方固件发布源，主要以 Release 二进制形式分发）；
  - Home Assistant 集成驱动：`/Users/driezy/Downloads/zm1` 与 `/Users/driezy/Downloads/zm1_ha`；
  - 硬件芯片与原生固件工程：`/Users/driezy/Downloads/EMW3080`（基于 Realtek RTL8710BN / AmebaZ 架构的 MXCHIP EMW3080 原生固件开发套件）；
  - 授权 Astra 跨越“感知硬件/嵌入式固件 -> 局域网 UDP 传输协议 -> Home Assistant 集成插件 -> RoomMind 空间大脑观测消费”的全链路，开展自顶向下与自底向上的双向归因与架构重构。

### 8. 语音助手全链路、PHOSH 锁屏多模态交互与实机体验 (Voice Assistant Ecosystem & Phosh Lockscreen Experience)
- **多仓库协同工作区**：位于 `/Users/driezy/Downloads/ha-voice-stack`，包含 `repos/phosh-ha-status`（Phosh 锁屏原生插件与交互代理）、`repos/llm-gateway`（大模型对话网关与意图裁决）、`repos/doubao-asr-for-ha`（Wyoming ASR 适配）与 `repos/hass-edge-tts`（语音合成）；
- **人机多模态体验核心原则**：
  1. **锁屏交互的大比例动态演进**：摒弃 30px 的狭窄局促状态条，在 10.1 寸平板屏幕上呈现富有表现力的大面积视觉转场，明确传达 ASR 录音状态（何时开始说话、何时录音截止）、LLM 思考状态流与播报波形；
  2. **听觉反馈（Earcons）的闭环与可靠性**：严密补齐追问（Follow-up）场景下的提示音，使用户在多轮对话继续时不依靠猜测，清楚感知麦克风何时重新接管；
  3. **实机真实部署与防崩防假死铁律**：针对直接载入 Wayland 合成器的原生 C 插件，坚决杜绝纸面空转，所有变更必须在实机 `192.168.3.120`（postmarketOS / kukui）上真实编译、部署与交互验收，确保动效优雅、多模态同频且系统绝对稳定。

---

## 演进阶段与战略导向 (Progressive Horizons & Strategic Phases)

> **给 Astra 的自主工程指引**：
> 基础底座决定上层建筑。我们不硬性预设任何具体算法、数据结构或实现手段（Keep it open and ambiguous），仅提供演进的**宏观优先级次序与真实世界体验关切**。请作为首席架构师，自主理解背后的真实人机矛盾，自驱推演最优解法：

### 阶段一：真实物理世界与基础观测 (Phase 1: Physical Reality & Observation Grounding) [COMPLETED]
- [x] **Phase 1: 真实家庭空调物理特性、可靠反馈与状态冻结**（2026-09-12）
  - **核心关切**：系统的控制与学习必须扎根于真实的物理世界，严格区分真实发生的事实与假设出来的状态，保持单周期观测的一致性与纯粹性。
  - **观测与冻结 / Observation and snapshots**：在既有家庭数据分析基础上，驱动逐字段保留来源与接收时间，嵌套快照不可变；局部更新不刷新旧电源、风速、摆风或诊断值，超过 300 秒无报告即保持未知。RoomMind 优先检查明确的观测时间，设备供暖能力也在全房间动作前冻结，规划、就绪判断与学习共用同一观测。
  - **可靠确认 / Reliable confirmation**：每个必要字段都必须有本条指令派发开始后的匹配报告。旧缓存、派生值、派发前已在途的云查询及延后处理的旧 UDP 包不能确认新指令；派发等待期间的提前反馈仍有效。配套驱动提交：`a2ee0a2`。
  - **核验与边界 / Measurement and limits**：16:20 再次只读核对家庭 Recorder 与线上驱动；线上仍使用旧温差启发式。历史状态变化不等于逐次设备报告，不能从现有记录校准压缩机启动时滞或容量。本阶段完成观测基础、回归验证和可证实的数据分析；部署后反馈、容量与时滞实验留在 Phase 4 实机核验。未部署或下发实机动作。详见[补充核验](docs/household-ac-analysis-2026-09-12.md)及[观测规则](docs/ac-observation-and-control.md)。
  - **验证 / Validation**：2,229 Python tests、59 Bun tests、268 TCL driver tests（含固定 cryptography 版本）通过；Ruff、mypy、tsgo typecheck、build、ESLint、驱动 compileall 与文档链接检查通过。

### 阶段二：控制行为重塑与舒适防扰 (Phase 2: Control Behavior & Disturbance Shield) [COMPLETED]
- [x] **Phase 2: 温度目标与执行手段重构、动态调节能力与设备防打扰**（2026-09-12）
  - **核心关切与开放探索空间**：
    - **目标与手段的张力**：人类追求的是体感舒适，空调有自身的机身设定。如何让控制系统具备灵活动态调节（包括必要时的适度超调）以克服环境滞后，同时保持逻辑的清晰与自洽？
    - **物理设备副反应**：真实空调在频繁接收指令时会产生蜂鸣、亮屏等机械与声光干扰（尤其在夜间或静默时段）。控制行为应如何自适应收敛，既维持舒适，又保护家庭生活的安宁？
  - **目标与执行 / Planning**：统一比例设定规划，最大偏移在插值前约束调节端点，保留 Direct 模式、设备范围及步长保护；界面展示约束后的真实计划，舒适目标保持独立。执行器与附件观测在全房间动作前冻结，派发、延后、接收与物理确认分别发布。
  - **设备防扰 / Quiet actuation**：空调直接关机，保留 TRV 关阀保护；小幅加力按日间 120 秒、夜间 300 秒合并，降负载、目标变化、快速恢复及压缩机保护及时执行。夜间先静音再处理显示与空调；附件使用有界退避和基于观测的恢复，兼容提前确认与迟到的夜间指令。
  - **驱动协同 / Driver**：同模式独立调温避免重置风速；模式切换同时确认温度，Legacy 编码容差与原生摄氏步长贯通规划及反馈比较，附件按自身报告过期。配套驱动提交：`ec40bb7`。
  - **验证 / Validation**：2,257 Python tests、61 Bun tests、277 TCL driver tests（含固定 cryptography 版本）通过；Ruff、mypy、tsgo typecheck、build、ESLint、驱动 compileall 与文档链接检查通过。
  - **边界 / Limits**：18 个模拟周期仅下发 3 次调温，依赖模拟立即反馈；该结果不代表家庭噪声、舒适度或节能实测。未部署或下发实机动作，节律参数仍待家庭验证。详见[空调设定规划与安静控制](docs/ac-setpoint-planning.md)。

### 阶段三：人机心智模型、交互体验与实体边界的深层重塑 (Phase 3: Human Mental Model, UI & Entity Surface Inquiries) [COMPLETED]
- [x] **Phase 3: 人机认知对齐、前端体验重构与 Home Assistant 实体契约的本质演进**（2026-09-12）
  - **日常心智 / Daily controls**：顶部与房间卡片聚焦观测室温、体感依据和生效舒适区间；设备计划、报告、静音附件与派发/确认结果按需展开。未知反馈不再归为待机或稳定，缓存温度及其体感推算不冒充当前测量；编辑状态与生效快照分离。
  - **实体边界 / Entity surface**：新增 `climate.roommind_{area_id}_comfort`，提供 `schedule` / `hold`，仅表达自动调节与舒适目标；观测活动独立于指令确认。旧 `_override` ID 与 OFF 恢复策略语义保留，新注册的旧入口默认禁用。房间设备与压缩机组按实体注册表归属排除重命名后的自引用。
  - **证据与快照 / Evidence and snapshots**：房间接口补齐逐操作证据与独立设备观测，嵌套响应脱离内部状态；迟到反馈按 context ID 发布替换快照，覆盖跨房间等待与先到证据，不改变物理观测或下一控制周期计时。
  - **交互质感 / Interaction**：统一柔和明暗表面、观测驱动的冷暖微渐变与留白；减少重复指标和配置高亮，提供键盘焦点、44px 调温触控目标及 reduced-motion 支持。
  - **验证 / Validation**：2,287 Python tests、75 Bun tests 通过；Ruff、mypy、tsgo typecheck、build、ESLint、桌面/移动及明暗主题 browser preview regression、文档链接检查通过，含摄氏/华氏、未知活动、迟到确认与覆盖更新回归。
  - **边界 / Limits**：本地测试与预览交付，未部署、重启或下发实机操作；不据此推断家庭舒适度、噪声或节能改善。详见[房间舒适度与设备反馈](docs/room-comfort-and-feedback.md)。
  - **开放性核心质询与探索空间（Open Questions for Astra to Explore & Resolve）**：
    - **关于人机心智模型与前端交互（The Human Mental Model & UI Inquiries）**：
      - 当人类在温控界面上操作时，他们直觉上是在设定“期望房间达到的舒适度”，还是在微观操控“空调机身的硬件旋钮”？现有的 Home Assistant 界面将这两者混杂在一起时，给真实居住者带来了怎样的心智负担与失控感？
      - 界面应该如何组织视觉与信息层级，才能让用户一眼洞悉空间的真实舒适事实，同时在需要时又能理解系统背后的执行意图与自适应状态，而不是面对互相矛盾的温度数字产生困惑？
      - 对于日常多房间高频温控与复杂高级配置，前端卡片和详情面板应如何取舍与演进，才能既极度轻盈流畅，又让用户获得笃定的掌控感与信任感？
    - **关于产品美学与人机交互设计深度（Product Aesthetics, Calm Technology & Tactile HCI Inquiries）**：
      - **现代高端空间产品美学（Modern Spatial & Appliance Aesthetics）**：如何彻底摆脱传统工控仪表盘与 Home Assistant 原生堆砌卡片的粗糙生硬感？若借鉴高端独立智能硬件（如 Braun 的功能美学、Nest 的温润极简、Dyson 与 B&O 的光影秩序），RoomMind 的界面应具备怎样的呼吸感、留白与精致克制？
      - **排版、光影与自适应质感（Typography, Depth & Visual Atmosphere）**：在暗黑/明亮自适应主题、冷暖气候氛围微渐变、精致微质感（Subtle Glassmorphism / Depth / Elevation）与无衬线字体层级上，如何运用现代 Web 标准（Lit + CSS 设计系统）呈现高级视觉秩序，传达平静科技（Calm Technology）的从容，而非冰冷的数据轰炸？
      - **操作触感与流畅微交互（Tactile Interaction & Fluid Motion）**：当居住者在调整温度目标、切换回退或快速滑动多房间状态时，弹簧动画（Spring Physics）、平滑过渡（View Transitions）与即时触控回馈应当如何精巧协作，让指尖的交互充满确定、温润而高级的物理质感？
      - **自治透明度与美学呈现的共生（Aesthetic Transparency without Overwhelm）**：系统在幕后的自适应动态超调、风向静音抑制与物理观测事实，如何在视觉界面中以如水般自然、优雅轻巧的方式呈现，让用户在“无需关注细节的安心”与“想要洞悉全局的掌控”之间自由游刃？
    - **关于 Home Assistant 实体体系与契约边界（The Entity Architecture & Boundary Inquiries）**：
      - 在整个自适应空间气候体系中，Home Assistant 实体究竟应该扮演什么角色？哪些实体是人类日常交互的简洁抓手？哪些是系统自治时的幕后状态？哪些是用于验证系统健康的物理事实？
      - 上层空间气候大脑（`RoomMind`）与底层硬件通信驱动（`ha-tcl-udp-ac`）各自暴露给 Home Assistant 的实体表面，应该如何清晰划分职责与抽象层级，才既契合 HA 原生生态体验，又杜绝物理事实与控制意图的混淆？
      - 对于真实空调存在的蜂鸣声、亮屏等物理副反应，以及系统在多源融合中提取出的数据血统与真实状态，应该如何在实体契约层建立诚实、严密且不扰人的表达？

### 阶段四：空间环境感知源头重塑、固件协议分析与 UDP 传输可靠性 (Phase 4: Environmental Sensing Grounding, M1/EMW3080 Firmware & Transport Inquiries) [COMPLETED]
- [x] **Phase 4: 悟空 M1 / ZM1 (EMW3080) 固件协议逆向、UDP 通信可靠性与全链路传感器观测链重构**（2026-09-13）
  - **实机证据 / Physical evidence**：被动抓包确认状态回复与传感器广播独立到达；旧插件在 680 次端口采样中仅 6 次监听，存在接收空窗。后续抓包也发现主机未收到传感器广播，不能把所有空窗归因于插件。只读查询报告间隔为 5 秒，未改设备配置。
  - **通信与观测 / Transport and observations**：ZM1 使用共享常驻异步监听器，按 MAC 串行请求，处理迟到、局部及冲突回报；只读查询最多重试一次，写入仅派发一次。逐字段保存接收时间与来源，发布不可变快照，独立定时器在 300 秒后使旧测量失效；MQTT 发布或保留消息不冒充新观测。驱动提交：`7da1644`。
  - **硬件与上层消费 / Hardware and consumption**：移除 CO2、eCO2、TVOC 占位定义并精确清理旧注册项；RoomMind 控制、融合、缓存及原始历史共用字段观测时间，修复陈旧温湿度绕过有效性判断与缓存续命，前端标注设备观测来源。
  - **固件路径 / Firmware path**：完成 v0.1.4 二进制协议线索分析与现有 RTL0B_SDK 启动工程的原生 clean build 核验；记录传感器引脚核验、采样与网络解耦及运行时测量路径，未将启动工程描述为完整 M1 固件。
  - **验证 / Validation**：2,302 RoomMind Python tests、52 ZM1 tests（另含 7 subtests）、75 Bun tests 通过；两仓库 Ruff、RoomMind mypy、ZM1 7 个运行时模块 mypy、tsgo typecheck、build、ESLint 与文档链接检查通过。
  - **边界 / Limits**：本阶段完成协议取证、软件修复、回归与构建核验；未部署、重启 HA 或刷写固件。上游报告空窗仍需 AP 抓包与设备串口/总线诊断，家庭链路可靠性与固件根因尚未验证。详见[M1 观测链分析 / M1 observation chain](docs/zm1-observation-chain.md)。
  - **开放性核心质询与探索空间（Open Questions for Astra to Explore & Resolve）**：
    - **固件底层 vs 插件传输的超时根因质询（The Root-Cause Inquiry: Firmware Stack vs. Integration Protocol）**：
      - 真实卧室中使用的 ZM1 传感器（基于 EMW3080 模块，当前运行第三方固件项目 [`a2633063/zM1`](https://github.com/a2633063/zM1)）偶发的 UDP 超时与回传不稳定，其物理与协议根源究竟在何处？
      - 是芯片端第三方固件在 FreeRTOS / lwIP 任务调度中的阻塞、cJSON 动态内存碎片与泄漏、Wi-Fi 节能睡眠（Modem Sleep / DTIM）唤醒延迟，还是固件内部传感器（如温湿度、PM2.5、甲醛等总线读取）造成的单线程耗时？
      - 抑或是 Home Assistant 插件端（`zm1`）在每次轮询时采用短生命周期临时套接字（Ephemeral Socket）绑定 `10181` 端口并立即销毁，与固件不可预测的异步主动上报（Unsolicited Reports）之间存在天然的时序错位与内核丢包？
    - **传输范式与网络拓扑质询（The Transport Paradigm & Reporting Cadence Inquiries）**：
      - 在空间气候自治的真实场景中，主动轮询（Pull: Central Controller Request/Response）与事件驱动主动上报（Push: Unsolicited Broadcast / Unicast / MQTT）两种通信范式，哪一种对资源受限的嵌入式传感器更为友好且健壮？
      - 如果维持 UDP 传输，集成端是否应建立常驻异步套接字监听器（Persistent Async Datagram Listener）以捕获所有在途心跳？对于控制与查询，如何设计轻量级的事务 Sequence/Nonce 与自适应退避重试，彻底消除“超时即标记不可用”的闪烁？
      - 或者，设备支持的本地 MQTT 协议是否比不可靠的裸 UDP 能提供更确定、无连接断档且天生解耦的双向状态流？
    - **自研原生固件演进路径质询（The Native Firmware Reconstruction Inquiry）**：
      - 面对第三方黑盒固件可能隐藏的固件级 bug，基于 `/Users/driezy/Downloads/EMW3080`（Realtek `RTL0B_SDK`）从源码打造极简、纯粹且健壮的 M1 原生固件，其关键路径应当如何展开？
      - 如何基于清晰的 FreeRTOS 架构组织任务划分（网络通信、传感器采样、看门狗喂狗、显示调光），彻底杜绝内存碎片与协议锁死，从根源上实现微秒级响应与确定性回传速率？
    - **空间大脑对感知衰减的韧性契约（The RoomMind Perception Staleness & Resilience Contract）**：
      - 当物理传感器不可避免地经历局域网瞬态抖动或单次超时，RoomMind 与上层协调器应如何定义数据陈旧度（Staleness）与平滑退化规则？
      - 如何既能防止因单次 UDP 超时导致实体频繁上下线（Flapping）造成控制策略混乱，又能坚决避免系统在传感器彻底断联数小时后仍使用“僵尸温度”驱动空调超额制冷/制热？
    - **物理硬件真实性与冗余实体精简质询（Physical Hardware Grounding & Entity Pruning）**：
      - 斐讯 M1 物理机身仅搭载了 SHT20（温湿度）、攀藤颗粒物（PM2.5）和万胜 WZ-S（甲醛），并不存在物理 CO2、eCO2 或 TVOC 传感器；
      - 坚决杜绝在 Home Assistant 中暴露永远不可用或虚假估计的幽灵实体，果断从插件实体注册表（`sensor.py`）中剔除 `CO2`、`eCO2`、`TVOC`，保持物理世界的诚实与代码的极致精简。

### 阶段五：实机经验印证、eMMC 存储寿命治理与极简演进 (Phase 5: Real-World Experience, eMMC Longevity & Codebase Pruning) [COMPLETED]
- [x] **Phase 5: 结合家庭实机数据演进、精度无损的 eMMC 闪存寿命治理与全局架构精简**（2026-09-13）
  - **实机归因 / Household evidence**：只读审计固定一小时窗口，6,534 条 Recorder 状态中 4,939 条仅改变接收时间属性；按实体注册表归属统计，兼容实体更名。45 秒整机采样写入 3,444,736 字节；eMMC `life_time=0x02 0x01`、`pre_eol_info=0x01`，不据此推算剩余寿命。
  - **观测与发布 / Observation and publication**：ZM1 与 TCL 的原始内存快照持续更新，所有数值、物理属性、来源及可用性变化立即发布；相同报告分别最多合并 60/120 秒，静默前最后报告由定时器补发，保留真实接收时间。指令确认与 context 证据独立于实体发布，不使用未验证的非零死区丢弃微小变化。
  - **存储精简 / Persistence**：RoomMind 观测 SQLite 复用连接并串行化执行器访问，保留逐批提交、异常回滚及关闭释放；消除每周期关闭连接触发的重复检查点。配置只保存变化后的完整快照，输入及返回值脱离调用方引用；历史 CSV 没有变化时停止重写。
  - **实体与统计 / Entities and statistics**：纯通信时间与版本诊断在新注册时默认禁用，保留既有用户选择及物理测量；TCL 风机与膨胀阀原始数值补齐 measurement 统计，不虚构单位。驱动提交：ZM1 `a744464`、TCL `d1e9c56`。
  - **验证 / Validation**：2,309 RoomMind tests、56 ZM1 tests、280 TCL tests、75 Bun tests 通过；Ruff、RoomMind mypy、驱动相关模块 mypy、tsgo typecheck、build、ESLint 与文档链接检查通过。原生 HA 回放中，2,916 条 M1 测量记录对应 729 次发布（减少 75%），保留全部数值变化，5 分钟均值仅有浮点舍入差异，最小值与最大值一致。
  - **边界 / Limits**：本阶段完成实机只读取证、减写实现、统计保真与本地回归；未部署、重启 HA 或下发家庭设备动作。发布减少比例不等于闪存写入减少比例，部署后的写入速率与长期损耗仍需同负载测量。详见[存储、观测与 eMMC / Storage and publication](docs/storage-and-publication.md)。
  - **核心关切与开放探索空间**：
    - **精度无损的存储寿命与写入放大治理 (Precision-Preserving Longevity & Flash Wear Mitigation)**：
      - 实机 Home Assistant 服务器运行于 eMMC 闪存芯片（`/dev/mmcblk0`，当前底层 EXT_CSD 损耗指示为 `0x02 0x01`）。当前 SQLite 数据库（`home-assistant_v2.db`）存在严重的高频小碎片随机写放大，但**我们的目标绝非盲目粗暴地牺牲数据精度，而是精准保留所有关键物理量（真实室温、湿度、设定点、功率、阀门状态）的高保真度与必要精度**，精准剔除无物理信号价值的微小噪声与机械重复刷盘。
    - **根本性与面向未来的系统级防护（Future-Proof Architectural Precautions Over Brittle Blacklists）**：
      - 仅在 `configuration.yaml` 中配置静态的 `exclude` 黑名单是脆弱且局部的，一旦引入新设备或实体更名就会复发。Astra 需从架构深处探索更具未来兼容性的系统级解法：
        1. **驱动与协调器层有效变化死区（Physical Deadband & Significant Change Filtering）**：在 RoomMind、ZM1 及 TCL AC 等驱动与协调器中，建立物理有效分辨阈值（如温度波动在传感器噪声容限 ±0.05°C 内、湿度在 ±0.5% 内且未达时间窗口），只更新内部内存快照，不向 Home Assistant 核心事件总线广播无意义的微小状态抖动，从源头掐断 `state_changed` 事件雪崩；
        2. **诊断与派生实体的规范化治理（Entity Lifecycle & Default-Disabled Governance）**：遵循 Home Assistant 官方架构准则，将纯诊断性实体（如 `last_seen`、心跳计数、通信诊断等）默认标记为 `entity_registry_enabled_default = False`，使其在底层内存可用，但不默认激活并持续向 SQLite 写入；
        3. **内部高频控制计算与对外持久化解耦（Decouple Control Compute from State Persistence）**：RoomMind 内部高频控制迭代、卡尔曼滤波（EKF）或热惯性预测在内存中保持高频计算，仅在产生真实控制意图、物理状态确认（Actuation Evidence）或周期保活时对外发布不可变快照，彻底打破“内部高频思考 = 存储频繁写盘”的不良耦合；
        4. **长周期统计优先（LTS-First for Long-Term Analytical Precision）**：对需要长期趋势追踪的实体规范使用 `state_class = SensorStateClass.MEASUREMENT`，由 HA 原生统计引擎聚合 5 分钟与 1 小时统计，兼得数十天至数年的长期高精度分析能力与超低写入损耗。
    - **实机数据印证与极简工程**：结合 192.168.3.120 的真实历史表现持续检验系统，去伪存真，大刀阔斧地清理不必要的冗余关卡与死板防线，用更少、更轻盈的代码实现更高阶的目标。

### 阶段六：全生态仓库巡检、Home Assistant 标准化发布与统一 CI/CD 演进 (Phase 6: Multi-Repo Audit, HA Standardized Publishing & Unified CI/CD) [COMPLETED]
- [x] **Phase 6: GitHub 维护仓库全量巡检、实机已用组件发布准备与跨仓库 DevOps 标准化**（2026-09-13）
  - **巡检 / Inventory**：盘点 Tinnci 全部 225 个仓库，识别 14 个相关项目；只读核对家庭 HA 2026.6.3、已装组件、源码差异及 CI/Release 历史。各项目的发布决定和验证链接见[生态发布审计](docs/ecosystem-release-audit.md)。
  - **发布准备 / Release readiness**：准备 RoomMind 1.8.0、TCL 0.11.0、zM1 0.3.0；Edge TTS 0.9.0、Gateway 0.4.0、ASR 0.1.9 由既有自动发布入口升版。五个 HACS 归档实际构建并验证，补齐品牌资产、维护入口和双语发布说明；保留既有许可证与上游归属。
  - **DevOps / Delivery**：统一 uv 锁定依赖和 Bun/tsgo 验证，发布选定标签源码、复用各仓库 CI、原子推送版本提交与标签；修复 zM1 ZIP 层级、手动发布源码错配、遗漏 pytest、Linux socket 插件顺序和失效 CODEOWNERS。
  - **验证 / Validation**：3,116 Python tests、99 Bun tests 通过；Ruff、格式、Actionlint、锁文件检查及前端构建通过，RoomMind 覆盖率 93.81% 并通过 mypy。六仓库提交推送后的 CI/Validate 全部通过，五个集成通过官方 Hassfest 与 HACS 自定义仓库校验；ASR 镜像构建及离线 CLI 检查通过。
  - **边界 / Limits**：本阶段完成发布准备与验证，未创建发布标签、发布 Release 或部署家庭组件；物理确认、传感器可靠性和语音体验继续依赖实机观测。Phosh 原生发布随 Phase 7 实机验收推进，Xiaomi Home 独立发行待实体迁移验证。
  - **核心关切与开放探索空间**：
    1. **全量 GitHub 维护仓库盘点与状态巡检（Cross-Repository Inventory & Health Audit）**：
       - 全面梳理 GitHub（组织/账户 `Tinnci`）下由我们自主管理、更新与维护的所有 Home Assistant 关联生态仓库（包括 `Tinnci/roommind`、`Tinnci/ha-tcl-udp-ac`、`Tinnci/zm1`、`Tinnci/hass-edge-tts`、`Tinnci/llm-gateway`、`Tinnci/doubao-asr-for-ha` 等）；
       - 对齐实机（`192.168.3.120`）上当前正在运行、测试、修复过的插件组件，确认哪些改动、修复与优化需要打包发布新版本；
    2. **对齐 Home Assistant 顶级发布规范与质量基线（High-Standard HA Qualification & HACS Compliance）**：
       - 确保每一个准备发布的组件都严格符合 Home Assistant 官方顶级规范：
         - 完整的 `hacs.json` 与 `manifest.json` 元数据架构、严格的语义化版本控制（Semantic Versioning）；
         - 完整的双语或多语言翻译（Translations i18n）、Brand 品牌资产与图标体系；
         - 现代 Python 3.12+ 强类型注解、Ruff 代码规范检查，以及完备的单元测试覆盖；
         - 严密通过官方 `home-assistant/actions/hassfest` 与 `hacs/action` 自动化合规验证；
    3. **DevOps 历史梳理与跨仓库 CI/CD 标准化（DevOps Overhaul & Cross-Repository Pipeline Uniformity）**：
       - 深度审查各仓库现有的 CI/CD 历史与构建工作流（分析过去不同仓库采用的碎片化 pipeline，总结经验教训与可提升点）；
       - 统一与现代化 GitHub Actions 流水线标准模板：
         - 统一的自动化验证流（Test, Lint, Hassfest, HACS validation）；
         - 统一的自动化发布流（基于语义化标签或 Conventional Commits 自动生成 Release Notes、自动构建符合 HACS / HA 规范的发布归档 zip 文件）；
         - 探索实现跨仓库的协同发布模式或共享工作流，达成全生态代码质量与发布体验的高度一致性。

### 阶段七：语音助手全链路、PHOSH 锁屏交互重塑与多模态实机工程 (Phase 7: Voice Stack Overhaul, Phosh Lockscreen UI, Follow-Up Earcons & Target Grounding)
- [x] **Phase 7: ha-voice-stack 全链路协同、PHOSH 锁屏动态界面重构、追问听觉反馈 (Earcons) 与实机沉浸式交互闭环**（2026-09-13）
  - [x] **工程实现与部署 / Implementation and deployment**（2026-09-13）：完成原生大面积语音页、实时 PCM 波形、追问音、15 个提示音母带处理、Lit 声音卡片及热应用；修复播放事件时间戳、取消误杀卫星、音量单位和 ASR 首帧前断连清理。
  - [x] **实机闭环 / Device evidence**：合成语音经真实扬声器/麦克风完成双轮对话，保持同一会话 ID；六项试听、播报中音量/静音、取消清理、原生状态矩阵与本地回归通过。发现并恢复实机已退役模型路由。详见[Phase 7 迭代报告](docs/voice-stack-phase7-2026-09-13.md)。
  - [x] **现场与发布验收 / Remaining acceptance**：实机多场景自动化双轮对话与试听证据齐备；待用户物理日常长期体验。

### 阶段八：AI 语音控制中心与设置界面深度重塑 (Phase 8: Voice Control Center & Interactive Settings UI/UX)
- [x] **Phase 8: AI 语音设置面板交互深化、场景化调音套件与 Phosh/HA 双端无缝协同**（2026-09-13）
  - **交付与闭环 / Delivery & Grounding**：
    - 前端交付高质感卡片式语音控制中枢（Lit + TypeScript，bun 构建），支持 Focus/Daily/Night 场景预设、400ms 防抖保存、6 项音效微交互试听、深色模式与移动端触控适配；
    - Phosh 锁屏原生大板面打通扬声器静音、夜间模式、音量升降与 30 分钟免打扰快捷开关；
    - 引入 `voice_preview_lock` 防止多端并发试听导致削顶破音；新增 `room_environment.py` 与 `ha-background-rotator.c` 将 RoomMind 物理舒适度事实联动至锁屏环境流光；
    - 实机 `192.168.3.120` 部署验证完成，获取物理屏幕 `kmsgrab` 真实截图与 API 快照，288 项 Python 测试、13 项 Meson 测试、全套 Bun 测试通过。
  - **核心目标与演进约束（Strict Voice Scope & Experience Inquiries）**：
    1. **严格限定工作范围（Strict AI Voice Scope Guard）**：
       - **本阶段及后续工程循环严格专注于当前主力维护的 AI 语音技术栈**（`/Users/driezy/Downloads/ha-voice-stack` 下的 `repos/llm-gateway`、`repos/phosh-ha-status`、`repos/doubao-asr-for-ha`、`repos/hass-edge-tts` 以及与 `RoomMind` 的环境联动）；
       - **坚决杜绝发散至无关的硬件或墨水屏等外部项目**，确保全部算力与注意力高度聚焦于 AI 语音与交互体验。
    2. **设置界面（Settings UI）的全面深化与美学跃升**：
       - **卡片式语音控制中枢（Voice Control Suite）**：在 Home Assistant 前端深度重塑声音与语音设置卡片（Lit + TypeScript，统一使用 bun 构建），提供极具质感的现代控制中心，彻底告别零散的原生 `input_number`；
       - **全场景分层调音与细致微调**：
         - 唤醒提示音量（Wake Cue Volume）
         - 追问提示音量（Follow-up Cue Volume）
         - 思考等待循环音量（Processing Loop Volume）
         - 日间播报音量（Daytime TTS Volume）
         - 夜间柔和播报音量（Nighttime Gentle TTS Volume）
         - 一键静音 / 免打扰与夜间模式联动
       - **“试听即反馈”（Live Auditory Preview）与实时响应**：
         - 滑块拖拽实时防抖热应用（400ms Debounce Hot Apply），杜绝手动点保存的陈旧体验；
         - 每个音量项边提供直观的高灵敏“试听测试音（Play Test Sound）”微交互，试听时伴随轻量声波动效；
         - 声学电平指示：直观标记 -1.0 dBFS 安全峰值线与推荐响度区间，消除盲调猜测。
    3. **Phosh 锁屏全场景（有无唤醒词双态）动态编排与微动效（Dynamic Choreography & Micro-Interactions）**：
       - **常态环境待机（Ambient Standby，无唤醒词触发时）**：
         - 彻底告别粗糙死板与静态排版，引入随环境温湿度/舒适度（与 RoomMind 联动）及昼夜节律自适应的极克制流光背景（Subtle Ambient Breathing Glow）；
         - 状态胶囊（Pill）、时钟与环境气候卡片采用丝滑淡入淡出微动画；
         - 功耗守卫：待机态锁定 1fps 超低频刷新，闲置 CPU 占用严格维持在极低水平；
       - **交互激活态弹性转场（Morphing & Spring Physics）**：
         - 唤醒瞬间平滑展开为大尺寸交互板面，由小卡片弹性过渡至大视野；
         - 实时 PCM 拾音动态波形与流光发光晕随说话音量呼吸起伏，并在 ASR 录音截止瞬间优雅收缩为脉冲光点，伴随清晰“已停止收音”文字指引；
         - 思考与朗读阶段的多模态同频映射，消除突兀跳变。
    4. **模块化布局、可编辑性与灵活性（Modular Bento Grid & Declarative Customizability）**：
       - **业界顶级架构规范（Modern Widget & Card Standards）**：借鉴 iOS Lockscreen Widgets 与 Material You 声明式规范，将时间天气、空间气候（RoomMind）、语音中枢、快捷控制解耦为独立 Bento 微卡片；
       - **可配置与自由排版（User Customizability）**：支持用户声明或切换卡片排序、显隐与密度；
       - **多端触控与排版响应式**：适配 10.1 寸平板横竖屏与 390px 手机端，触控目标严格保持 >= 44px 舒适尺寸，防止误触；深浅色自适应无缝过渡。
    5. **实机验证底线（Real Hardware Verification）**：
       - 必须在实机 `192.168.3.120` 上完成真实触控、设置项实时生效验证与端到端试听，确保守护进程与 Phosh 桌面坚若磐石。

  - **核心关切与开放探索空间**：
    1. **语音技术栈多仓库一体化审视（Voice Stack Ecosystem & Diagnostic Audit）**：
       - 聚焦工作区 `/Users/driezy/Downloads/ha-voice-stack`，将所有语音关联仓库统一纳入协同演进（`repos/phosh-ha-status` 锁屏与交互、`repos/llm-gateway` 大模型对话代理与 Harness、`repos/doubao-asr-for-ha` Wyoming ASR 适配、`repos/hass-edge-tts` 语音合成）；
       - 结合实机（`192.168.3.120`）当前的 Home Assistant 语音配置、最近对话历史记录（Conversation Traces）与运行时日志，全景式复盘当前语音链路的交互卡点与体验短板。
    2. **PHOSH 锁屏 UI 界面彻底重塑（Phosh Lockscreen UI/UX Overhaul & Dynamic Shift）**：
       - **告别微小状态栏（Break Away from the Narrow 30px Bar）**：彻底改变当前只在屏幕极小区域（30px 条状）显示的局促设计，在 10.1 英寸平板界面上提供大胆、动态、富有表现力的全尺寸或大比例视觉展开；
       - **明确直观的 ASR 状态机表达（Clear ASR Recording & Stop Indication）**：
         - 当唤醒词触发或开始录音时，界面应产生显著且流畅的动态转场，清晰指引用户“开始说话”；
         - 采用灵动的动态波形/粒子/呼吸光晕（Flowing Animations），清晰反映实时拾音动态；
         - 明确指示 ASR 录音何时截止，消除用户“不知机器是否在听、何时停止接收”的茫然感；
       - **思考（Thinking）与播报（Speaking）阶段的多模态映射**：在 LLM 生成与 TTS 朗读时，界面应同频呈现优雅的思考流与朗读波形，呈现浑然一体的人机交互质感。
    3. **多轮对话追问（Follow-up / Continuation）与听觉反馈系统（Earcons System, Gain Boost & DRC）重构**：
       - **根治追问阶段“无声录音”痛点（Follow-up Continuation Earcon）**：针对当前在助手主动发起追问、重新打开麦克风录音时用户完全听不到任何提示音的严重体验断层，补齐专用的追问提示音（Earcon）；
       - **全音频资产动态范围控制（Dynamic Range Control - DRC）与母带级调校**：
         - 针对小型平板微型扬声器的声学物理特性，建立严格的动态范围控制规范（峰均比 Crest Factor 控制在 6dB ~ 9dB 黄金区间）；
         - 结合软拐点压缩（Soft-knee Compression）、前瞻限幅（Lookahead Limiting）与微共振高通滤波（High-pass Filter ~120Hz 消除低频浑浊过载），对项目中所有提示音（`awake.wav`、`done.wav`、`thinking.wav`、追问音等）实施母带级动态范围控制；
         - 既避免过大动态导致弱音细节在室内环境底噪中淹没，又坚决杜绝突变瞬态尖峰引发扬声器破音刺耳，确保全音量段听感紧凑、清晰、穿透且亲和舒适；
       - **音频增益放大与提示音响度优化（Audio Gain Boost & Headroom Utilization）**：
         - 消除目前脚本中人为设置的保守音量上限（如 `wake-and-cue.sh` 中 `WAKE_CUE_VOLUME=0.68`、`KUKUI_FALLBACK_VOLUME=0.68` 导致提示音极轻极小）；
         - 在确认 PipeWire/ALSA 硬件链路无爆音无杂音（No glitches/clipping）的前提下，合理调优 PipeWire Sink 与播放增益，对 Earcons 进行波形响度标准化（Loudness Normalization / Peak Amplification 至 -1.0 dBFS）；
       - **构建可靠、低延迟的 Earcons 听觉设计规范**：精心调校唤醒确认音（Wake Cue）、追问开始音（Follow-up Cue）、错误/超时音，确保在 PipeWire/ALSA 链路下稳定触发、毫秒级响应、无杂音爆音；
    4. **后市场 Linux（postmarketOS / Phosh）实机部署与防崩稳定性底线（Real-Machine Grounding & Stability Guard）**：
       - `phosh-ha-status` 是直接以 C/GTK3 动态插件形式载入 Phosh Wayland 合成器（`mobi.phosh.Shell.service`）内部运行的原生组件，任何一处空指针或未捕获异常都将直接导致整个平板图形桌面瞬时黑屏崩溃；
       - **坚决拒绝脱离实机的理论空转（Deploy and Verify on Real Hardware）**：所有 UI 改动、动画重构、线程安全通信与 PipeWire 声音调用，必须全量部署到实机 `192.168.3.120`（Lenovo Duet / kukui），开展真实物理触屏、远场语音交互与多轮追问闭环测试，确保代码既优雅流畅又坚若磐石。
    5. **音频系统默认值科学重构与设置界面（Settings UI）体验飞跃**：
       - **科学确立全场景开箱默认值（Definitive Baseline Sound Defaults）**：
         - 彻底梳理当前设置与默认场景的失配：基于标准化峰值，将 `wake_cue_volume`（唤醒音）和 `follow_up_cue_volume`（追问音）基准默认值确立为满幅 `1.0`；白天播报 `tts_volume_day` 设为 `1.0`；夜间播报 `tts_volume_night` 设为柔和的 `0.72`；处理中提示 `processing_volume` 保持微弱背景 `0.58 ~ 0.65`；
       - **大幅重构语音设置面板（Settings UI/UX Overhaul）**：
         - 摒弃以往分散零碎的裸露 `input_number` 滑块与繁琐的手动“应用生效”按键（改为实时防抖自动保存与后台热应用）；
         - **引入“试听即反馈”交互（Live Auditory Preview）**：在每一个音量滑块旁直观嵌入“试听测试音（Play Test Sound）”按钮，调节时无需猜测，所调即所听；
         - **多端呈现优化**：在 Home Assistant 仪表板提供结构紧凑、分组清晰的高质感卡片，并在 Phosh 锁屏/侧边栏提供快速静音与夜间模式快捷微调入口。

### 阶段九：Voice Harness 核心控制台全面板（概览 / 运行记录 / 测试 / 设置）UI/UX 深度重塑 (Phase 9: Voice Harness Full Surface UI/UX Overhaul)
- [ ] **Phase 9: “概览、运行记录、测试、设置”全面板 UI 现代化重构、交互质感飞跃与设计系统统一**
  - **核心目标与全景面板重构规范（Four Core Panels Architecture & Modern UX）**：
    1. **概览面板（Overview Panel）—— 系统健康与全链路脉动（Live Pipeline Pulse）**：
       - **Bento 模块化系统状态流**：大模型网关、Wyoming ASR、Edge TTS、Kukui 平板卫星状态整合为现代 Bento 优雅微卡片；
       - **关键指标仪表化（Hero Stats & Sparklines）**：耗时中位数、成功率、最后一次唤醒、错误率以微曲线（Sparklines）直观展现；
       - **实时链路脉冲动效**：麦克风监听、VAD 状态、模型流式响应以克制的呼吸微动效实时映射，一眼洞悉链路健康。
    2. **运行记录面板（Runs / Traces Panel）—— 交互式瀑布时间线与沉浸式 Trace 检查器**：
       - **交互式瀑布流时序（Waterfall Trace Timeline）**：将单轮对话细拆为 `Wake -> ASR -> LLM -> TTS -> Playback -> Follow-up`，以高质感彩色瀑布条清晰直观呈现各阶段耗时占比与瓶颈；
       - **沉浸式检查抽屉（Trace Inspector Drawer）**：支持点击任意 Run 平滑滑出抽屉，提供多模态详情卡片（完整 JSON 树状折叠、对话气泡复原、PCM 采样回放试听、Token 消耗统计）；
       - **高效筛选与对比（Replay Diff）**：支持按成功/告警/失败/高耗时极速筛选，并支持任意两个 Run 的模型回答差异高亮对比。
    3. **测试面板（Test & Scenarios Panel）—— 场景化工作台与交互式流式演练**：
       - **场景卡片工作台（Scenario Playground）**：将预置场景卡片化（如多轮追问消解、弱网降级容错、风噪穿透压测）；
       - **即时流式触发（Run & Stream Watch）**：支持在面板中直接输入测试语音或文本，单步触发并实时以打字机流式呈现 Gateway 的 Token 生成与 Tool Calls 轨迹；
       - **断言与契约结果可视化**：直观的 Pass/Fail 状态标签与一键“重放本轮测试（Replay Test）”。
    4. **设置面板（Settings Panel）—— 统一中枢与场景化调音套件**：
       - **配置分类层级**：清晰的分组二级导航（“声学与音频调校”、“大模型路由与 API”、“ASR/TTS 链路与 Wyoming”、“系统与存储策略”）；
       - **所见即所得与实时验证**：每个设置项均配备实时探测与验证微交互（探测模型连通性、TTS 延迟、音频增益试听）；
       - **配置导入导出（Config Portability）**：支持一键导出/导入调优配置文件（JSON/YAML），方便备份与多端同步。
    5. **全局设计系统与性能基准（Design System & Tactile Motion Standards）**：
       - 基于 Lit + TypeScript + CSS 自定义属性（Tokens），遵循 Apple HIG / Material You 空间层级美学与 Calm Technology 理念；
       - 标签页切换引入平滑 View Transitions 与弹性微动画（Spring Physics），杜绝生硬闪烁；
       - 适配桌面宽屏多列、平板 10.1 寸流式 Bento 以及移动端 390px 紧凑排版，触控目标保证 >= 44px；
       - 全量支持深色/浅色自适应主题与无障碍（a11y / ARIA / 键盘导航 1-4 快捷键）。

### 阶段十：第一性原理质询：目标与手段的本质解构与平静空间智能重塑 (Phase 10: First-Principles Grounding: Decoupling Ends from Means in Calm Spatial Intelligence)
- [ ] **Phase 10: 目标与手段的本质解构：消除手段的异化与形式主义，回归空间意图、物理真实与零心智负担**
  - **核心第一性原理拷问（First-Principles Inquiries into Ends vs. Means）**：
    1. **终极目标（The Ultimate Ends）到底是什么？**：
       - 在家庭真实生活中，人的终极目标是**安宁的空间舒适、意图被诚实理解、物理动作被无感且可靠地确认、以及零认知负荷（Calmness, Reliable Grounding & Zero Cognitive Burden）**。
       - 人的目的**从来不是**去浏览仪表盘、不是去分析毫秒瀑布流、不是去测试台敲键盘演练、更不是去调整层层叠叠的参数滑块。
    2. **警惕手段的反客为主与异化（The Distortion of Instrumental Means）**：
       - **展板形式主义（Dashboard Fallacy）**：将系统内部的中间机械指标（延迟微折线、统计百分比）堆在首屏，把用户当成工控台值班员，这是把可观测性的“手段”误当成了人机交互的“目标”；
       - **玩具式演练（Playground Vanity）**：在网页端做打字流式输出，脱离了家庭真实声学与远场交互的物理事实，把用户当成了大模型的测试员；
       - **配置推卸（Configuration Shifting）**：把系统原本应当基于昼夜节律与空间物理事实自适应消解的声学与环境矛盾，转化为无数零散的参数滑块推卸给用户。
    3. **重新审视目标达成的真正路径（Redesigning Goal Realization via Simplification）**：
       - **手段退居幕后，交互回归本质（Invisible Infrastructure & Calm Surface）**：界面如果出现，只回答人真正关心的三个本质命题：
         1. **意图诚实性（Intent Transparency）**：“刚才那句话，系统究竟听到了什么、打算做什么？”——以极简、自然的方式呈现意图对齐，而非冰冷的技术堆栈；
         2. **物理真实性（Physical Reality）**：“现实世界的设备真的响应了吗？”——绝不用发出了请求（Dispatch）冒充物理确认（Confirmation）；
         3. **克制自愈与优雅澄清（Calm Fallback & Clarification）**：面对噪声或歧义，系统如何在不打扰家庭安宁的前提下完成自愈，或以最自然的方式发起澄清。
       - **坚决做减法与剪枝（Ruthless Pruning）**：审视现有的四个面板与控制逻辑，凡是属于“为了展示技术而存在”、“把内部机械过程伪装成交互目标”的冗余关卡和视觉噪音，果断进行精简、合并或隐藏，让系统真正实现平静科技（Calm Technology）。



---

## 演进历史归档与架构决策沉淀 (Evolution Log & Architectural Milestones)

- [x] **Astra Autonomous Initiative: 真实家庭空调物理特性分析、控制闭环优化与领域架构解耦重塑**（2026-09-12，本轮交付完成）
  - **实测 / Measurement**：分析 56,514 条家庭历史，并只读查询 Recorder 与原始传感器观测；卧室设备报告 cool 模式时，301 对有效报告的“内机 − 室温”中位数为 −1.40°C，范围 −4.60～+1.40°C。该结果不作为固定校准偏移。详见[家庭空调实测分析](docs/household-ac-analysis-2026-09-12.md)。
  - **控制与学习 / Control and learning**：全房间执行前冻结温湿度、设备反馈、气流、功率、窗户、占用与遮阳；未知活动只更新测量温度，清除断档学习批次，暂停热参数及传感器偏差学习。输出观测不再用室温斜率猜测变频档位，电功率统一单位并保留来源。
  - **架构与证据 / Architecture and evidence**：拆出纯观测解释与气候执行适配器，MPC 保留决策职责；off、low、setback、fan-only 分别记录每项必要操作的结果与 context ID，部分失败不再成为“已停机”，原有保护与设备报告优先于缓存的重试逻辑保留。
  - **驱动协同 / Driver**：确认 `tcl_udp_ac 0.10.0` 从温差推算活动，配套仓库删除该推算及缺失模式的猜测，提供明确来源属性；RoomMind 同时兼容旧版与修正后的反馈。驱动本地提交：`a7c219c`。
  - **验证 / Validation**：2,219 Python tests、59 Bun tests、254 TCL driver tests 全部通过；Ruff、mypy、tsgo typecheck、build、ESLint、browser preview regression 与驱动 compileall 通过。
  - **边界与下一步 / Limits and next step**：未部署或下发实机动作，未给出节能率、容量或启动时滞校准。下一阶段对齐压缩机/电气反馈，核验温度编码与设备回报，并结合已有静音/熄屏能力优化关机设定与控制节律。新阶段结构继续保留。

- [x] **M1.1: 空间气候可配置 Setback 偏移量与自适应回退** (Completed by Astra)
  - **配置 / Configuration**：全局默认 + 房间可空覆盖；范围 1–5°C，默认 2°C；支持摄氏/华氏温差与中英德界面。
  - **验证 / Validation**：2179 Python tests、53 Bun tests；Ruff、tsgo typecheck、build、ESLint 和 browser preview regression 全部通过。
  - 消除 2°C 硬编码限制，打通端到端房间/全局灵活回退偏移量配置、持久化序列化、严格 Schema 防护与全套双栈自动化测试。
- [x] **M0: 核心控制反馈重构与恢复机制防护**
  - 确立基于 Actuation Evidence 的控制反馈闭环与不可变持久化快照。
