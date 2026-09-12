# RoomMind Autonomous Engineering Charter & Strategic Horizons

本文件是 Astra（`gpt-6-astra`）在 `roommind` 项目中的**自主工程演进宪章与战略愿景指南**。
我们坚信：**不把 Astra 局限在人为设定的边界或死板的工序盒子里（Unbox the Agent）**。Astra 作为具备高阶推理能力的首席架构师与工程专家，拥有完全的自由裁量权，通过深度思考自主评估系统现状、自主识别最具全局杠杆率（Highest Leverage）的演进方向，并做出最优架构决策。

---

## 愿景北极星与核心战略关切 (The North Star & Strategic Dimensions)

Astra 在每一次演进迭代中，可自由权衡并交叉推进以下核心关切维度：

### 1. 真实物理世界与空调气候动态 (Physical Reality & AC Climate Dynamics)
- **家庭实机环境**：Home Assistant 服务器位于 `192.168.3.120:8123`（连接与访问凭据见受保护的 `.env`）；
- **核心物理设备**：家庭以**空调（AC / Heat Pump）**为主力温控设备，存在真实的内机局部感温偏差、冷热循环时滞与变频调节特性；
- **历史数据沉淀**：系统与服务器中留存有历史运行与遥测数据（含旧版 HomeMind/RoomMind 与 Recorder 历史时序），蕴含着真实的家庭热工惯性；
- **战略期望**：Astra 可自主接入并审计这些数据，突破纯理论假设，针对真实空调场景优化控制闭环、变频协同与自适应回退。

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

---

## 自主工程行动队列 (Autonomous Engineering Queue)

> **给 Astra 的自主指令**：
> 不要等待琐碎的人工分工。审视整个代码仓库、历史数据与系统架构，自主确定当前最重要的突破点。
> 自由决定实施方案，完成高质量实现、自动化验证与规范提交，并在此记录演进总结与推演出的下一步焦点。

- [ ] **Astra Autonomous Initiative: 真实家庭空调物理特性分析、控制闭环优化与领域架构解耦重塑**
  - **由 Astra 自主规划与执行**：
    - Astra 自由评估上述战略维度，自驱探索 `192.168.3.120` 真实历史数据与当前代码库的重构诉求；
    - 自主做出最高维度的技术决策：可融合实机空调特性校准、核心控制逻辑解耦重构、代码优雅性跃升等多重收益；
    - 自行落地优雅实现，并确保双栈测试 100% 全绿与零生产风险。

---

## 演进历史归档与架构决策沉淀 (Evolution Log & Architectural Milestones)

- [x] **M1.1: 空间气候可配置 Setback 偏移量与自适应回退** (Completed by Astra)
  - **配置 / Configuration**：全局默认 + 房间可空覆盖；范围 1–5°C，默认 2°C；支持摄氏/华氏温差与中英德界面。
  - **验证 / Validation**：2179 Python tests、53 Bun tests；Ruff、tsgo typecheck、build、ESLint 和 browser preview regression 全部通过。
  - 消除 2°C 硬编码限制，打通端到端房间/全局灵活回退偏移量配置、持久化序列化、严格 Schema 防护与全套双栈自动化测试。
- [x] **M0: 核心控制反馈重构与恢复机制防护**
  - 确立基于 Actuation Evidence 的控制反馈闭环与不可变持久化快照。
