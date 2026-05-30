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

class HaCheckboxStub extends HTMLElement {
  public checked = false;

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
  }
}

class HaRadioStub extends HaCheckboxStub {}

class HaTextfieldStub extends HTMLElement {
  public value = "";

  connectedCallback() {
    this.style.cssText = "display:block;width:100%";
    if (!this.shadowRoot) {
      const root = this.attachShadow({ mode: "open" });
      root.innerHTML = `<input style="box-sizing:border-box;width:100%;padding:8px" />`;
      const input = root.querySelector("input");
      input?.addEventListener("input", (event) => {
        this.value = (event.target as HTMLInputElement).value;
        this.dispatchEvent(new Event("input", { bubbles: true }));
      });
    }
  }
}

class HaSelectStub extends HTMLElement {
  public value = "";
  public options: Array<{ value: string; label: string }> = [];

  connectedCallback() {
    this.style.cssText = "display:block;width:100%";
    if (!this.shadowRoot) {
      const root = this.attachShadow({ mode: "open" });
      root.innerHTML = `<select style="box-sizing:border-box;width:100%;padding:8px"></select>`;
    }
  }
}

class HaEntityPickerStub extends HaTextfieldStub {}

function defineStub(tag: string, ctor: CustomElementConstructor) {
  if (!customElements.get(tag)) customElements.define(tag, ctor);
}

export function registerHaPreviewStubs() {
  defineStub("ha-icon", HaIconStub);
  defineStub("ha-card", HaCardStub);
  defineStub("ha-button", HaButtonStub);
  defineStub("ha-icon-button", HaButtonStub);
  defineStub("ha-checkbox", HaCheckboxStub);
  defineStub("ha-radio", HaRadioStub);
  defineStub("ha-textfield", HaTextfieldStub);
  defineStub("ha-select", HaSelectStub);
  defineStub("ha-entity-picker", HaEntityPickerStub);
  defineStub("mwc-list-item", HTMLElement);
}
