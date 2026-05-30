export const ROOM_EDIT_SECTIONS = [
  "schedule",
  "devices",
  "sensors",
  "airflow",
  "comfort",
  "presence",
  "covers",
  "heatSource",
] as const;

export type RoomEditSection = (typeof ROOM_EDIT_SECTIONS)[number];

const INFO_DIALOG_SECTIONS: ReadonlySet<RoomEditSection> = new Set([
  "schedule",
  "devices",
  "airflow",
  "comfort",
  "presence",
  "covers",
]);

export function roomEditDialogHasInfo(section: RoomEditSection): boolean {
  return INFO_DIALOG_SECTIONS.has(section);
}
