/**
 * Shared live rooms feed for embeddable Lovelace room cards.
 * Prefers RoomMind's real-time push subscription with periodic polling fallback.
 */
import type { HomeAssistant, RoomConfig } from "../types";

export interface RoomsSnapshot {
  rooms: Record<string, RoomConfig>;
  climate_control_active: boolean;
  vacation_active: boolean;
  vacation_temp: number | null;
  outdoor_temp: number | null;
  error?: boolean;
}

type Subscriber = (snap: RoomsSnapshot) => void;

const REFRESH_MS = 30_000;

class RoomsFeed {
  private _hass: HomeAssistant | null = null;
  private _subscribers = new Set<Subscriber>();
  private _unsubPush: (() => void) | null = null;
  private _timer: ReturnType<typeof setInterval> | undefined;
  private _latest: RoomsSnapshot = {
    rooms: {},
    climate_control_active: true,
    vacation_active: false,
    vacation_temp: null,
    outdoor_temp: null,
  };

  public setHass(hass: HomeAssistant): void {
    const changed = this._hass?.connection !== hass.connection;
    this._hass = hass;
    if (changed && this._subscribers.size > 0) {
      this._teardown();
      this._start();
    }
  }

  public subscribe(fn: Subscriber): () => void {
    this._subscribers.add(fn);
    if (Object.keys(this._latest.rooms).length > 0) fn(this._latest);
    if (this._subscribers.size === 1) {
      this._start();
    }
    return () => {
      this._subscribers.delete(fn);
      if (this._subscribers.size === 0) {
        this._teardown();
      }
    };
  }

  public async refresh(): Promise<void> {
    if (!this._hass?.callWS) return;
    try {
      const payload = await this._hass.callWS<Partial<RoomsSnapshot>>({
        type: "roommind/rooms/list",
      });
      this._publish(payload);
    } catch {
      this._latest = { ...this._latest, error: true };
      for (const fn of this._subscribers) fn(this._latest);
    }
  }

  private _publish(payload: Partial<RoomsSnapshot>): void {
    this._latest = {
      rooms: payload.rooms ?? {},
      climate_control_active: payload.climate_control_active ?? true,
      vacation_active: payload.vacation_active ?? false,
      vacation_temp: payload.vacation_temp ?? null,
      outdoor_temp: payload.outdoor_temp ?? null,
      error: false,
    };
    for (const fn of this._subscribers) fn(this._latest);
  }

  private _start(): void {
    void this.refresh();
    this._timer = setInterval(() => void this.refresh(), REFRESH_MS);
    if (this._hass?.connection?.subscribeMessage && !this._unsubPush) {
      this._hass.connection
        .subscribeMessage((msg: unknown) => this._publish(msg as Partial<RoomsSnapshot>), {
          type: "roommind/rooms/subscribe",
        })
        .then((unsub) => {
          if (this._subscribers.size === 0) unsub();
          else this._unsubPush = unsub;
        })
        .catch(() => {
          // Polling fallback remains active when subscribe is unavailable
        });
    }
  }

  private _teardown(): void {
    if (this._timer !== undefined) {
      clearInterval(this._timer);
      this._timer = undefined;
    }
    if (this._unsubPush) {
      try {
        this._unsubPush();
      } catch {
        // Ignore teardown errors
      }
      this._unsubPush = null;
    }
  }
}

const sharedFeed = new RoomsFeed();

export function setFeedHass(hass: HomeAssistant): void {
  sharedFeed.setHass(hass);
}

export function subscribeRooms(fn: Subscriber): () => void {
  return sharedFeed.subscribe(fn);
}

export function refreshRooms(): Promise<void> {
  return sharedFeed.refresh();
}
