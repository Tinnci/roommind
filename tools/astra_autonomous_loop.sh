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
3. 遵循'功能优先、避免繁琐 gate 卡点'原则，写出简洁健壮的高质量生产代码与测试用例。
4. 代码行间注释使用英文（English comments），文档建议采用中英双语。
5. 编写完毕后在本地运行测试确认功能正常（如 \`uv run pytest\` 及 \`cd frontend && bun test\`）。
6. 完成后执行 git add 并使用规范的 git commit 提交改动（例如: feat(...), fix(...), chore(...)）。
7. 更新 ASTRA_TASKS.md 将该条目勾选为 [x]，并简要输出本次迭代实现的总结。"

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
