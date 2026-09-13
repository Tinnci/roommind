# Voice and RoomMind / 语音与空间意图

Voice uses the same distinction as the RoomMind panel: observed room conditions,
the Effective Target Plan, and the Actuation Plan are separate facts.

| Intent / 意图 | Interface / 接口 |
| --- | --- |
| 卧室现在多少度？ | HA's designated area temperature sensor, matching the room's chosen observation source. |
| 把卧室温度调到 25.5 度 | The registered `climate.roommind_{area_id}_comfort` entity. This changes the room policy. |
| 把卧室空调设为 25.5 度 | The explicitly named physical AC entity. This changes a device setpoint. |

The comfort entity retains its existing schedule/hold behavior. Its successful
service call is not proof that a physical device applied the target or that the
room has reached it. The Control Cycle continues to observe, plan, constrain,
submit, reconcile, learn, publish, and persist. No voice path writes directly
into the coordinator or thermal model.

卧室 M1 的房间温度与 TCL 空调内温来自不同物理位置，不能互相替代。历史数据中的
设备设定与舒适目标之差为 −4.5～+2.5°C；这也是两个不同概念，不是温度校准偏移。
传感器字段过期时，语音应说明该来源当前不可用。未观测到的压缩机活动继续未知。

LLM Gateway owns voice source selection, follow-up resolution, dispatch speech,
and its calm Overview. It consumes the companion TCL driver's existing command
events by context ID and entity. A matched `applied` report confirms the device's
requested settings; it does not establish compressor operation or room comfort.
RoomMind retains its own later-evidence reconciliation and quiet actuation.

See the canonical [Voice and room intent guide](https://github.com/Tinnci/llm-gateway/blob/main/docs/voice-room-intent.md)
for Gateway behavior and the Norta Assist pipeline setting. Its local room reads
do not need an LLM request. HA's area observation assignments and Assist exposure
remain the source of room selection; the voice integration creates no parallel
sensor entities or calibration constants.
