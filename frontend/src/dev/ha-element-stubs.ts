const STUB_STYLE = `
  box-sizing: border-box;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-height: 20px;
`;

class HaIconStub extends HTMLElement {
  connectedCallback() {
    this.style.cssText = STUB_STYLE;
    this.textContent = "";
  }
}

class HaCardStub extends HTMLElement {
  connectedCallback() {
    this.style.cssText = "display:block";
  }
}

class HaButtonStub extends HTMLElement {
  connectedCallback() {
    this.style.cssText = `${STUB_STYLE}; cursor:pointer;`;
  }
}

class HaIconButtonStub extends HaButtonStub {}

class HaCheckboxStub extends HTMLElement {
  private _checked = false;

  public set checked(value: boolean) {
    this._checked = value;
    this._sync();
  }

  public get checked(): boolean {
    return this._checked;
  }

  connectedCallback() {
    this.style.cssText = STUB_STYLE;
    if (!this.shadowRoot) {
      const root = this.attachShadow({ mode: "open" });
      root.innerHTML = `<input type="checkbox" />`;
      root.querySelector("input")?.addEventListener("change", (event) => {
        this.checked = (event.target as HTMLInputElement).checked;
        this.dispatchEvent(new Event("change", { bubbles: true }));
      });
    }
    this._sync();
  }

  protected _sync() {
    const input = this.shadowRoot?.querySelector("input");
    if (input instanceof HTMLInputElement) {
      input.checked = this.checked;
    }
  }
}

class HaRadioStub extends HaCheckboxStub {}

class HaSwitchStub extends HaCheckboxStub {}

class HaTextfieldStub extends HTMLElement {
  private _label = "";
  private _value = "";

  public set label(value: string) {
    this._label = value ?? "";
    this._render();
  }

  public get label(): string {
    return this._label;
  }

  public set value(value: string) {
    this._value = value ?? "";
    this._render();
  }

  public get value(): string {
    return this._value;
  }

  connectedCallback() {
    this.style.cssText = "display:block;width:100%";
    if (!this.shadowRoot) {
      this.attachShadow({ mode: "open" });
    }
    this._render();
  }

  protected _render() {
    if (!this.shadowRoot) return;
    this.shadowRoot.innerHTML = `
      <label style="display:block;font:inherit;color:var(--secondary-text-color);font-size:12px">
        ${this.label}
      </label>
      <input
        value="${escapeAttribute(this.value)}"
        placeholder="${escapeAttribute(this.label)}"
        style="box-sizing:border-box;width:100%;padding:8px;border:1px solid var(--divider-color);border-radius:4px;background:var(--card-background-color);color:var(--primary-text-color)"
      />
    `;
    this.shadowRoot.querySelector("input")?.addEventListener("input", (event) => {
      this.value = (event.target as HTMLInputElement).value;
      this.dispatchEvent(new Event("input", { bubbles: true }));
    });
  }
}

class HaSelectStub extends HTMLElement {
  private _label = "";
  private _value = "";
  private _options: Array<{ value: string; label: string }> = [];

  public set label(value: string) {
    this._label = value ?? "";
    this._render();
  }

  public get label(): string {
    return this._label;
  }

  public set value(value: string) {
    this._value = value ?? "";
    this._render();
  }

  public get value(): string {
    return this._value;
  }

  public set options(value: Array<{ value: string; label: string }>) {
    this._options = value ?? [];
    this._render();
  }

  public get options(): Array<{ value: string; label: string }> {
    return this._options;
  }

  connectedCallback() {
    this.style.cssText = "display:block;width:100%";
    if (!this.shadowRoot) {
      this.attachShadow({ mode: "open" });
    }
    this._render();
  }

  private _render() {
    if (!this.shadowRoot) return;
    const options = this._optionItems();
    this.shadowRoot.innerHTML = `
      <label style="display:block;font:inherit;color:var(--secondary-text-color);font-size:12px">
        ${this.label}
      </label>
      <select style="box-sizing:border-box;width:100%;padding:8px;border:1px solid var(--divider-color);border-radius:4px;background:var(--card-background-color);color:var(--primary-text-color)">
        ${options
          .map(
            (option) =>
              `<option value="${escapeAttribute(option.value)}" ${option.value === this.value ? "selected" : ""}>${escapeHtml(option.label)}</option>`,
          )
          .join("")}
      </select>
    `;
    this.shadowRoot.querySelector("select")?.addEventListener("change", (event) => {
      this.value = (event.target as HTMLSelectElement).value;
      this.dispatchEvent(new Event("selected", { bubbles: true }));
    });
  }

  private _optionItems(): Array<{ value: string; label: string }> {
    if (this.options.length > 0) return this.options;
    return Array.from(this.querySelectorAll("ha-list-item, mwc-list-item")).map((item) => ({
      value: (item as HaListItemStub).value || item.getAttribute("value") || "",
      label: item.textContent?.trim() || (item as HaListItemStub).value || "",
    }));
  }
}

class HaEntityPickerStub extends HaTextfieldStub {}

class HaListItemStub extends HTMLElement {
  public value = "";

  connectedCallback() {
    this.style.cssText = "display:block;padding:4px 8px";
  }
}

class MwcListItemStub extends HaListItemStub {}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function escapeAttribute(value: string): string {
  return escapeHtml(value).replaceAll("'", "&#39;");
}

function defineStub(tag: string, ctor: CustomElementConstructor) {
  if (!customElements.get(tag)) customElements.define(tag, ctor);
}

export function registerHaPreviewStubs() {
  defineStub("ha-icon", HaIconStub);
  defineStub("ha-card", HaCardStub);
  defineStub("ha-button", HaButtonStub);
  defineStub("ha-icon-button", HaIconButtonStub);
  defineStub("ha-checkbox", HaCheckboxStub);
  defineStub("ha-radio", HaRadioStub);
  defineStub("ha-switch", HaSwitchStub);
  defineStub("ha-textfield", HaTextfieldStub);
  defineStub("ha-select", HaSelectStub);
  defineStub("ha-entity-picker", HaEntityPickerStub);
  defineStub("ha-list-item", HaListItemStub);
  defineStub("mwc-list-item", MwcListItemStub);
}
