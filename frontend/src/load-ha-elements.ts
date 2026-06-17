/**
 * Force-load Home Assistant's built-in web components so custom panels
 * can use <ha-card>, <ha-button>, <ha-select>, <ha-entity-picker>, etc.
 *
 * Technique used by alarmo, scheduler-card, mushroom, and others.
 */
/* eslint-disable @typescript-eslint/no-explicit-any -- HA runtime APIs are untyped */
export const loadHaElements = async (): Promise<void> => {
  if (!customElements.get("ha-radio")) {
    try {
      const { HaRadioPolyfill } = await import("./ha-radio-polyfill");
      if (!customElements.get("ha-radio")) {
        customElements.define("ha-radio", HaRadioPolyfill);
      }
    } catch {
      // The affected radio controls will remain unavailable; keep loading the
      // rest of the HA elements so the panel does not fail as a whole.
    }
  }

  if (customElements.get("ha-entity-picker")) return;

  // Step 1: Load base HA components via partial-panel-resolver.
  // Guard on ha-selector (not ha-card) because ha-card can be defined by
  // other HA modules without the config/automation route being loaded.
  // We need ha-selector for the entity-picker fallback below.
  if (!customElements.get("ha-selector")) {
    await customElements.whenDefined("partial-panel-resolver");
    const ppr = document.createElement("partial-panel-resolver") as any;
    ppr.hass = {
      panels: [{ url_path: "tmp", component_name: "config" }],
    };
    ppr._updateRoutes();
    await ppr.routerOptions.routes.tmp.load();

    await customElements.whenDefined("ha-panel-config");
    const cpr = document.createElement("ha-panel-config") as any;
    await cpr.routerOptions.routes.automation.load();
  }

  // Step 2: Force-load ha-entity-picker via loadCardHelpers.
  // Works on older HA versions where the entities card editor still imports it.
  if (!customElements.get("ha-entity-picker")) {
    try {
      const helpers = await (window as any).loadCardHelpers();
      const card = await helpers.createCardElement({
        type: "entities",
        entities: [],
      });
      await card.constructor.getConfigElement();
    } catch {
      // May fail in HA 2025.5+ where entities editor was refactored
    }
  }

  // Step 2 fallback: ha-selector lazy-imports ha-selector-entity (which
  // statically imports ha-entity-picker) only when it renders with an
  // entity selector.  Briefly render one offscreen to trigger that chain.
  if (!customElements.get("ha-entity-picker")) {
    try {
      await Promise.race([
        customElements.whenDefined("ha-selector"),
        new Promise<void>((_, rej) => setTimeout(() => rej(new Error("timeout")), 10_000)),
      ]);
      const hass = (document.querySelector("home-assistant") as any)?.hass;
      const offscreen = document.createElement("div");
      offscreen.style.cssText = "position:fixed;left:-9999px;opacity:0;pointer-events:none";
      document.body.appendChild(offscreen);
      try {
        const sel = document.createElement("ha-selector") as any;
        sel.hass = hass;
        sel.selector = { entity: {} };
        offscreen.appendChild(sel);
        await Promise.race([
          customElements.whenDefined("ha-entity-picker"),
          new Promise<void>((r) => setTimeout(r, 5000)),
        ]);
      } finally {
        offscreen.remove();
      }
    } catch {
      // ha-entity-picker could not be loaded
    }
  }

  await customElements.whenDefined("ha-card");

  // Step 2b: HA 2026.5 removed `ha-textfield` in favour of `ha-input`.
  // Register a wrapper whenever `ha-textfield` is missing. Waiting for
  // `ha-input` is best-effort only; on newer HA frontends it may be imported
  // after this loader finishes, and the nested element upgrades later.
  if (!customElements.get("ha-textfield")) {
    try {
      await Promise.race([
        customElements.whenDefined("ha-input"),
        new Promise<void>((resolve) => setTimeout(resolve, 5000)),
      ]);
      const { HaTextfieldPolyfill } = await import("./ha-textfield-polyfill");
      if (!customElements.get("ha-textfield")) {
        customElements.define("ha-textfield", HaTextfieldPolyfill);
      }
    } catch {
      // The affected text fields will remain unavailable; keep loading chart
      // and date range elements instead of aborting panel startup.
    }
  }

  // Step 3: Load ha-date-range-picker (used by rs-analytics).
  if (!customElements.get("ha-date-range-picker")) {
    try {
      const helpers = await (window as any).loadCardHelpers();
      await helpers.createCardElement({
        type: "energy-date-selection",
        entities: [],
      });
      await Promise.race([
        customElements.whenDefined("ha-date-range-picker"),
        new Promise((_, reject) => setTimeout(reject, 5000)),
      ]);
    } catch {
      // ha-date-range-picker not available — fallback handled in component
    }
  }

  // Step 4: Load ha-chart-base (used by rs-analytics).
  // It is part of HA's history/energy modules and NOT loaded by the
  // config panel or card-helpers entities card.  Trigger the import
  // chain via the statistics-graph lovelace card, which depends on it.
  if (!customElements.get("ha-chart-base")) {
    try {
      const helpers = await (window as any).loadCardHelpers();
      await helpers.createCardElement({
        type: "statistics-graph",
        entities: [],
      });
      // Wait up to 5 s for async registration
      await Promise.race([
        customElements.whenDefined("ha-chart-base"),
        new Promise((_, reject) => setTimeout(reject, 5000)),
      ]);
    } catch {
      // ha-chart-base not available – analytics chart will be empty
    }
  }
};
