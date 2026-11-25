import "./card/roommind-room-card";

declare global {
  interface Window {
    customCards?: Array<{ type: string; name: string; description: string; preview?: boolean }>;
  }
}

window.customCards = window.customCards ?? [];
if (!window.customCards.some((c) => c.type === "roommind-room-card")) {
  window.customCards.push({
    type: "roommind-room-card",
    name: "RoomMind Room Card",
    description: "Monitor temperature, humidity, air quality, and adjust RoomMind targets.",
    preview: true,
  });
}
