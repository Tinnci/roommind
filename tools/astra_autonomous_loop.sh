#!/usr/bin/env bash
# astra_autonomous_loop.sh
# Long-running continuous autonomous iteration harness for gpt-6-astra on RoomMind

set -u

PROJECT_DIR="/Users/driezy/Downloads/roommind"
INSTANCE_HOME="/Users/driezy/.antigravity_cockpit/instances/codex/76a7da54d33a5f4a"
CODEX_BIN="/Applications/ChatGPT.app/Contents/Resources/codex"
BACKLOG_FILE="${PROJECT_DIR}/ASTRA_TASKS.md"
LOOP_LOG="${PROJECT_DIR}/astra_loop.log"
LOCK_DIR="/tmp/astra_autonomous_loop_roommind.lock"
ITERATION_MAX=100
ITERATION_COUNT=0

unset ALL_PROXY HTTP_PROXY HTTPS_PROXY http_proxy https_proxy all_proxy

# Ensure uv, bun, node, and standard paths are in PATH
export PATH="/Users/driezy/.cargo/bin:/Users/driezy/.bun/bin:/usr/local/bin:/opt/homebrew/bin:${PATH}"

# Single instance lock guard
if ! mkdir "$LOCK_DIR" 2>/dev/null; then
    PID=$(cat "$LOCK_DIR/pid" 2>/dev/null || echo "")
    if [ -n "$PID" ] && kill -0 "$PID" 2>/dev/null; then
        echo "[$(date '+%Y-%m-%d %H:%M:%S')] Another RoomMind Astra autonomous loop is running (PID: $PID). Exiting."
        exit 0
    else
        rm -rf "$LOCK_DIR"
        mkdir "$LOCK_DIR" 2>/dev/null || exit 0
    fi
fi
echo $$ > "$LOCK_DIR/pid"
trap 'rm -rf "$LOCK_DIR"' EXIT INT TERM

export CODEX_HOME="$INSTANCE_HOME"
export SYNC_GH_IDENTITY=0
cd "$PROJECT_DIR" || exit 1

echo "==================================================" | tee -a "$LOOP_LOG"
echo "[$(date '+%Y-%m-%d %H:%M:%S')] Starting RoomMind Astra Autonomous Iteration Loop (PID: $$)..." | tee -a "$LOOP_LOG"
echo "[$(date '+%Y-%m-%d %H:%M:%S')] Instance Home: $INSTANCE_HOME" | tee -a "$LOOP_LOG"
echo "[$(date '+%Y-%m-%d %H:%M:%S')] Codex Binary: $CODEX_BIN" | tee -a "$LOOP_LOG"

while [ $ITERATION_COUNT -lt $ITERATION_MAX ]; do
    ITERATION_COUNT=$((ITERATION_COUNT + 1))
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] === Iteration $ITERATION_COUNT of $ITERATION_MAX ===" | tee -a "$LOOP_LOG"

    # Read the first pending task from backlog
    if [ ! -f "$BACKLOG_FILE" ]; then
        echo "[$(date '+%Y-%m-%d %H:%M:%S')] Backlog file $BACKLOG_FILE not found! Exiting." | tee -a "$LOOP_LOG"
        break
    fi

    PENDING_TASK=$(grep '^- \[ \]' "$BACKLOG_FILE" | head -n 1)
    if [ -z "$PENDING_TASK" ]; then
        echo "[$(date '+%Y-%m-%d %H:%M:%S')] All tasks in ASTRA_TASKS.md are completed! Loop exiting cleanly." | tee -a "$LOOP_LOG"
        break
    fi

    echo "[$(date '+%Y-%m-%d %H:%M:%S')] Current Target Task: $PENDING_TASK" | tee -a "$LOOP_LOG"

    PROMPT="请继续执行当前工程的连续迭代任务：
1. 当前目标任务：${PENDING_TASK}
2. 架构契约与设计指南：
   - 仔细阅读 CONTEXT.md、AGENTS.md、README.md 及相关模块代码；
   - 严格遵循 RoomMind 核心控制语义：Control Intent -> Actuation Plan -> Actuation Evidence -> Control Outcome。区分 Dispatch（发出）与 Confirmation（物理确认），传感器与设备状态以观测为准，保持数据流单向与不可变状态快照（Immutable Snapshots）；
   - 前端采用 Lit + TypeScript，**严禁使用 npm，必须统一使用 bun**（测试: \`cd frontend && bun test\`，类型检查: \`bun run typecheck\`，编译: \`bun run build\`）；
   - 后端采用 Python 3.12+，使用 \`uv run pytest\` 运行测试，\`uv run ruff check\` 进行代码规范检查；
3. 核心设计哲学（Clarity & Rigour via Simplification）：
   - 追求真正的代码清晰与严密，绝非堆砌防御性关卡或测试官僚主义；主动精简代码库，寻找更简洁、直接的功能实现路径，重新审视并精炼目标达成方式（Redesign Goal Realization）；
   - 坚决做减法与优先级排序：明确区分“真正必要的”与“冗余无用的”，主动剔除不必要的过度防御与繁琐冗余门禁（Prune redundant gates）；
   - 以真实数据驱动：优先加载并分析本地已就绪的真实家庭遥测数据（目录 \`data/household_telemetry/\` 下的 \`wo_shi_history.csv\`、\`ke_ting_history.csv\` 等数兆字节实际运行时序），基于真实空调（\`climate.tcl_air_conditioner_2\`）与传感器在生活中的客观表现驱动控制闭环与防骚扰演进。
4. 端到端系统工程联合调优 (End-to-End System Engineering: Driver + Control Fusion)：
   - 本地底层空调集成驱动源码仓库位于 \`/Users/driezy/ha-tcl-udp-ac\`；
   - 现已全权授权将该驱动仓库纳入联合调试、协议逆向分析与协同优化的统一系统工程范畴；
   - Astra 可跨仓库阅读、分析与修改 \`/Users/driezy/ha-tcl-udp-ac\`，挖掘底层协议（如压缩机真实运行位、功率、故障码）或从源头抑制声光骚扰（如静音/熄屏指令）；改动驱动后需执行 \`cd /Users/driezy/ha-tcl-udp-ac && uv run --with aiohttp --with cryptography --with voluptuous --with yarl python -m unittest discover -s tests -p 'test_*.py'\` 确保驱动测试全部通过。
5. 空间环境感知源头与传感器软硬件/固件协同 (Perception Grounding: Phicomm M1 / EMW3080 & zM1 Firmware/Protocol Co-Design)：
   - 卧室当前使用的真实环境感知硬件为基于 MXCHIP EMW3080 (Realtek RTL8710BN) 的斐讯悟空 M1 / ZM1 传感器，当前搭载第三方二进制发布固件项目：https://github.com/a2633063/zM1；
   - 相关集成与固件工程均已授权纳入端到端分析：
     * HA 传感器集成插件：\`/Users/driezy/Downloads/zm1\` 与 \`/Users/driezy/Downloads/zm1_ha\`；
     * 固件底层开发环境：\`/Users/driezy/Downloads/EMW3080\`（基于 RTL0B_SDK 的原生固件工程）；
   - 针对卧室 ZM1 偶发的 UDP 超时与回传不稳定，从“固件协议栈/调度/休眠”与“HA 插件套接字时序”两端开展深刻归因与开放性质询，探寻最优传输范式与原生固件重构路径，杜绝僵尸数据与上下线振荡。
6. 人机心智体验、产品美学与 Home Assistant 实体契约质询：
   - 深入思考人机心智模型与实体抽象边界，让前端 UI 自然呈现真实舒适意图与系统执行状态，使 HA 实体契约清晰诚实地反映多源物理事实，消除用户的失控感与认知负担；
   - 追求卓越的产品美学与平静科技（Calm Technology）体验：摆脱传统工控面板与粗糙卡片的生硬感，借鉴现代高端空间产品（如 Braun、Nest、B&O）的克制优雅，精雕现代排版、呼吸感留白、冷暖气候微渐变与平滑触控微交互（Fluid Motion / Tactile Feedback），兼顾极致轻盈与深层信任。
7. 代码行间注释使用英文（English comments），文档建议采用中英双语。
8. 编写完毕后在本地运行测试确认功能正常（如 \`uv run pytest\` 及 \`cd frontend && bun test\`）。
9. 完成后执行 git add 并使用规范的 git commit 提交改动，将变更推送至 GitHub 远端 (\`git push origin main\`)。
10. 执行 \`./deploy.sh\` 将最新组件及配套驱动同步部署至 192.168.3.120 实机，确保 Home Assistant 容器重启并正常加载。
11. 更新 ASTRA_TASKS.md 将该条目勾选为 [x]，并简要输出本次迭代实现的总结。"

    # Execute with session resumption if available, otherwise new session
    "$CODEX_BIN" exec resume --last "$PROMPT" < /dev/null >> "$LOOP_LOG" 2>&1
    EXIT_CODE=$?

    if [ $EXIT_CODE -ne 0 ]; then
        echo "[$(date '+%Y-%m-%d %H:%M:%S')] Session resume returned code $EXIT_CODE. Launching fresh session..." | tee -a "$LOOP_LOG"
        "$CODEX_BIN" exec -C "$PROJECT_DIR" -m gpt-6-astra "$PROMPT" < /dev/null >> "$LOOP_LOG" 2>&1
    fi

    # Check git status for uncommitted changes if Astra did not commit directly
    DIRTY_FILES=$(git status -s | grep -E '^[ MADRCU?]{2} ' | grep -v 'astra_')
    if [ -n "$DIRTY_FILES" ]; then
        echo "[$(date '+%Y-%m-%d %H:%M:%S')] Found uncommitted changes from Astra, creating incremental commit..." | tee -a "$LOOP_LOG"
        git add -A
        git commit -m "feat(auto-iterate): incremental progress on ${PENDING_TASK#*- }" >> "$LOOP_LOG" 2>&1 || true
    fi

    # Continuous delivery: Push to GitHub and deploy to 192.168.3.120
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] Synchronizing changes to GitHub origin/main..." | tee -a "$LOOP_LOG"
    git push origin main >> "$LOOP_LOG" 2>&1 || true
    if [ -d "/Users/driezy/ha-tcl-udp-ac" ]; then
        (cd /Users/driezy/ha-tcl-udp-ac && git push origin main >> "$LOOP_LOG" 2>&1 || true)
    fi
    if [ -d "/Users/driezy/Downloads/zm1" ]; then
        (cd /Users/driezy/Downloads/zm1 && git push origin main >> "$LOOP_LOG" 2>&1 || true)
    fi
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] Deploying updated components to 192.168.3.120..." | tee -a "$LOOP_LOG"
    ./deploy.sh >> "$LOOP_LOG" 2>&1 || true

    # Adaptive cooldown between turns: brief pause on success, longer pause on error/rate-limit
    if [ $EXIT_CODE -ne 0 ]; then
        echo "[$(date '+%Y-%m-%d %H:%M:%S')] Iteration $ITERATION_COUNT encountered exit code $EXIT_CODE. Backing off 20 seconds before retry..." | tee -a "$LOOP_LOG"
        sleep 20
    else
        echo "[$(date '+%Y-%m-%d %H:%M:%S')] Iteration $ITERATION_COUNT finished cleanly. Pausing 5 seconds before next loop..." | tee -a "$LOOP_LOG"
        sleep 5
    fi
done

echo "[$(date '+%Y-%m-%d %H:%M:%S')] Autonomous loop complete." | tee -a "$LOOP_LOG"
