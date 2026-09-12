# M1 / zM1 observation chain / 观测链分析

## Result / 本轮结论

The integration had two reproducible faults: short-lived UDP sockets missed
broadcasts between polls, and cached readings acquired new publication times.
RoomMind also accepted expired numeric values for control after excluding them
from fusion. These paths now share field observation timestamps and a bounded
300-second lifetime.

已修复插件接收空窗、缓存时间被刷新，以及 RoomMind 控制与融合对过期读数判断不一致的问题。
这不等于已证明固件或 Wi-Fi 完全可靠：后续只读抓包中，设备仍回复状态查询，
但没有温湿度报告到达。状态在线与传感器有效必须分别判断。

## Evidence collected on 2026-09-12 / 实机证据

All times below are UTC. The inspection used passive captures, `/proc/net/udp`
sampling, a listener on the development computer and one read-only interval query.
It changed no device settings and did not restart HA or flash firmware.

| Observation | Result | What it establishes |
| --- | --- | --- |
| Initial 50-second HA-host capture, packets at 14:17:18–14:18:00 | 3 queries, 3 state replies, 5 sensor broadcasts; no capture drops reported | Sensor packets reached the HA host separately from query replies |
| Query/reply intervals in that capture | 125.681, 77.090, 130.440 ms | Queries worked in this window; this is not a long-term latency distribution |
| Delivered sensor intervals | 4.710–14.541 s, median 9.933 s | Arrival cadence was not a precise five-second clock |
| New listener on the development computer, 15:05:15–15:06:00 | 3 state reports, no sensor reports, zero commands sent | A persistent receiver can observe broadcasts without polling; this window does not validate temperature delivery |
| HA socket sampling, 15:07:54–15:08:29 | Port 10181 bound in 6 of 680 samples; observed open interval about 0.31 s, sampled every 50 ms | The old receiver was absent for most of this window |
| Concurrent 35-second HA-host capture | 1 query, 1 state reply in 88.793 ms, no sensor broadcasts | Absence of sensor reports also exists upstream of the HA application socket |
| Read-only `{"interval":null}` query at 15:53:13 | Device reported `5`; one attempt, no setting write | At this time the reporting interval was still five seconds; this does not measure actual sampling |
| Packaged passive diagnostic, 15:55:10–15:55:55 | No reports at the development computer; all output measurements remained unknown | Exercises the missing-data path; it does not establish a healthy link |

The initial five sensor packets all fall outside receive windows reconstructed
from the old code's query reply plus 0.2-second sensor wait. That reconstruction
does not measure thread scheduling delay. The later socket sampling independently
confirms the short listener lifetime; it is not a packet-loss percentage.

首次抓包与代码时序共同支持“插件漏收”归因；后续抓包又证明，插件之外仍有报告空窗。
现有证据无法把后一种空窗进一步归为无线丢包、DTIM、传感器总线、任务调度或堆问题。
需要 AP 侧抓包和设备串口日志才能继续区分，不能把所有 UDP 超时解释为同一个原因。

Local bedroom telemetry was also re-read: `wo_shi_history.csv` contains 25,360
rows and 54 missing temperatures; `wo_shi_detail.csv` contains 896 rows and 48
missing temperatures. The longest unchanged temperature runs are 24,600 and
5,580 seconds respectively. These are application history rows, not packet logs:
constant temperature alone cannot establish either a healthy sensor or a stuck one.

## Wire protocol / 协议边界

The [upstream protocol](https://github.com/a2633063/zM1/wiki/通信协议), the
[v0.1.4 release](https://github.com/a2633063/zM1/releases/tag/v0.1.4), and the
observed device reports agree on the following:

| Item | Meaning |
| --- | --- |
| UDP command destination | Device IPv4 address, port `10182` |
| Observed UDP report path | Source port `10182`, destination `255.255.255.255:10181` |
| Encoding | JSON object, at most 1023 UTF-8 bytes; normalized MAC identifies the device |
| Read query | Requested fields have JSON `null` values |
| Discovery | `{"cmd":"device report"}`; response includes device identity |
| Sensor report | `temperature`, `humidity`, `PM25`, `formaldehyde`, usually numeric strings |
| State query used by the integration | `brightness`, `version`, `name`; the observed firmware does not return `ota_progress` in this query |
| Reporting interval | Protocol documents `interval`, seconds, default 5; no interval setting was changed in this iteration |
| MQTT | `device/zm1/<mac>/set`, `/state`, `/sensor` |
| Missing information | No documented request nonce, sample timestamp or sample sequence |

No sequence field is invented for the installed firmware. Requests are serialized
per MAC on one shared listener. All requested fields must be reported; writes also
require matching values, including requested members of nested settings. Newer
conflicting reports invalidate earlier matches within the wait. This is report
matching, not causal proof that this request changed the hardware: identical late
replies cannot be disambiguated without firmware support.

协议没有事务号，因此不能把本地计数器冒充设备确认。UDP 字段回报与 MQTT 发布完成
都不证明屏幕、传感器或 OTA 已物理执行。OTA 仍只能由后续进度、版本及设备观测验证。

## Integration behavior / 驱动改造

The maintained checkout is `/Users/driezy/Downloads/zm1`. The checkout under
`zm1_ha/zm1` points to the same upstream and contains an older ancestor; it was
inspected without duplicating edits. EMW3080 remains a separate firmware workspace.

- One asynchronous socket per local response address serves all devices and
  discovery. Unsolicited and late reports remain observable after request timeout.
  Cancellation and unload release ownership; the last owner closes the socket.
- Queries use at most two attempts per poll, separated by 0.2 seconds. Repeated
  failures retain the existing adaptive polling backoff. Arbitrary write commands,
  including restart and OTA, are dispatched once.
- Malformed, oversized, wrong-MAC and wrong-host packets cannot satisfy a request.
  Discovery uses an absolute collection window, unaffected by ongoing broadcasts.
- Each valid field carries its own receive timestamp and transport source in a
  deeply immutable snapshot. Missing or invalid fields do not refresh old readings.
  `_last_seen` describes received traffic, not successful polling or publication.
- Sensor and brightness availability expire after 300 seconds without a valid
  report for that field, independently of polling backoff. One new valid report
  restores that field immediately. Diagnostics such as the last-seen time remain
  historical facts. Stable recovery of the transport Repairs issue remains separate.
- Push updates preserve scheduled diagnostic polls. An independent expiry callback
  updates HA even if queries have backed off to an hour.
- MQTT publish returns dispatch completion without optimistic state mutation.
  Retained payloads cannot establish freshness because they lack sample timestamps;
  a live report is required. MQTT is an available alternative when broadcast delivery
  is unsuitable, but broker delivery does not prove physical sampling or actuation.

HA measurement attributes are `observed_at`, `observation_source` (`udp` or
`mqtt`) and `observation_max_age_s`. `observed_at` is **host receipt time for that
field**, not a recovered sensor sampling clock. A repeated identical value in a
new report refreshes this time; a brightness-only report does not refresh temperature.

工程硬件说明列出 SHT20 温湿度、攀藤颗粒物与万胜 WZ-S 甲醛传感器；本次没有拆机确认引脚。
插件只创建温度、湿度、PM2.5、甲醛四种环境测量。CO₂、eCO₂、TVOC 占位实体定义已移除；
升级时仅清理当前配置项及 MAC 所属的三个旧注册项，保留真实测量及其他设备。

## RoomMind consumption / 上层观测消费

For temperature and humidity, explicit `observed_at` takes priority over HA
`last_reported`, `last_updated` and `last_changed`. A configured climate entity can
also provide `current_temperature_observed_at` or `current_humidity_observed_at`.
Invalid, timezone-free or future explicit times stay unknown instead of falling
back to a newer HA publication time. Non-finite readings are excluded.

Control temperature selection and fusion now use the same usable observations.
An expired primary can fall back to a fresh auxiliary. Expired humidity cannot
re-enter through a fallback branch. The 300-second temperature fallback counts
from the original report, so polling, a partial update or later unavailability
cannot grant an additional five minutes.

原始观测历史保留字段时间与来源，前端标注“设备观测”。老集成没有字段时间时仍兼容 HA
报告时间，不能从未提供的元数据推断真实采样时刻。所有房间输入仍在动作前冻结；缓存回退
不作为当前温度送入学习或温度历史。既有 Control Intent → Actuation Plan → Actuation
Evidence → Control Outcome 顺序与物理确认规则保持贯通。

## Firmware feasibility / 原生固件路径

The public zM1 repository distributes binaries rather than complete firmware
source. The inspected v0.1.4 OTA image is 600,292 bytes. Strings identify the
Realtek/MXCHIP stack, `udp_thread`, `mqtt_client_thread`, `uart_thread`, send queues,
`app_thread` and a watchdog-reset message. These contradict a confident claim
that all work necessarily runs in one blocking sensor loop. They do not reveal
queue capacities, task priorities, heap evolution or whether power saving is active.

The existing `RTL0B_SDK` bring-up application passed a clean build with GCC 10.3.1. The image
builder reports 233,616 bytes of flash payload and 3,136 bytes of RAM payload;
the latter is not total runtime RAM use. The application currently prints a banner
and task heartbeat. It does not yet implement verified M1 sampling, pin control,
provisioning or a production OTA path.

A practical next firmware iteration is:

1. Verify board pins and raw sensor traffic using UART/SWD, preserving the working
   flash and calibration data before any replacement image is written. The SDK's
   OTA layout differs from the old MXCHIP bundle; a successful build is insufficient
   evidence that an image is safe to flash.
2. Give each sampling operation a timeout and validity result. Publish a copied
   sample through a bounded queue; network requests read that sample without waiting
   on a sensor bus. Keep application packet buffers bounded and avoid allocations
   per report where practical, while retaining the vendor Wi-Fi/RTOS stack.
3. Measure task runtime, queue drops, minimum free heap, stack high-water marks,
   Wi-Fi reconnects and sample age. Feed the watchdog from task progress; avoid
   blocking network work on display updates or verbose serial logging.
4. Only in a supported new firmware version, add sampling uptime/sequence and
   request correlation, with reset semantics. Keep stale samples explicitly invalid
   and measure response distributions under Wi-Fi loss and slow sensors. Wi-Fi
   response times cannot be promised at microsecond precision from this evidence.

本阶段交付的是协议证据、通信与观测代码、回归验证及可构建的既有启动工程核验。
没有把原生固件方案写成已完成的传感器驱动，也没有宣称家庭链路丢包率或可靠性已达标。

## Reproduction / 复现

Local validation completed for this iteration:

| Check | Result |
| --- | --- |
| RoomMind Python suite | 2,302 passed |
| zM1 Python suite | 52 passed, 7 subtests passed |
| Ruff | Both repositories passed |
| Mypy | RoomMind: 66 source files; zM1: 7 changed runtime modules passed |
| Frontend | 75 Bun tests; tsgo typechecks, build and ESLint passed |
| Firmware | Existing RTL0B_SDK bring-up application passed a clean native build |

ZM1 changes are committed as `7da1644`. These checks validate the software and
build paths; they do not measure deployed household reliability.

In the zM1 checkout, run `uv run pytest` and `uv run ruff check`. The tests cover
real loopback UDP sockets, missing/late/malformed packets, concurrent devices,
immutable field updates, MQTT dispatch, HA expiry and entity migration.

Use a separate LAN computer for passive device observation:

```sh
uv run python scripts/observe_udp.py --host <device-ipv4> --mac <device-mac> --duration 45
```

This tool sends no packets. Its output separates state traffic from sensor traffic
and leaves unseen measurements unknown. On the HA host, use passive `tcpdump`
instead of starting a competing receiver on its occupied port.

RoomMind validation uses `uv run pytest`, `uv run ruff check`,
`uv run mypy custom_components/roommind`, and the frontend's `bun test`,
`bun run typecheck`, `bun run build`, `bun run lint`. Firmware build commands are
documented in the EMW3080 workspace's `docs/sdk-setup-macos.md`.
