# Storage, observations and eMMC / 存储、观测与 eMMC

RoomMind and its companion integrations preserve distinct measurements and control
evidence while coalescing repeated publications. Internal observations continue to
advance at the device's reporting rate. HA publication and disk persistence have
separate lifetimes.

本轮减写保留每次有效数值变化、可用性变化及控制证据。重复报告仍更新内存中的观测，
仅合并相同状态的对外发布；不会把发布时间当作设备接收时间。

## Household evidence / 家庭实机证据

Read-only inspection took place on 2026-09-12 UTC (2026-09-13 in China).
The settled Recorder window below is **15:30:17.702040–16:30:17.702040 UTC**.
Queries used SQLite `mode=ro` with `query_only=ON` and retained visibility of WAL.
Entity platforms came from the registry, so renaming did not change attribution.

| Platform | Recorded states | Only receipt attributes changed |
| --- | ---: | ---: |
| zM1 | 2,946 | 2,289 |
| TCL | 2,708 | 2,650 |
| RoomMind | 69 | 0 |
| All platforms | 6,534 | 4,939 |

These are rows, not flash write operations. An unchanged climate state such as
`cool` can still contain a real temperature or setpoint change; the audit compares
attributes as well as state. The initial live count was lower; this table uses a
later read of the fixed window, including Recorder's subsequently committed rows.

At 16:27:44 UTC the main Recorder file was 570,007,552 bytes. Its free-list pages
represented reusable capacity; file size alone does not measure live data volume
or write amplification. No database purge, vacuum or Recorder filter was applied.

From **16:37:39 to 16:38:24 UTC**, `/sys/block/mmcblk0/stat` advanced by 253 completed
writes and 6,728 sectors, or **3,444,736 bytes in 45.001 seconds**. These counters
cover the whole device, including other processes, filesystem metadata and SQLite
checkpoints. They cannot be attributed solely to RoomMind or extrapolated into a
validated flash lifetime.

`life_time` remained `0x02 0x01`; `pre_eol_info` was `0x01`. The lifetime values are
coarse manufacturer estimates for memory types A/B (10–20% and 0–10% used bands),
not a remaining-life countdown. The pre-EOL value reports normal reserve status.

固定窗口完整审计确认，主要重复来源是逐报告变化的 `observed_at` 等时间属性。
磁盘写入计数涵盖整机，不能把状态行减少比例直接称为 eMMC 写入减少比例。

## Publication rules / 发布规则

- The driver coordinator always retains its newest immutable observations.
  Device command matching and the TCL context-correlated evidence event run from
  that receive path, independently of entity publication.
- Every distinct entity state, physical attribute, source or availability change
  publishes immediately. This includes small numeric differences, setpoints,
  compressor diagnostics, power feedback and valve readings.
- Identical reports coalesce for up to **60 seconds for M1** and **120 seconds for
  TCL**. These intervals are below the existing 300-second observation expiry.
  A pending callback publishes the final received snapshot even if reports stop.
  It uses the original receipt timestamps and is cancelled when the entity unloads.
- Only explicitly identified receipt-time attributes are omitted from the change
  comparison. They remain present in published HA states and Recorder history.
  Diagnostic traffic timestamps use the same bounded publication interval.
- Unknown, unavailable and recovered states bypass coalescing. A write dispatch
  cannot change the observation or confirm an operation.

The publication deadband is exact equality. The available evidence does not
establish universal noise budgets of ±0.05 °C or ±0.5% humidity, so this iteration
does not discard distinct values using those thresholds. Existing device and HA
unit conversions remain authoritative.

相同读数的最新来源时间可延迟 60/120 秒发布，期间 HA 仍持有上一份真实观测。
定时补发保证静默前的最后报告能进入 HA；过期仍按字段接收时间判断。控制意图、派发、
物理确认与后续观测保持独立，热模型和控制周期不因发布合并而暂停。

## Entity defaults and statistics / 实体默认值与统计

M1 version, OTA progress and last-seen diagnostics are disabled by default for new
registrations. TCL protocol version, requested protocol version and query-time
diagnostics follow the same rule. Existing registry choices are preserved.

Environmental measurements, compressor/electrical feedback, faults and valve
states remain available. M1 temperature, humidity, PM2.5 and formaldehyde retain
`SensorStateClass.MEASUREMENT`. TCL fan-speed and expansion-valve numeric readings
now also support measurement statistics on their reported raw scale; no RPM,
percentage or other undocumented unit is invented. Existing energy totals keep
their reset and total semantics.

HA can retain five-minute statistics and hourly long-term statistics from these
measurement entities. Disabling pure metadata by default avoids creating a new
high-frequency history stream when another device is added. This does not silently
disable an entity that an existing household deliberately enabled.

## RoomMind persistence / RoomMind 持久化

The raw observation store reuses one SQLite connection, with serialized executor
access. Each batch still commits before returning. WAL remains open between
cycles, allowing normal SQLite checkpoints instead of forcing a last-connection
checkpoint at every close. The existing `synchronous=NORMAL` policy, schema,
duplicate constraint, retention and raw value precision remain in place.

Failed batches roll back before connection reuse. Shutdown stops scheduled work
and closes the store; late work cannot reopen a closed store. Regression tests
cover parallel executor writes, independent reads of committed data, failed batches
and reopen through a new store instance.

Configuration writes compare the complete snapshot with the last successful save
inside the existing serialized transaction. Identical saves perform no disk write.
Inputs are copied before waiting for the lock, and returned settings are detached
copies. A failed save remains eligible for an identical retry. History rotation
rewrites a CSV only when retention or corrupt-row removal actually changes it.

控制与学习的频率、观测批次提交及历史精度保持不变。减写来自重复发布、无变化保存和
多余连接关闭的消除，未降低数据库同步策略，也未扩大内存未提交数据窗口。

## Recorded-state replay / 历史状态回放

The same household window supplied **2,916 M1 measurement states**. Replay through
the new entities in a real HA test runtime produced **729 publications** including
initial states: **75% fewer**. This is a software replay result, not a deployed
flash-write measurement or packet-delivery test.

| Measurement | Original states | Replayed publications |
| --- | ---: | ---: |
| Temperature | 729 | 139 |
| Humidity | 729 | 266 |
| PM2.5 | 729 | 263 |
| Formaldehyde | 729 | 61 |

Every distinct value and its change order was retained. Five-minute windows used
HA's time-weighted mean implementation; the largest difference was
`3.56e-14`, within floating-point roundoff. Minima and maxima were identical.
Separate native HA tests verified TCL setpoint and raw valve changes, pending
receipt-time publication and observation-based command matching.

## Reproduction and limits / 复现与边界

Run the audit on the HA host or against a consistent database copy with its WAL:

```sh
uv run python tools/audit_recorder.py /path/to/home-assistant_v2.db \
  --registry /path/to/.storage/core.entity_registry --hours 1
```

`--end` accepts a Unix timestamp for a repeatable historical window. The tool
reports counts and changed attribute names, never attribute payloads or credentials.
It performs no database or HA configuration mutation.

Validation: RoomMind **2,309** Python tests; zM1 **56** tests; TCL **280** tests;
frontend **75** Bun tests; native HA/replay checks; Ruff, RoomMind mypy, targeted
driver mypy (2 zM1 and 3 TCL modules), frontend tsgo typechecks, build and ESLint.
The companion repositories contain the driver changes and their regression tests:
zM1 `a744464`, TCL `d1e9c56`.

No deployment, HA restart or household actuation was performed in this iteration.
The resulting household write rate and long-term eMMC wear remain to be measured
after deployment under comparable workload. Device-side reporting gaps described
in [M1 observation analysis](zm1-observation-chain.md) remain a separate issue.
