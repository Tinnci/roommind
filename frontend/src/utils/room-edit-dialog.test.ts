import { describe, expect, test } from "bun:test";
import { ROOM_EDIT_SECTIONS, roomEditDialogHasInfo } from "./room-edit-dialog";

describe("room edit dialog routing", () => {
  test("declares every editable room section exactly once", () => {
    expect(ROOM_EDIT_SECTIONS).toEqual([
      "schedule",
      "devices",
      "sensors",
      "airflow",
      "comfort",
      "presence",
      "covers",
      "heatSource",
    ]);
  });

  test("marks only dialogs with explanatory panels as info dialogs", () => {
    expect(roomEditDialogHasInfo("schedule")).toBe(true);
    expect(roomEditDialogHasInfo("devices")).toBe(true);
    expect(roomEditDialogHasInfo("sensors")).toBe(false);
    expect(roomEditDialogHasInfo("airflow")).toBe(true);
    expect(roomEditDialogHasInfo("comfort")).toBe(true);
    expect(roomEditDialogHasInfo("presence")).toBe(true);
    expect(roomEditDialogHasInfo("covers")).toBe(true);
    expect(roomEditDialogHasInfo("heatSource")).toBe(false);
  });
});
