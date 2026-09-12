# RoomMind Autonomous Engineering Roadmap & Task Backlog

本任务清单是 Astra（`gpt-6-astra`）在 `roommind` 项目中自主演进与连续迭代的主干清单。
配合 `tools/astra_autonomous_loop.sh` 脚本，实现无人值守、高容错、自适应退避的自主工程研发。

---

## 核心架构契约与设计哲学 (Architectural Guidelines)

1. **严格的控制语义 (Domain Semantics)**：
   - 严格遵循 `CONTEXT.md` 与 `AGENTS.md`：
     `Control Intent` -> `Actuation Plan` -> `Actuation Evidence` -> `Control Outcome`；
   - 区分服务调用发出（Dispatch）与物理硬件确认（Confirmation）；
   - 设备状态与室温感知以实际观测为准，绝不可将未确认的意图直接作为真值训练模型。
2. **单向数据流与不可变快照 (Immutable Persistence)**：
   - 配置与持久化状态变更采用序列化单事务写入；
   - 跨 await 边界传递不可变快照，禁止泄露可变字典或对象引用。
3. **极速双栈工具链与规范 (Toolchain & Testing)**：
   - **前端 (Frontend)**：Lit + TypeScript，**严禁使用 npm，统一使用 bun**。测试命令：`cd frontend && bun test`，编译命令：`bun run build`，类型检查：`bun run typecheck`；
   - **后端 (Backend)**：Python 3.12+，使用 `uv run pytest` 运行测试，`uv run ruff check` 执行规范检查；
   - **注释与文档**：代码行间注释统一使用英文（English comments），工程文档采用中英双语。

---

## 研发任务队列 (Active Engineering Backlog)

- [ ] **M1.1: 空间气候可配置 Setback 偏移量与持久化支持 (Configurable Setback Offset & Flexible Persistence)**
  - **背景与目标**：
    - 当前系统在 AC/热泵的空闲低功耗回退模式下，setback offset 固定为 `2°C`，在 Web UI 与房间配置中不可配置（见 `docs/control-and-devices.md`）；
    - 需要支持用户按房间或全局自定义 setback 偏移（例如 1.0°C ~ 5.0°C），并保证状态平滑回退与节能平衡。
  - **具体交付要求**：
    1. 在 `room_config.py` 与持久化模型中引入 `setback_offset` 可选字段，提供向后兼容默认值（2.0°C）；
    2. 协调器 `coordinator.py` 与执行计划 `actuation.py` 在计算 idle/setback 目标温时使用配置的偏移量；
    3. 更新 WebSocket API（`websocket_api.py`）与保存/读取协议；
    4. 前端使用 Bun 补充 Lit 控制卡片与设置表单组件（`rs-device-section.ts` / `rs-room-detail.ts`），并对齐中英德三语翻译（`en.json`, `zh-Hans.json`, `de.json`）；
    5. 补充全套 Python 协调器单元测试与前端 `bun test` 状态往返测试。

- [ ] **M1.2: 多热源智能协同与能效调度增强 (Multi-Source Orchestration & Heat Pump/TRV Priority)**
  - **背景与目标**：
    - 针对兼具水暖 TRV 阀门与变频空调/热泵（AC）的混合型房间，优化根据室外温度、温差梯度与 COP 能效曲线的动态调度矩阵；
    - 防止两套系统同时开启反向竞争或低效运行。
  - **具体交付要求**：
    1. 完善 `heat_source.py` 与 `managers/heat_source_integration.py` 调度算法；
    2. 确保在不同室外温标与需求梯度下，正确选择主供暖源、辅助增压供暖或独立运行；
    3. 补充针对大温差突变、室外温度传感器短暂失效时的平滑回退安全测试。

- [ ] **M1.3: 防幽灵供暖与阀门卡死自愈安全策略 (Anti-Ghost-Heating & Valve Seizing Auto-Remediation)**
  - **背景与目标**：
    - 在集中供暖或多联机场景下，可能出现阀门关闭但管道仍存在热水渗漏、或阀门长期闲置导致水垢卡死的现象；
    - 增强对非预期升温（Ghost Heating）的实时研判与自愈告警。
  - **具体交付要求**：
    1. 升级 `ghost_heating_guard.py`，结合房间热模型（EKF）预测曲线识别异常非命令温升；
    2. 完善周期性防钙化阀门微冲程冲刷策略，避免在用户睡眠或静音时段误触发；
    3. 完善状态遥测实体与诊断日志。

- [ ] **M1.4: 前端卡片渲染性能与 Home Assistant 现代设计语言深度适配 (Modern Frontend Performance & Card Polish)**
  - **背景与目标**：
    - 提升大规模多房间（10+ 房间）场景下的 Lit 渲染效率，优化移动端 Companion App 交互手感与动画平滑度。
  - **具体交付要求**：
    1. 优化 `rs-area-card.ts` 与 `rs-hero-status.ts` 的脏区检测与重绘机制；
    2. 适配深浅色自适应主题与移动端触控反馈；
    3. 使用 `bun test` 与 `bun run build` 确保前端零类型错误与高测试覆盖率。

- [ ] **M1.5: 自动化质量门禁与发布打包包络验证 (Comprehensive CI Gates & HACS Release Audit)**
  - **背景与目标**：
    - 确保每一次提交均满足严格的代码风格、类型安全和发布依赖合规要求。
  - **具体交付要求**：
    1. 运行 `scripts/build_release_package.py` 验证发布包校验；
    2. 全面通过 `uv run pytest`、`uv run ruff check` 及 `cd frontend && bun test && bun run typecheck`。

---

## 历史交付归档 (Completed Milestones)

- [x] **M0: 核心控制反馈重构与恢复机制防护 (Initial Control Feedback & Safeguards)**
  - 确立基于 Actuation Evidence 的控制反馈闭环；
  - 隔离 Dispatch 与 Confirmation 语义，固化不可变持久化快照。
