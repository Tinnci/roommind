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

---

## 演进阶段与战略导向 (Progressive Horizons & Strategic Phases)

> **给 Astra 的自主工程指引**：
> 基础底座决定上层建筑。我们不硬性预设任何具体算法、数据结构或实现手段（Keep it open and ambiguous），仅提供演进的**宏观优先级次序与真实世界体验关切**。请作为首席架构师，自主理解背后的真实人机矛盾，自驱推演最优解法：

### 阶段一：真实物理世界与基础观测 (Phase 1: Physical Reality & Observation Grounding) [IN PROGRESS]
- [ ] **Phase 1: 真实家庭空调物理特性、可靠反馈与状态冻结**
  - **核心关切**：系统的控制与学习必须扎根于真实的物理世界，严格区分真实发生的事实与假设出来的状态，保持单周期观测的一致性与纯粹性。
  - **本轮进展 / Iteration progress**：已完成下方自主迭代的家庭数据分析、观测冻结、反馈来源修正与驱动协同修复；部署后的实机反馈、容量与时滞核验继续保留。

### 阶段二：控制行为重塑与舒适防扰 (Phase 2: Control Behavior & Disturbance Shield) [NEXT]
- [ ] **Phase 2: 温度目标与执行手段重构、动态调节能力与设备防打扰**
  - **核心关切与开放探索空间**：
    - **目标与手段的张力**：人类追求的是体感舒适，空调有自身的机身设定。如何让控制系统具备灵活动态调节（包括必要时的适度超调）以克服环境滞后，同时保持逻辑的清晰与自洽？
    - **物理设备副反应**：真实空调在频繁接收指令时会产生蜂鸣、亮屏等机械与声光干扰（尤其在夜间或静默时段）。控制行为应如何自适应收敛，既维持舒适，又保护家庭生活的安宁？

### 阶段三：人机心智模型与直觉交互 (Phase 3: Human Mental Model & Intuitive Interaction)
- [ ] **Phase 3: 消除用户认知冲突，重塑统一清晰的前端体验**
  - **核心关切与开放探索空间**：
    - 用户过去在界面上经常对“到底在调哪个温度”感到困惑与失控。前端交互应如何以最自然、直观的方式呈现温控意图与系统运行状态，让用户拥有笃定的掌控感与信任感？

### 阶段四：实机经验印证与极简演进 (Phase 4: Real-World Experience & Codebase Pruning)
- [ ] **Phase 4: 结合家庭实机数据演进与全局代码精简**
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
