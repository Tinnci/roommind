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

### 阶段三：人机心智模型、交互体验与实体边界的深层重塑 (Phase 3: Human Mental Model, UI & Entity Surface Inquiries)
- [ ] **Phase 3: 人机认知对齐、前端体验重构与 Home Assistant 实体契约的本质演进**
  - **开放性核心质询与探索空间（Open Questions for Astra to Explore & Resolve）**：
    - **关于人机心智模型与前端交互（The Human Mental Model & UI Inquiries）**：
      - 当人类在温控界面上操作时，他们直觉上是在设定“期望房间达到的舒适度”，还是在微观操控“空调机身的硬件旋钮”？现有的 Home Assistant 界面将这两者混杂在一起时，给真实居住者带来了怎样的心智负担与失控感？
      - 界面应该如何组织视觉与信息层级，才能让用户一眼洞悉空间的真实舒适事实，同时在需要时又能理解系统背后的执行意图与自适应状态，而不是面对互相矛盾的温度数字产生困惑？
      - 对于日常多房间高频温控与复杂高级配置，前端卡片和详情面板应如何取舍与演进，才能既极度轻盈流畅，又让用户获得笃定的掌控感与信任感？
    - **关于 Home Assistant 实体体系与契约边界（The Entity Architecture & Boundary Inquiries）**：
      - 在整个自适应空间气候体系中，Home Assistant 实体究竟应该扮演什么角色？哪些实体是人类日常交互的简洁抓手？哪些是系统自治时的幕后状态？哪些是用于验证系统健康的物理事实？
      - 上层空间气候大脑（`RoomMind`）与底层硬件通信驱动（`ha-tcl-udp-ac`）各自暴露给 Home Assistant 的实体表面，应该如何清晰划分职责与抽象层级，才既契合 HA 原生生态体验，又杜绝物理事实与控制意图的混淆？
      - 对于真实空调存在的蜂鸣声、亮屏等物理副反应，以及系统在多源融合中提取出的数据血统与真实状态，应该如何在实体契约层建立诚实、严密且不扰人的表达？

### 阶段四：空间环境感知源头重塑、固件协议分析与 UDP 传输可靠性 (Phase 4: Environmental Sensing Grounding, M1/EMW3080 Firmware & Transport Inquiries)
- [ ] **Phase 4: 悟空 M1 / ZM1 (EMW3080) 固件协议逆向、UDP 通信可靠性与全链路传感器观测链重构**
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

### 阶段五：实机经验印证与极简演进 (Phase 5: Real-World Experience & Codebase Pruning)
- [ ] **Phase 5: 结合家庭实机数据演进与全局代码精简**
  - **核心关切与开放探索空间**：
    - 结合 192.168.3.120 的真实历史表现持续检验系统，去伪存真，大刀阔斧地清理不必要的冗余关卡与死板防线，用更少、更轻盈的代码实现更高阶的目标。

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
