(function(){var e=globalThis,t=e.ShadowRoot&&(e.ShadyCSS===void 0||e.ShadyCSS.nativeShadow)&&`adoptedStyleSheets`in Document.prototype&&`replace`in CSSStyleSheet.prototype,n=Symbol(),r=new WeakMap,i=class{constructor(e,t,r){if(this._$cssResult$=!0,r!==n)throw Error("CSSResult is not constructable. Use `unsafeCSS` or `css` instead.");this.cssText=e,this.t=t}get styleSheet(){let e=this.o,n=this.t;if(t&&e===void 0){let t=n!==void 0&&n.length===1;t&&(e=r.get(n)),e===void 0&&((this.o=e=new CSSStyleSheet).replaceSync(this.cssText),t&&r.set(n,e))}return e}toString(){return this.cssText}},a=e=>new i(typeof e==`string`?e:e+``,void 0,n),o=(e,...t)=>new i(e.length===1?e[0]:t.reduce((t,n,r)=>t+(e=>{if(!0===e._$cssResult$)return e.cssText;if(typeof e==`number`)return e;throw Error(`Value passed to 'css' function must be a 'css' function result: `+e+`. Use 'unsafeCSS' to pass non-literal values, but take care to ensure page security.`)})(n)+e[r+1],e[0]),e,n),s=(n,r)=>{if(t)n.adoptedStyleSheets=r.map(e=>e instanceof CSSStyleSheet?e:e.styleSheet);else for(let t of r){let r=document.createElement(`style`),i=e.litNonce;i!==void 0&&r.setAttribute(`nonce`,i),r.textContent=t.cssText,n.appendChild(r)}},c=t?e=>e:e=>e instanceof CSSStyleSheet?(e=>{let t=``;for(let n of e.cssRules)t+=n.cssText;return a(t)})(e):e,{is:l,defineProperty:u,getOwnPropertyDescriptor:d,getOwnPropertyNames:ee,getOwnPropertySymbols:te,getPrototypeOf:f}=Object,p=globalThis,ne=p.trustedTypes,re=ne?ne.emptyScript:``,ie=p.reactiveElementPolyfillSupport,m=(e,t)=>e,h={toAttribute(e,t){switch(t){case Boolean:e=e?re:null;break;case Object:case Array:e=e==null?e:JSON.stringify(e)}return e},fromAttribute(e,t){let n=e;switch(t){case Boolean:n=e!==null;break;case Number:n=e===null?null:Number(e);break;case Object:case Array:try{n=JSON.parse(e)}catch{n=null}}return n}},g=(e,t)=>!l(e,t),_={attribute:!0,type:String,converter:h,reflect:!1,useDefault:!1,hasChanged:g};Symbol.metadata??=Symbol(`metadata`),p.litPropertyMetadata??=new WeakMap;var v=class extends HTMLElement{static addInitializer(e){this._$Ei(),(this.l??=[]).push(e)}static get observedAttributes(){return this.finalize(),this._$Eh&&[...this._$Eh.keys()]}static createProperty(e,t=_){if(t.state&&(t.attribute=!1),this._$Ei(),this.prototype.hasOwnProperty(e)&&((t=Object.create(t)).wrapped=!0),this.elementProperties.set(e,t),!t.noAccessor){let n=Symbol(),r=this.getPropertyDescriptor(e,n,t);r!==void 0&&u(this.prototype,e,r)}}static getPropertyDescriptor(e,t,n){let{get:r,set:i}=d(this.prototype,e)??{get(){return this[t]},set(e){this[t]=e}};return{get:r,set(t){let a=r?.call(this);i?.call(this,t),this.requestUpdate(e,a,n)},configurable:!0,enumerable:!0}}static getPropertyOptions(e){return this.elementProperties.get(e)??_}static _$Ei(){if(this.hasOwnProperty(m(`elementProperties`)))return;let e=f(this);e.finalize(),e.l!==void 0&&(this.l=[...e.l]),this.elementProperties=new Map(e.elementProperties)}static finalize(){if(this.hasOwnProperty(m(`finalized`)))return;if(this.finalized=!0,this._$Ei(),this.hasOwnProperty(m(`properties`))){let e=this.properties,t=[...ee(e),...te(e)];for(let n of t)this.createProperty(n,e[n])}let e=this[Symbol.metadata];if(e!==null){let t=litPropertyMetadata.get(e);if(t!==void 0)for(let[e,n]of t)this.elementProperties.set(e,n)}this._$Eh=new Map;for(let[e,t]of this.elementProperties){let n=this._$Eu(e,t);n!==void 0&&this._$Eh.set(n,e)}this.elementStyles=this.finalizeStyles(this.styles)}static finalizeStyles(e){let t=[];if(Array.isArray(e)){let n=new Set(e.flat(1/0).reverse());for(let e of n)t.unshift(c(e))}else e!==void 0&&t.push(c(e));return t}static _$Eu(e,t){let n=t.attribute;return!1===n?void 0:typeof n==`string`?n:typeof e==`string`?e.toLowerCase():void 0}constructor(){super(),this._$Ep=void 0,this.isUpdatePending=!1,this.hasUpdated=!1,this._$Em=null,this._$Ev()}_$Ev(){this._$ES=new Promise(e=>this.enableUpdating=e),this._$AL=new Map,this._$E_(),this.requestUpdate(),this.constructor.l?.forEach(e=>e(this))}addController(e){(this._$EO??=new Set).add(e),this.renderRoot!==void 0&&this.isConnected&&e.hostConnected?.()}removeController(e){this._$EO?.delete(e)}_$E_(){let e=new Map,t=this.constructor.elementProperties;for(let n of t.keys())this.hasOwnProperty(n)&&(e.set(n,this[n]),delete this[n]);e.size>0&&(this._$Ep=e)}createRenderRoot(){let e=this.shadowRoot??this.attachShadow(this.constructor.shadowRootOptions);return s(e,this.constructor.elementStyles),e}connectedCallback(){this.renderRoot??=this.createRenderRoot(),this.enableUpdating(!0),this._$EO?.forEach(e=>e.hostConnected?.())}enableUpdating(e){}disconnectedCallback(){this._$EO?.forEach(e=>e.hostDisconnected?.())}attributeChangedCallback(e,t,n){this._$AK(e,n)}_$ET(e,t){let n=this.constructor.elementProperties.get(e),r=this.constructor._$Eu(e,n);if(r!==void 0&&!0===n.reflect){let i=(n.converter?.toAttribute===void 0?h:n.converter).toAttribute(t,n.type);this._$Em=e,i==null?this.removeAttribute(r):this.setAttribute(r,i),this._$Em=null}}_$AK(e,t){let n=this.constructor,r=n._$Eh.get(e);if(r!==void 0&&this._$Em!==r){let e=n.getPropertyOptions(r),i=typeof e.converter==`function`?{fromAttribute:e.converter}:e.converter?.fromAttribute===void 0?h:e.converter;this._$Em=r;let a=i.fromAttribute(t,e.type);this[r]=a??this._$Ej?.get(r)??a,this._$Em=null}}requestUpdate(e,t,n,r=!1,i){if(e!==void 0){let a=this.constructor;if(!1===r&&(i=this[e]),n??=a.getPropertyOptions(e),!((n.hasChanged??g)(i,t)||n.useDefault&&n.reflect&&i===this._$Ej?.get(e)&&!this.hasAttribute(a._$Eu(e,n))))return;this.C(e,t,n)}!1===this.isUpdatePending&&(this._$ES=this._$EP())}C(e,t,{useDefault:n,reflect:r,wrapped:i},a){n&&!(this._$Ej??=new Map).has(e)&&(this._$Ej.set(e,a??t??this[e]),!0!==i||a!==void 0)||(this._$AL.has(e)||(this.hasUpdated||n||(t=void 0),this._$AL.set(e,t)),!0===r&&this._$Em!==e&&(this._$Eq??=new Set).add(e))}async _$EP(){this.isUpdatePending=!0;try{await this._$ES}catch(e){Promise.reject(e)}let e=this.scheduleUpdate();return e!=null&&await e,!this.isUpdatePending}scheduleUpdate(){return this.performUpdate()}performUpdate(){if(!this.isUpdatePending)return;if(!this.hasUpdated){if(this.renderRoot??=this.createRenderRoot(),this._$Ep){for(let[e,t]of this._$Ep)this[e]=t;this._$Ep=void 0}let e=this.constructor.elementProperties;if(e.size>0)for(let[t,n]of e){let{wrapped:e}=n,r=this[t];!0!==e||this._$AL.has(t)||r===void 0||this.C(t,void 0,n,r)}}let e=!1,t=this._$AL;try{e=this.shouldUpdate(t),e?(this.willUpdate(t),this._$EO?.forEach(e=>e.hostUpdate?.()),this.update(t)):this._$EM()}catch(t){throw e=!1,this._$EM(),t}e&&this._$AE(t)}willUpdate(e){}_$AE(e){this._$EO?.forEach(e=>e.hostUpdated?.()),this.hasUpdated||(this.hasUpdated=!0,this.firstUpdated(e)),this.updated(e)}_$EM(){this._$AL=new Map,this.isUpdatePending=!1}get updateComplete(){return this.getUpdateComplete()}getUpdateComplete(){return this._$ES}shouldUpdate(e){return!0}update(e){this._$Eq&&=this._$Eq.forEach(e=>this._$ET(e,this[e])),this._$EM()}updated(e){}firstUpdated(e){}};v.elementStyles=[],v.shadowRootOptions={mode:`open`},v[m(`elementProperties`)]=new Map,v[m(`finalized`)]=new Map,ie?.({ReactiveElement:v}),(p.reactiveElementVersions??=[]).push(`2.1.2`);var y=globalThis,ae=e=>e,b=y.trustedTypes,x=b?b.createPolicy(`lit-html`,{createHTML:e=>e}):void 0,S=`$lit$`,C=`lit$${Math.random().toFixed(9).slice(2)}$`,oe=`?`+C,se=`<${oe}>`,w=document,T=()=>w.createComment(``),E=e=>e===null||typeof e!=`object`&&typeof e!=`function`,D=Array.isArray,ce=e=>D(e)||typeof e?.[Symbol.iterator]==`function`,O=`[ 	
\f\r]`,k=/<(?:(!--|\/[^a-zA-Z])|(\/?[a-zA-Z][^>\s]*)|(\/?$))/g,le=/-->/g,ue=/>/g,A=RegExp(`>|${O}(?:([^\\s"'>=/]+)(${O}*=${O}*(?:[^ \t\n\f\r"'\`<>=]|("|')|))|$)`,`g`),j=/'/g,de=/"/g,M=/^(?:script|style|textarea|title)$/i,N=(e=>(t,...n)=>({_$litType$:e,strings:t,values:n}))(1),P=Symbol.for(`lit-noChange`),F=Symbol.for(`lit-nothing`),fe=new WeakMap,I=w.createTreeWalker(w,129);function L(e,t){if(!D(e)||!e.hasOwnProperty(`raw`))throw Error(`invalid template strings array`);return x===void 0?t:x.createHTML(t)}var pe=(e,t)=>{let n=e.length-1,r=[],i,a=t===2?`<svg>`:t===3?`<math>`:``,o=k;for(let t=0;t<n;t++){let n=e[t],s,c,l=-1,u=0;for(;u<n.length&&(o.lastIndex=u,c=o.exec(n),c!==null);)u=o.lastIndex,o===k?c[1]===`!--`?o=le:c[1]===void 0?c[2]===void 0?c[3]!==void 0&&(o=A):(M.test(c[2])&&(i=RegExp(`</`+c[2],`g`)),o=A):o=ue:o===A?c[0]===`>`?(o=i??k,l=-1):c[1]===void 0?l=-2:(l=o.lastIndex-c[2].length,s=c[1],o=c[3]===void 0?A:c[3]===`"`?de:j):o===de||o===j?o=A:o===le||o===ue?o=k:(o=A,i=void 0);let d=o===A&&e[t+1].startsWith(`/>`)?` `:``;a+=o===k?n+se:l>=0?(r.push(s),n.slice(0,l)+S+n.slice(l)+C+d):n+C+(l===-2?t:d)}return[L(e,a+(e[n]||`<?>`)+(t===2?`</svg>`:t===3?`</math>`:``)),r]},R=class e{constructor({strings:t,_$litType$:n},r){let i;this.parts=[];let a=0,o=0,s=t.length-1,c=this.parts,[l,u]=pe(t,n);if(this.el=e.createElement(l,r),I.currentNode=this.el.content,n===2||n===3){let e=this.el.content.firstChild;e.replaceWith(...e.childNodes)}for(;(i=I.nextNode())!==null&&c.length<s;){if(i.nodeType===1){if(i.hasAttributes())for(let e of i.getAttributeNames())if(e.endsWith(S)){let t=u[o++],n=i.getAttribute(e).split(C),r=/([.?@])?(.*)/.exec(t);c.push({type:1,index:a,name:r[2],strings:n,ctor:r[1]===`.`?he:r[1]===`?`?ge:r[1]===`@`?_e:V}),i.removeAttribute(e)}else e.startsWith(C)&&(c.push({type:6,index:a}),i.removeAttribute(e));if(M.test(i.tagName)){let e=i.textContent.split(C),t=e.length-1;if(t>0){i.textContent=b?b.emptyScript:``;for(let n=0;n<t;n++)i.append(e[n],T()),I.nextNode(),c.push({type:2,index:++a});i.append(e[t],T())}}}else if(i.nodeType===8){if(i.data===oe)c.push({type:2,index:a});else{let e=-1;for(;(e=i.data.indexOf(C,e+1))!==-1;)c.push({type:7,index:a}),e+=C.length-1}}a++}}static createElement(e,t){let n=w.createElement(`template`);return n.innerHTML=e,n}};function z(e,t,n=e,r){if(t===P)return t;let i=r===void 0?n._$Cl:n._$Co?.[r],a=E(t)?void 0:t._$litDirective$;return i?.constructor!==a&&(i?._$AO?.(!1),a===void 0?i=void 0:(i=new a(e),i._$AT(e,n,r)),r===void 0?n._$Cl=i:(n._$Co??=[])[r]=i),i!==void 0&&(t=z(e,i._$AS(e,t.values),i,r)),t}var me=class{constructor(e,t){this._$AV=[],this._$AN=void 0,this._$AD=e,this._$AM=t}get parentNode(){return this._$AM.parentNode}get _$AU(){return this._$AM._$AU}u(e){let{el:{content:t},parts:n}=this._$AD,r=(e?.creationScope??w).importNode(t,!0);I.currentNode=r;let i=I.nextNode(),a=0,o=0,s=n[0];for(;s!==void 0;){if(a===s.index){let t;s.type===2?t=new B(i,i.nextSibling,this,e):s.type===1?t=new s.ctor(i,s.name,s.strings,this,e):s.type===6&&(t=new ve(i,this,e)),this._$AV.push(t),s=n[++o]}a!==s?.index&&(i=I.nextNode(),a++)}return I.currentNode=w,r}p(e){let t=0;for(let n of this._$AV)n!==void 0&&(n.strings===void 0?n._$AI(e[t]):(n._$AI(e,n,t),t+=n.strings.length-2)),t++}},B=class e{get _$AU(){return this._$AM?._$AU??this._$Cv}constructor(e,t,n,r){this.type=2,this._$AH=F,this._$AN=void 0,this._$AA=e,this._$AB=t,this._$AM=n,this.options=r,this._$Cv=r?.isConnected??!0}get parentNode(){let e=this._$AA.parentNode,t=this._$AM;return t!==void 0&&e?.nodeType===11&&(e=t.parentNode),e}get startNode(){return this._$AA}get endNode(){return this._$AB}_$AI(e,t=this){e=z(this,e,t),E(e)?e===F||e==null||e===``?(this._$AH!==F&&this._$AR(),this._$AH=F):e!==this._$AH&&e!==P&&this._(e):e._$litType$===void 0?e.nodeType===void 0?ce(e)?this.k(e):this._(e):this.T(e):this.$(e)}O(e){return this._$AA.parentNode.insertBefore(e,this._$AB)}T(e){this._$AH!==e&&(this._$AR(),this._$AH=this.O(e))}_(e){this._$AH!==F&&E(this._$AH)?this._$AA.nextSibling.data=e:this.T(w.createTextNode(e)),this._$AH=e}$(e){let{values:t,_$litType$:n}=e,r=typeof n==`number`?this._$AC(e):(n.el===void 0&&(n.el=R.createElement(L(n.h,n.h[0]),this.options)),n);if(this._$AH?._$AD===r)this._$AH.p(t);else{let e=new me(r,this),n=e.u(this.options);e.p(t),this.T(n),this._$AH=e}}_$AC(e){let t=fe.get(e.strings);return t===void 0&&fe.set(e.strings,t=new R(e)),t}k(t){D(this._$AH)||(this._$AH=[],this._$AR());let n=this._$AH,r,i=0;for(let a of t)i===n.length?n.push(r=new e(this.O(T()),this.O(T()),this,this.options)):r=n[i],r._$AI(a),i++;i<n.length&&(this._$AR(r&&r._$AB.nextSibling,i),n.length=i)}_$AR(e=this._$AA.nextSibling,t){for(this._$AP?.(!1,!0,t);e!==this._$AB;){let t=ae(e).nextSibling;ae(e).remove(),e=t}}setConnected(e){this._$AM===void 0&&(this._$Cv=e,this._$AP?.(e))}},V=class{get tagName(){return this.element.tagName}get _$AU(){return this._$AM._$AU}constructor(e,t,n,r,i){this.type=1,this._$AH=F,this._$AN=void 0,this.element=e,this.name=t,this._$AM=r,this.options=i,n.length>2||n[0]!==``||n[1]!==``?(this._$AH=Array(n.length-1).fill(new String),this.strings=n):this._$AH=F}_$AI(e,t=this,n,r){let i=this.strings,a=!1;if(i===void 0)e=z(this,e,t,0),a=!E(e)||e!==this._$AH&&e!==P,a&&(this._$AH=e);else{let r=e,o,s;for(e=i[0],o=0;o<i.length-1;o++)s=z(this,r[n+o],t,o),s===P&&(s=this._$AH[o]),a||=!E(s)||s!==this._$AH[o],s===F?e=F:e!==F&&(e+=(s??``)+i[o+1]),this._$AH[o]=s}a&&!r&&this.j(e)}j(e){e===F?this.element.removeAttribute(this.name):this.element.setAttribute(this.name,e??``)}},he=class extends V{constructor(){super(...arguments),this.type=3}j(e){this.element[this.name]=e===F?void 0:e}},ge=class extends V{constructor(){super(...arguments),this.type=4}j(e){this.element.toggleAttribute(this.name,!!e&&e!==F)}},_e=class extends V{constructor(e,t,n,r,i){super(e,t,n,r,i),this.type=5}_$AI(e,t=this){if((e=z(this,e,t,0)??F)===P)return;let n=this._$AH,r=e===F&&n!==F||e.capture!==n.capture||e.once!==n.once||e.passive!==n.passive,i=e!==F&&(n===F||r);r&&this.element.removeEventListener(this.name,this,n),i&&this.element.addEventListener(this.name,this,e),this._$AH=e}handleEvent(e){typeof this._$AH==`function`?this._$AH.call(this.options?.host??this.element,e):this._$AH.handleEvent(e)}},ve=class{constructor(e,t,n){this.element=e,this.type=6,this._$AN=void 0,this._$AM=t,this.options=n}get _$AU(){return this._$AM._$AU}_$AI(e){z(this,e)}},ye=y.litHtmlPolyfillSupport;ye?.(R,B),(y.litHtmlVersions??=[]).push(`3.3.3`);var be=(e,t,n)=>{let r=n?.renderBefore??t,i=r._$litPart$;if(i===void 0){let e=n?.renderBefore??null;r._$litPart$=i=new B(t.insertBefore(T(),e),e,void 0,n??{})}return i._$AI(e),i},H=globalThis,U=class extends v{constructor(){super(...arguments),this.renderOptions={host:this},this._$Do=void 0}createRenderRoot(){let e=super.createRenderRoot();return this.renderOptions.renderBefore??=e.firstChild,e}update(e){let t=this.render();this.hasUpdated||(this.renderOptions.isConnected=this.isConnected),super.update(e),this._$Do=be(t,this.renderRoot,this.renderOptions)}connectedCallback(){super.connectedCallback(),this._$Do?.setConnected(!0)}disconnectedCallback(){super.disconnectedCallback(),this._$Do?.setConnected(!1)}render(){return P}};U._$litElement$=!0,U.finalized=!0,H.litElementHydrateSupport?.({LitElement:U});var xe=H.litElementPolyfillSupport;xe?.({LitElement:U}),(H.litElementVersions??=[]).push(`4.2.2`);var Se=e=>(t,n)=>{n===void 0?customElements.define(e,t):n.addInitializer(()=>{customElements.define(e,t)})},Ce={attribute:!0,type:String,converter:h,reflect:!1,hasChanged:g},we=(e=Ce,t,n)=>{let{kind:r,metadata:i}=n,a=globalThis.litPropertyMetadata.get(i);if(a===void 0&&globalThis.litPropertyMetadata.set(i,a=new Map),r===`setter`&&((e=Object.create(e)).wrapped=!0),a.set(n.name,e),r===`accessor`){let{name:r}=n;return{set(n){let i=t.get.call(this);t.set.call(this,n),this.requestUpdate(r,i,e,!0,n)},init(t){return t!==void 0&&this.C(r,void 0,e,t),t}}}if(r===`setter`){let{name:r}=n;return function(n){let i=this[r];t.call(this,n),this.requestUpdate(r,i,e,!0,n)}}throw Error(`Unsupported decorator location: `+r)};function W(e){return(t,n)=>typeof n==`object`?we(e,t,n):((e,t,n)=>{let r=t.hasOwnProperty(n);return t.constructor.createProperty(n,e),r?Object.getOwnPropertyDescriptor(t,n):void 0})(e,t,n)}function G(e){return W({...e,state:!0,attribute:!1})}var Te={"hero.dispatch_failed":`Device command failed`,"panel.loading":`Loading...`,"room.control_mode.full_control":`Full Control`,"room.control_mode.managed":`Managed`,"room.control_mode.external_sensor":`External sensor: {sensor}`,"room.control_mode.no_sensor":`No external temperature sensor assigned`,"room.control_mode.mpc_active":`MPC active`,"room.control_mode.mpc_learning":`Learning`,"room.control_mode.device_setpoint":`Device setpoint: {temp}`,"room.control_mode.power":`Power: {power}%`,"room.control_mode.full_control_info":`RoomMind has full control over your climate devices. An external temperature sensor provides the actual room temperature, enabling proportional setpoint calculation. The device setpoint is dynamically adjusted based on MPC power output. The thermal model (EKF) learns your room's behavior for optimal comfort and energy efficiency.`,"room.control_mode.managed_info":`RoomMind sets the target temperature on your device (from schedule, override, or vacation settings), but the device self-regulates using its own internal sensor. No proportional boost, no thermal model learning, and no MPC optimization. For more precise control, assign an external temperature sensor in the Devices section.`,"hero.target":`Room comfort target`,"hero.target_perceived":`Based on feels-like temperature`,"hero.override":`Override`,"hero.remaining":`{time} remaining`,"hero.humidity":`{value}% humidity`,"hero.device_setpoint":`Planned device setpoint: {value}{unit}`,"hero.heat_source_primary":`Heating: TRV`,"hero.heat_source_secondary":`Heating: AC`,"hero.heat_source_both":`Heating: TRV + AC`,"hero.permanent":`Permanent`,"hero.waiting":`Waiting for sensor data...`,"hero.not_configured":`Not configured yet`,"hero.mpc_learning_paused":`MPC learning paused`,"hero.mpc_learning_paused.outdoor_unavailable":`RoomMind needs an outdoor temperature to learn this room's thermal model. The configured outdoor sensor is unavailable and no weather entity is set as a fallback. Configure either in Settings.`,"mode.auto":`Auto`,"mode.auto_desc":`Heats & cools automatically based on target temperature`,"mode.heat_only":`Heat`,"mode.heat_only_desc":`Heats using thermostats or heat-pump ACs`,"mode.cool_only":`Cool`,"mode.cool_only_desc":`Cools using air conditioners`,"mode.dry":`Dry`,"mode.dry_desc":`Dehumidifies using air conditioners without temperature chasing`,"mode.fan_only_desc":`Circulates air using air conditioner fans only`,"mode.off":`Off`,"mode.off_desc":`Turns off all climate devices in this room`,"mode.heating":`Heating`,"mode.cooling":`Cooling`,"mode.fan_only":`Fan`,"mode.idle":`Standby`,"hero.window_open":`Window open – paused`,"hero.perceived_temp":`Feels like {value}{unit}`,"hero.night_mode_active":`Night mode active`,"hero.rapid_recovery_active":`Rapid recovery active`,"hero.output_unknown":`Awaiting feedback`,"hero.output_unknown_hint":`Waiting for the device to report its current state.`,"hero.mode_only_hint":`Device confirmed its operating mode, but this model does not report live compressor activity.`,"hero.device_offline":`Offline`,"hero.device_offline_hint":`Climate device is currently unavailable in Home Assistant.`,"hero.assumed_state":`One-way (IR)`,"hero.assumed_state_hint":`This device uses assumed state and cannot report back its actual mode.`,"hero.output_conflict":`Mode conflict`,"hero.output_conflict_hint":`Devices in this room report opposing heating and cooling modes.`,"mode.heating_mode":`Heat mode`,"mode.cooling_mode":`Cool mode`,"mode.auto_mode":`Auto mode`,"hero.control_request":`Requested: {mode} · {power}%`,"hero.dispatch_deferred":`Adjustment waiting`,"room.control_mode.monitor_only":`Climate Monitor`,"room.control_mode.monitor_only_info":`This room has no climate control devices, so RoomMind passively tracks its temperature, humidity, dew point, and comfort alerts without sending control commands.`,"hero.regime.recovery":`Recovery`,"hero.regime.approach":`Approach`,"hero.regime.cruise":`Cruise`,"hero.regime.coast":`Coast`,"hero.thermal_load_hint":`Estimated thermal load: {pct}%`,"hero.coil_dry":`Drying ({time})`,"hero.coil_dry_drain":`Draining ({time})`,"hero.coil_dry_info":`The AC is drying its evaporator and switches off afterwards. If the room needs cooling, it stops at once.`,"hero.occupancy_vacant":`Vacant (Eco)`,"hero.occupancy_vacant_info":`No occupancy detected for the configured delay; targets are capped to Eco.`,"hero.preheat":`Pre-conditioning ({temp})`,"hero.preheat_info":`Adjusting ahead of the next scheduled setpoint change.`,"hero.air_quality_bad":`Poor air ({reason})`,"hero.ventilation_active":`Ventilating`,"hero.price_shift":`Price shift ({level})`,"roomcard.select_room":`Select RoomMind room`,"roomcard.clear_override":`Reset`},Ee={"hero.dispatch_failed":`Gerätebefehl fehlgeschlagen`,"panel.loading":`Laden...`,"room.control_mode.full_control":`Full Control`,"room.control_mode.managed":`Managed`,"room.control_mode.external_sensor":`Externer Sensor: {sensor}`,"room.control_mode.no_sensor":`Kein externer Temperatursensor zugewiesen`,"room.control_mode.mpc_active":`MPC aktiv`,"room.control_mode.mpc_learning":`Lernphase`,"room.control_mode.device_setpoint":`Geräte-Setpoint: {temp}`,"room.control_mode.power":`Leistung: {power}%`,"room.control_mode.full_control_info":`RoomMind hat volle Kontrolle über deine Klimageräte. Ein externer Temperatursensor liefert die tatsächliche Raumtemperatur, was eine proportionale Setpoint-Berechnung ermöglicht. Der Geräte-Setpoint wird dynamisch basierend auf der MPC-Leistung angepasst. Das thermische Modell (EKF) lernt das Verhalten deines Raums für optimalen Komfort und Energieeffizienz.`,"room.control_mode.managed_info":`RoomMind setzt die Zieltemperatur auf deinem Gerät (aus Zeitplan, Override oder Urlaubsmodus), aber das Gerät regelt selbstständig mit seinem internen Sensor. Kein proportionaler Boost, kein thermisches Modell-Lernen und keine MPC-Optimierung. Für präzisere Steuerung einen externen Temperatursensor in der Geräte-Sektion zuweisen.`,"hero.target":`Komfortziel des Raums`,"hero.target_perceived":`Bezieht sich auf die gefühlte Temperatur`,"hero.override":`Override`,"hero.remaining":`noch {time}`,"hero.humidity":`{value}% Luftfeuchtigkeit`,"hero.device_setpoint":`Geplanter Geräte-Sollwert: {value}{unit}`,"hero.heat_source_primary":`Heizung: TRV`,"hero.heat_source_secondary":`Heizung: AC`,"hero.heat_source_both":`Heizung: TRV + AC`,"hero.permanent":`Dauerhaft`,"hero.waiting":`Warte auf Sensordaten...`,"hero.not_configured":`Noch nicht konfiguriert`,"hero.mpc_learning_paused":`MPC-Lernen pausiert`,"hero.mpc_learning_paused.outdoor_unavailable":`RoomMind benötigt eine Außentemperatur, um das thermische Modell dieses Raums zu lernen. Der konfigurierte Außensensor ist nicht verfügbar und es ist keine Wetter-Entity als Fallback gesetzt. Konfiguriere eine der beiden in den Einstellungen.`,"mode.auto":`Auto`,"mode.auto_desc":`Heizt und kühlt automatisch basierend auf der Zieltemperatur`,"mode.heat_only":`Heizen`,"mode.heat_only_desc":`Heizt mit Thermostaten oder Wärmepumpen-Klimaanlagen`,"mode.cool_only":`Kühlen`,"mode.cool_only_desc":`Kühlt mit Klimaanlagen`,"mode.dry":`Entfeuchten`,"mode.dry_desc":`Entfeuchtet über Klimaanlagen ohne Zieltemperatur-Nachführung`,"mode.fan_only_desc":`Nur Luftzirkulation über Klimaanlagen-Lüfter`,"mode.off":`Aus`,"mode.off_desc":`Schaltet alle Klimageräte in diesem Raum aus`,"mode.heating":`Heizen`,"mode.cooling":`Kühlen`,"mode.fan_only":`Lüfter`,"mode.idle":`Standby`,"hero.window_open":`Fenster offen – pausiert`,"hero.perceived_temp":`Gefühlt {value}{unit}`,"hero.night_mode_active":`Nachtmodus aktiv`,"hero.rapid_recovery_active":`Schnelles Aufholen aktiv`,"hero.output_unknown":`Wartet auf Rückmeldung`,"hero.output_unknown_hint":`Wartet auf die aktuelle Zustandsmeldung des Geräts.`,"hero.mode_only_hint":`Gerät hat den Betriebsmodus bestätigt, meldet aber keine Live-Kompressoraktivität.`,"hero.device_offline":`Offline`,"hero.device_offline_hint":`Klimagerät ist derzeit in Home Assistant nicht erreichbar.`,"hero.assumed_state":`Ohne Rückmeldung`,"hero.assumed_state_hint":`Dieses Gerät nutzt angenommenen Zustand ohne Rückmeldung.`,"hero.output_conflict":`Moduskonflikt`,"hero.output_conflict_hint":`Geräte in diesem Raum melden gegensätzliche Heiz- und Kühlmodi.`,"mode.heating_mode":`Heizmodus`,"mode.cooling_mode":`Kühlmodus`,"mode.auto_mode":`Automatik`,"hero.control_request":`Angefordert: {mode} · {power}%`,"hero.dispatch_deferred":`Anpassung wartet`,"room.control_mode.monitor_only":`Klima-Monitor`,"room.control_mode.monitor_only_info":`Dieser Raum hat keine aktiven Klimageräte. RoomMind überwacht passiv Temperatur, Luftfeuchte, Taupunkt und Komfortwerte ohne Regelbefehle zu senden.`,"hero.regime.recovery":`Aufholen`,"hero.regime.approach":`Annäherung`,"hero.regime.cruise":`Teillast`,"hero.regime.coast":`Ausrollen`,"hero.thermal_load_hint":`Geschätzte Wärmelast: {pct}%`,"hero.coil_dry":`Trocknet ({time})`,"hero.coil_dry_drain":`Abtropfen ({time})`,"hero.coil_dry_info":`Die Klimaanlage trocknet ihren Verdampfer und schaltet danach ab. Bei Kühlbedarf stoppt die Trocknung sofort.`,"hero.occupancy_vacant":`Unbewohnt (Eco)`,"hero.occupancy_vacant_info":`Seit der eingestellten Verzögerung keine Präsenz erkannt; Zielwerte auf Eco begrenzt.`,"hero.preheat":`Vorklimatisierung ({temp})`,"hero.preheat_info":`Passt die Temperatur vor dem nächsten Zeitplanwechsel vorab an.`,"hero.air_quality_bad":`Schlechte Luft ({reason})`,"hero.ventilation_active":`Lüftung aktiv`,"hero.price_shift":`Preisverschiebung ({level})`,"roomcard.select_room":`RoomMind-Raum wählen`,"roomcard.clear_override":`Zurücksetzen`},De={"hero.dispatch_failed":`设备指令下发失败`,"panel.loading":`正在加载...`,"room.control_mode.full_control":`完全控制`,"room.control_mode.managed":`协同管理`,"room.control_mode.external_sensor":`外部传感器: {sensor}`,"room.control_mode.no_sensor":`未分配外部温度传感器`,"room.control_mode.mpc_active":`MPC 已启用`,"room.control_mode.mpc_learning":`学习中`,"room.control_mode.device_setpoint":`设备设定值: {temp}`,"room.control_mode.power":`功率: {power}%`,"room.control_mode.full_control_info":`RoomMind 对您的温控设备拥有完全控制权。外部温度传感器提供房间的实际温度，从而实现比例设定值计算。设备设定值根据 MPC 功率输出进行动态调整。热学模型 (EKF) 会自动学习您的房间特性，以实现最佳的舒适度与能源效率。`,"room.control_mode.managed_info":`RoomMind 在您的设备上设置目标温度（来自日程安排、临时覆盖或度假设置），但设备会使用其内部传感器进行自我调节。没有比例提升，没有热学模型 learning，也没有 MPC 优化。如需更精准的控制，请在“设备”部分分配一个外部温度传感器。`,"hero.target":`房间舒适目标`,"hero.target_perceived":`以体感温度为控制依据`,"hero.override":`临时覆盖`,"hero.remaining":`剩余 {time}`,"hero.humidity":`湿度 {value}%`,"hero.device_setpoint":`设备计划设定：{value}{unit}`,"hero.heat_source_primary":`供暖设备：散热器恒温阀`,"hero.heat_source_secondary":`供暖设备：空调`,"hero.heat_source_both":`供暖设备：暖气阀 + 空调`,"hero.permanent":`永久`,"hero.waiting":`正在等待传感器数据...`,"hero.not_configured":`尚未配置`,"hero.mpc_learning_paused":`MPC 学习已暂停`,"hero.mpc_learning_paused.outdoor_unavailable":`RoomMind 需要室外温度来学习该房间的热学模型。配置的室外传感器目前不可用，且未设置备用天气实体。请在“设置”中配置其中之一。`,"mode.auto":`自动`,"mode.auto_desc":`根据目标温度自动进行制热与制冷`,"mode.heat_only":`制热`,"mode.heat_only_desc":`使用暖气或热泵空调制热`,"mode.cool_only":`制冷`,"mode.cool_only_desc":`使用空调制冷`,"mode.dry":`除湿`,"mode.dry_desc":`使用空调除湿而不追逐温度目标`,"mode.fan_only_desc":`仅开启空调送风循环空气`,"mode.off":`关闭`,"mode.off_desc":`关闭本房间所有温控设备`,"mode.heating":`制热中`,"mode.cooling":`制冷中`,"mode.fan_only":`送风`,"mode.idle":`待机`,"hero.window_open":`窗户已打开 – 暂停温控`,"hero.perceived_temp":`体感 {value}{unit}`,"hero.night_mode_active":`夜间模式已启用`,"hero.rapid_recovery_active":`快速追温中`,"hero.output_unknown":`等待设备反馈`,"hero.output_unknown_hint":`正在等待设备上报当前状态。`,"hero.mode_only_hint":`设备已确认当前运行模式，但该机型不上报压缩机实时启停状态。`,"hero.device_offline":`设备离线`,"hero.device_offline_hint":`空调或温控设备当前在 Home Assistant 中不可用。`,"hero.assumed_state":`单向控制`,"hero.assumed_state_hint":`该设备为单向推测状态，无法回传真实运行模式。`,"hero.output_conflict":`模式冲突`,"hero.output_conflict_hint":`房间内多个设备同时上报了制热与制冷冲突模式。`,"mode.heating_mode":`制热模式`,"mode.cooling_mode":`制冷模式`,"mode.auto_mode":`自动模式`,"hero.control_request":`控制请求：{mode} · {power}%`,"hero.dispatch_deferred":`调节等待中`,"room.control_mode.monitor_only":`环境监测`,"room.control_mode.monitor_only_info":`该房间未配置主动温控设备，RoomMind 会持续采集并融合温湿度、露点与舒适度状态，不下发温控指令。`,"hero.regime.recovery":`强力恢复`,"hero.regime.approach":`逼近设定`,"hero.regime.cruise":`低频巡航`,"hero.regime.coast":`滑行停机`,"hero.thermal_load_hint":`估算热负荷：{pct}%`,"hero.coil_dry":`吹干中 ({time})`,"hero.coil_dry_drain":`沥水中 ({time})`,"hero.coil_dry_info":`空调正在吹干蒸发器，完成后自动关闭。若房间需要制冷将立即停止干燥。`,"hero.occupancy_vacant":`无人 (节能)`,"hero.occupancy_vacant_info":`超过延迟时间未检测到人员，目标温度已限制为节能值。`,"hero.preheat":`提前预调节 ({temp})`,"hero.preheat_info":`正在为下一个日程切换提前进行温度调节。`,"hero.air_quality_bad":`空气不佳 ({reason})`,"hero.ventilation_active":`正在通风换气`,"hero.price_shift":`峰谷电价偏移 ({level})`,"roomcard.select_room":`选择 RoomMind 房间`,"roomcard.clear_override":`恢复`},Oe={en:Te,de:Ee,"zh-Hans":De,zh:De},ke=Te;function K(e,t,n){let r=t.split(`-`)[0]??`en`,i=(Oe[t]??Oe[r]??ke)[e]??ke[e]??e;if(n)for(let[e,t]of Object.entries(n))i=i.replaceAll(`{${e}}`,String(t));return i}function Ae(e){return!e||e.observation_status===`unknown`?null:e.observed_mode===void 0?e.mode:e.observed_mode}function je(e,t){if(!e)return null;let n=Ae(e);if(n===`heating`||n===`cooling`)return n;let r=(e.device_observations??[]).find(e=>e.available&&!e.assumed_state&&(e.hvac_mode===`dry`||e.hvac_mode===`fan_only`));return r?.hvac_mode===`dry`?`dry`:r?.hvac_mode===`fan_only`?`fan_only`:e.commanded_mode===`dry`?`dry`:e.commanded_mode===`fan_only`?`fan_only`:t?.climate_mode===`off`&&(e.commanded_mode??`idle`)===`idle`?`off`:n}function Me(e){switch(e){case`heating`:return`mode-heating`;case`cooling`:return`mode-cooling`;case`dry`:return`mode-dry`;case`fan_only`:return`mode-fan`;case`off`:return`mode-off`;case`idle`:return`mode-idle`;default:return`mode-other`}}var Ne={heating:`mode.heating`,cooling:`mode.cooling`,dry:`mode.dry`,fan_only:`mode.fan_only`,off:`mode.off`,idle:`mode.idle`};function Pe(e,t){let n=je(e,t);if(n!==null)return{mode:n,source:`observed`,labelKey:Ne[n]};let r=e?.device_observations??[],i=r.filter(e=>e.available&&!e.assumed_state&&!!e.hvac_mode);if(i.length>0){let e=new Set(i.map(e=>String(e.hvac_mode).toLowerCase())),t=e.has(`heat`),n=e.has(`cool`);if(t&&n)return{mode:null,source:`conflict`,labelKey:`hero.output_conflict`,hintKey:`hero.output_conflict_hint`};if(t)return{mode:`heating`,source:`mode_only`,labelKey:`mode.heating_mode`,hintKey:`hero.mode_only_hint`};if(n)return{mode:`cooling`,source:`mode_only`,labelKey:`mode.cooling_mode`,hintKey:`hero.mode_only_hint`};if(e.has(`dry`))return{mode:`dry`,source:`mode_only`,labelKey:`mode.dry`,hintKey:`hero.mode_only_hint`};if(e.has(`fan_only`))return{mode:`fan_only`,source:`mode_only`,labelKey:`mode.fan_only`};if(e.has(`auto`)||e.has(`heat_cool`))return{mode:`idle`,source:`mode_only`,labelKey:`mode.auto_mode`,hintKey:`hero.mode_only_hint`}}return r.length>0&&r.every(e=>!e.available)?{mode:null,source:`offline`,labelKey:`hero.device_offline`,hintKey:`hero.device_offline_hint`}:r.some(e=>e.assumed_state)?{mode:null,source:`assumed`,labelKey:`hero.assumed_state`,hintKey:`hero.assumed_state_hint`}:{mode:null,source:`waiting`,labelKey:`hero.output_unknown`,hintKey:`hero.output_unknown_hint`}}function Fe(e){return(e.devices?.length??0)>0||(e.thermostats?.length??0)>0||(e.acs?.length??0)>0}function Ie(e,t){return t&&e.climate_control_enabled!==!1&&!e.is_outdoor&&Fe(e)}function Le(e,t){if(e==null||t==null||!Number.isFinite(e)||!Number.isFinite(t)||t<=0||t>100)return null;let n=17.625,r=243.04,i=Math.log(t/100)+n*e/(r+e),a=r*i/(n-i);return Number.isFinite(a)?Math.round(a*10)/10:null}function Re(e,t,n){let r=e!=null&&Number.isFinite(e)?e:null,i=t!=null&&Number.isFinite(t)?t:null;return n===`critical`?{status:`mold_risk`,tone:`critical`,labelKey:`monitor.comfort.mold_risk`,icon:`mdi:water-alert`}:n===`warning`?{status:`mold_risk`,tone:`warning`,labelKey:`monitor.comfort.mold_risk`,icon:`mdi:water-alert`}:r===null&&i===null?null:i!==null&&i>=65?{status:`humid`,tone:`warning`,labelKey:`monitor.comfort.humid`,icon:`mdi:water-percent`}:i!==null&&i<30?{status:`dry`,tone:`warning`,labelKey:`monitor.comfort.dry`,icon:`mdi:water-off-outline`}:r!==null&&r<18?{status:`cool`,tone:`info`,labelKey:`monitor.comfort.cool`,icon:`mdi:snowflake`}:r!==null&&r>26?{status:`warm`,tone:`warning`,labelKey:`monitor.comfort.warm`,icon:`mdi:weather-sunny-alert`}:{status:`comfortable`,tone:`success`,labelKey:`monitor.comfort.comfortable`,icon:`mdi:check-circle-outline`}}function q(e){return e.config?.unit_system?.temperature===`°F`}function J(e){return q(e)?`°F`:`°C`}function ze(e,t){return q(t)?e*9/5+32:e}function Be(e,t){return q(t)?e*5/9:e}function Ve(e,t,n=1){return ze(e,t).toFixed(n)}function He(e){return q(e)?`1`:`0.5`}var Ue=o`
  .mode-pill {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    font-size: 13px;
    font-weight: 500;
    padding: 4px 14px;
    border-radius: var(--roommind-radius-control, 8px);
    white-space: nowrap;
    max-width: 100%;
    overflow: hidden;
    text-overflow: ellipsis;
    flex-shrink: 0;
  }

  .mode-dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    flex-shrink: 0;
  }

  .mode-pill.mode-unverified-output .mode-dot {
    background: transparent !important;
    border: 1.5px solid currentColor;
    box-sizing: border-box;
  }

  .mode-heating {
    color: var(--warning-color, #ff9800);
    background: var(--roommind-warning-tint);
  }
  .mode-heating .mode-dot {
    background: var(--warning-color, #ff9800);
  }

  .mode-cooling {
    color: var(--roommind-info-color);
    background: var(--roommind-info-tint);
  }
  .mode-cooling .mode-dot {
    background: var(--roommind-info-color);
  }

  .mode-dry {
    color: var(--roommind-dry-color, #009688);
    background: color-mix(in srgb, var(--roommind-dry-color, #009688) 14%, transparent);
  }
  .mode-dry .mode-dot {
    background: var(--roommind-dry-color, #009688);
  }

  .mode-fan {
    color: var(--roommind-fan-color, #00acc1);
    background: color-mix(in srgb, var(--roommind-fan-color, #00acc1) 14%, transparent);
  }
  .mode-fan .mode-dot {
    background: var(--roommind-fan-color, #00acc1);
  }

  .mode-off {
    color: var(--disabled-text-color, #9e9e9e);
    background: var(--roommind-surface-muted);
  }
  .mode-off .mode-dot {
    background: var(--disabled-text-color, #9e9e9e);
  }

  .mode-idle {
    color: var(--secondary-text-color, #757575);
    background: var(--roommind-surface-muted);
  }
  .mode-idle .mode-dot {
    background: var(--disabled-text-color, #bdbdbd);
  }

  .mode-monitoring {
    color: var(--roommind-info-color, #0288d1);
    background: var(--roommind-info-tint, rgba(3, 169, 244, 0.12));
  }
  .mode-monitoring .mode-dot {
    background: var(--roommind-info-color, #0288d1);
  }

  .mode-other {
    color: var(--secondary-text-color);
    background: var(--roommind-surface-muted);
  }
  .mode-other .mode-dot {
    background: var(--secondary-text-color);
  }
`,We=o`
  :host {
    color-scheme: light dark;
    --mdc-shape-small: var(--roommind-radius-control);
    --mdc-shape-medium: var(--roommind-radius-control);
    --md-filled-text-field-container-shape: var(--roommind-radius-control);
    --md-outlined-text-field-container-shape: var(--roommind-radius-control);
    --roommind-radius-card: 14px;
    --roommind-radius-control: 9px;
    --roommind-radius-small: 7px;
    --roommind-motion-duration: 180ms;
    --roommind-motion-easing: cubic-bezier(0.2, 0.8, 0.2, 1);
    --roommind-surface: var(
      --card-background-color,
      var(--secondary-background-color, var(--primary-background-color, #ffffff))
    );
    --roommind-panel-surface: color-mix(
      in srgb,
      var(--roommind-surface) 98%,
      var(--primary-text-color, #000000)
    );
    --roommind-dialog-surface: color-mix(
      in srgb,
      var(--roommind-surface) 98%,
      var(--primary-text-color, #000000)
    );
    --roommind-page-background: var(--primary-background-color, #ffffff);
    --roommind-dialog-backdrop: rgba(0, 0, 0, 0.54);
    --roommind-surface-subtle: color-mix(
      in srgb,
      var(--roommind-surface) 97%,
      var(--primary-text-color, #000000)
    );
    --roommind-surface-muted: color-mix(
      in srgb,
      var(--roommind-surface) 95%,
      var(--primary-text-color, #000000)
    );
    --roommind-surface-strong: color-mix(
      in srgb,
      var(--roommind-surface) 90%,
      var(--primary-text-color, #000000)
    );
    --roommind-surface-hover: color-mix(
      in srgb,
      var(--roommind-surface) 93%,
      var(--primary-text-color, #000000)
    );
    --roommind-surface-hover-strong: color-mix(
      in srgb,
      var(--roommind-surface) 88%,
      var(--primary-text-color, #000000)
    );
    --roommind-primary-subtle: color-mix(in srgb, var(--primary-color, #03a9f4) 4%, transparent);
    --roommind-primary-muted: color-mix(in srgb, var(--primary-color, #03a9f4) 8%, transparent);
    --roommind-primary-strong: color-mix(in srgb, var(--primary-color, #03a9f4) 12%, transparent);
    --roommind-primary-border: color-mix(in srgb, var(--primary-color, #03a9f4) 38%, transparent);
    --roommind-border-subtle: 1px solid var(--divider-color, rgba(0, 0, 0, 0.08));
    --roommind-border-faint: 1px solid var(--divider-color, rgba(0, 0, 0, 0.06));
    --roommind-card-border-hover: color-mix(
      in srgb,
      var(--primary-color, #03a9f4) 42%,
      var(--divider-color, rgba(0, 0, 0, 0.1))
    );
    --roommind-shadow-card: 0 1px 2px rgba(0, 0, 0, 0.04), 0 4px 12px rgba(0, 0, 0, 0.025);
    --roommind-shadow-card-hover: 0 6px 18px rgba(0, 0, 0, 0.08), 0 1px 4px rgba(0, 0, 0, 0.04);
    --roommind-shadow-soft: 0 2px 12px rgba(0, 0, 0, 0.035);
    --roommind-shadow-dialog: 0 24px 48px rgba(0, 0, 0, 0.32);
    --roommind-header-min-height: 38px;
    --roommind-info-color: var(--info-color, #2196f3);
    --roommind-success-color: var(--success-color, #4caf50);
    --roommind-warning-color: var(--warning-color, #ff9800);
    --roommind-error-color: var(--error-color, #f44336);
    --roommind-info-tint: color-mix(in srgb, var(--roommind-info-color) 14%, transparent);
    --roommind-success-tint: color-mix(in srgb, var(--roommind-success-color) 14%, transparent);
    --roommind-warning-tint: color-mix(in srgb, var(--roommind-warning-color) 14%, transparent);
    --roommind-error-tint: color-mix(in srgb, var(--roommind-error-color) 14%, transparent);
    --roommind-info-border: color-mix(in srgb, var(--roommind-info-color) 28%, transparent);
    --roommind-success-border: color-mix(in srgb, var(--roommind-success-color) 28%, transparent);
    --roommind-warning-border: color-mix(in srgb, var(--roommind-warning-color) 28%, transparent);
    --roommind-error-border: color-mix(in srgb, var(--roommind-error-color) 28%, transparent);
  }

  @media (prefers-reduced-motion: reduce) {
    :host {
      --roommind-motion-duration: 0ms;
    }
  }
`,Ge=3e4,Y=new class{constructor(){this._hass=null,this._subscribers=new Set,this._unsubPush=null,this._latest={rooms:{},climate_control_active:!0,vacation_active:!1,vacation_temp:null,outdoor_temp:null}}setHass(e){let t=this._hass?.connection!==e.connection;this._hass=e,t&&this._subscribers.size>0&&(this._teardown(),this._start())}subscribe(e){return this._subscribers.add(e),Object.keys(this._latest.rooms).length>0&&e(this._latest),this._subscribers.size===1&&this._start(),()=>{this._subscribers.delete(e),this._subscribers.size===0&&this._teardown()}}async refresh(){if(this._hass?.callWS)try{let e=await this._hass.callWS({type:`roommind/rooms/list`});this._publish(e)}catch{this._latest={...this._latest,error:!0};for(let e of this._subscribers)e(this._latest)}}_publish(e){this._latest={rooms:e.rooms??{},climate_control_active:e.climate_control_active??!0,vacation_active:e.vacation_active??!1,vacation_temp:e.vacation_temp??null,outdoor_temp:e.outdoor_temp??null,error:!1};for(let e of this._subscribers)e(this._latest)}_start(){this.refresh(),this._timer=setInterval(()=>void this.refresh(),Ge),this._hass?.connection?.subscribeMessage&&!this._unsubPush&&this._hass.connection.subscribeMessage(e=>this._publish(e),{type:`roommind/rooms/subscribe`}).then(e=>{this._subscribers.size===0?e():this._unsubPush=e}).catch(()=>{})}_teardown(){if(this._timer!==void 0&&(clearInterval(this._timer),this._timer=void 0),this._unsubPush){try{this._unsubPush()}catch{}this._unsubPush=null}}};function Ke(e){Y.setHass(e)}function qe(e){return Y.subscribe(e)}function X(){return Y.refresh()}function Z(e,t,n,r){var i=arguments.length,a=i<3?t:r===null?r=Object.getOwnPropertyDescriptor(t,n):r,o;if(typeof Reflect==`object`&&typeof Reflect.decorate==`function`)a=Reflect.decorate(e,t,n,r);else for(var s=e.length-1;s>=0;s--)(o=e[s])&&(a=(i<3?o(a):i>3?o(t,n,a):o(t,n))||a);return i>3&&a&&Object.defineProperty(t,n,a),a}var Q=class extends U{constructor(...e){super(...e),this._config={},this._snapshot=null,this._busy=!1,this._unsub=null}setConfig(e){this._config=e??{}}static getConfigElement(){return document.createElement(`roommind-room-card-editor`)}static getStubConfig(){return{type:`custom:roommind-room-card`,area_id:``}}getCardSize(){return 3}connectedCallback(){super.connectedCallback(),this.hass&&Ke(this.hass),this._unsub=qe(e=>{this._snapshot=e})}updated(e){e.has(`hass`)&&this.hass&&Ke(this.hass)}disconnectedCallback(){super.disconnectedCallback(),this._unsub?.(),this._unsub=null}get _areaId(){return this._config.area_id||this._config.room||``}async _nudgeTarget(e,t){if(!this.hass?.callWS||this._busy)return;let n=t.live,r=n?.override_active&&n.override_temp!=null?n.override_temp:n?.target_temp??n?.heat_target??n?.cool_target??n?.current_temp??22,i=Math.max(5,Math.min(35,Math.round((r+e)*10)/10));this._busy=!0;try{await this.hass.callWS({type:`roommind/override/set`,area_id:this._areaId,temperature:i,duration_hours:2}),await X()}finally{this._busy=!1}}async _clearOverride(){if(this.hass?.callWS&&!this._busy){this._busy=!0;try{await this.hass.callWS({type:`roommind/override/clear`,area_id:this._areaId}),await X()}finally{this._busy=!1}}}async _toggleClimateControl(e){if(this.hass?.callWS&&!this._busy){this._busy=!0;try{await this.hass.callWS({type:`roommind/rooms/save`,area_id:this._areaId,climate_control_enabled:e.climate_control_enabled===!1}),await X()}finally{this._busy=!1}}}render(){let e=this.hass?.language??`en`,t=this._areaId;if(!t)return N`<ha-card
        ><div class="card-empty">${K(`roomcard.select_room`,e)}</div></ha-card
      >`;let n=this._snapshot?.rooms?.[t];if(!n)return N`<ha-card><div class="card-empty">${K(`panel.loading`,e)}</div></ha-card>`;let r=n.live,i=!n.is_outdoor&&!Fe(n),a=n.display_name||this.hass?.areas?.[t]?.name||t,o=Pe(r,n),s=Ie(n,this._snapshot?.climate_control_active??!0),c=r?.override_active&&r.override_temp!=null?r.override_temp:r?.target_temp,l=Be(parseFloat(He(this.hass))||.5,this.hass),u=Re(r?.current_temp??null,r?.current_humidity??null,r?.mold_risk_level),d=Le(r?.current_temp??null,r?.current_humidity??null),ee=u!==null&&(i||u.tone===`warning`||u.tone===`critical`),te=[r?.co2==null?``:`CO₂ ${Math.round(r.co2)} ppm`,r?.pm25==null?``:`PM2.5 ${r.pm25.toFixed(1)}`,r?.voc==null?``:`VOC ${Math.round(r.voc)}`],f=[d===null?``:K(`card.dew_point_short`,e,{value:Ve(d,this.hass),unit:J(this.hass)}),...te].filter(Boolean);return N`
      <ha-card>
        <div class="card-head">
          <div class="card-title-col">
            <div class="card-name">${a}</div>
            <div class="card-badges">
              ${i?N`<span class="mode-pill mode-monitoring">
                      <span class="mode-dot"></span>
                      ${K(`room.control_mode.monitor_only`,e)}
                    </span>`:N`<span class="mode-pill ${Me(o.mode)}">
                      <span class="mode-dot"></span>
                      ${K(o.labelKey,e)}
                    </span>`}
              ${ee?N`<span class="status-pill" data-tone=${u.tone}>
                      ${K(u.labelKey,e)}
                    </span>`:F}
              ${r?.window_open?N`<span class="status-pill warn">${K(`card.window_open`,e)}</span>`:F}
              ${r?.air_quality_bad?N`<span class="status-pill warn"
                      >${K(`hero.air_quality_bad`,e,{reason:(r.air_quality_reason??`AQ`).toUpperCase()})}</span
                    >`:F}
            </div>
          </div>
          ${!i&&!n.is_outdoor?N`<ha-switch
                  .checked=${n.climate_control_enabled!==!1}
                  .disabled=${this._busy}
                  @change=${()=>this._toggleClimateControl(n)}
                ></ha-switch>`:F}
        </div>

        <div class="card-metrics">
          <div class="metric-main">
            <span class="metric-val">
              ${r?.current_temp==null?`--`:`${Ve(r.current_temp,this.hass)}${J(this.hass)}`}
            </span>
            ${r?.current_humidity==null?F:N`<span class="metric-sub">${r.current_humidity.toFixed(0)}% RH</span>`}
          </div>

          ${!i&&!n.is_outdoor&&s?N`
                  <div class="target-controls">
                    <button
                      type="button"
                      class="step-btn"
                      ?disabled=${this._busy}
                      @click=${()=>this._nudgeTarget(-l,n)}
                    >
                      −
                    </button>
                    <div class="target-readout">
                      <span class="target-val">
                        ${c==null?`--`:`${ze(c,this.hass).toFixed(1)}${J(this.hass)}`}
                      </span>
                      ${r?.override_active?N`<button
                              type="button"
                              class="override-clear"
                              @click=${this._clearOverride}
                            >
                              ${K(`roomcard.clear_override`,e)}
                            </button>`:F}
                    </div>
                    <button
                      type="button"
                      class="step-btn"
                      ?disabled=${this._busy}
                      @click=${()=>this._nudgeTarget(l,n)}
                    >
                      +
                    </button>
                  </div>
                `:F}
        </div>

        ${f.length>0?N`<div class="card-footer">${f.join(` · `)}</div>`:F}
      </ha-card>
    `}static{this.styles=[We,Ue,o`
      :host {
        display: block;
      }
      ha-card {
        padding: 14px 16px;
        border-radius: var(--ha-card-border-radius, 12px);
      }
      .card-empty {
        padding: 16px;
        color: var(--secondary-text-color);
        text-align: center;
      }
      .card-head {
        display: flex;
        align-items: center;
        justify-content: space-between;
        flex-wrap: wrap;
        gap: 8px;
      }
      .card-name {
        font-size: 15px;
        font-weight: 600;
        color: var(--primary-text-color);
      }
      .card-badges {
        display: flex;
        flex-wrap: wrap;
        gap: 6px;
        margin-top: 4px;
      }
      .status-pill {
        font-size: 11px;
        font-weight: 600;
        padding: 2px 8px;
        border-radius: 999px;
        white-space: nowrap;
        flex-shrink: 0;
      }
      .status-pill.warn,
      .status-pill[data-tone="warning"] {
        background: var(--roommind-warning-tint, rgba(255, 152, 0, 0.16));
        color: var(--warning-color, #ed6c02);
      }
      .status-pill[data-tone="success"] {
        background: var(--roommind-success-tint, rgba(76, 175, 80, 0.14));
        color: var(--roommind-success-color, #4caf50);
      }
      .status-pill[data-tone="info"] {
        background: var(--roommind-info-tint, rgba(33, 150, 243, 0.14));
        color: var(--roommind-info-color, #2196f3);
      }
      .status-pill[data-tone="critical"] {
        background: var(--roommind-error-tint, rgba(244, 67, 54, 0.14));
        color: var(--error-color, #f44336);
      }
      .card-metrics {
        display: flex;
        align-items: center;
        justify-content: space-between;
        flex-wrap: wrap;
        gap: 12px;
        margin-top: 12px;
      }
      .metric-main {
        display: flex;
        align-items: baseline;
        gap: 8px;
        white-space: nowrap;
        flex-shrink: 0;
      }
      .metric-val {
        font-size: 24px;
        font-weight: 650;
        font-variant-numeric: tabular-nums;
        white-space: nowrap;
        flex-shrink: 0;
      }
      .metric-sub {
        font-size: 12.5px;
        color: var(--secondary-text-color);
        white-space: nowrap;
        flex-shrink: 0;
      }
      .target-controls {
        display: flex;
        align-items: center;
        gap: 8px;
      }
      .step-btn {
        width: 30px;
        height: 30px;
        border-radius: 50%;
        border: 1px solid var(--divider-color, rgba(0, 0, 0, 0.14));
        background: var(--secondary-background-color, transparent);
        color: var(--primary-text-color);
        font-size: 16px;
        white-space: nowrap;
        flex-shrink: 0;
        cursor: pointer;
      }
      .target-readout {
        display: flex;
        flex-direction: column;
        align-items: center;
        min-width: 56px;
      }
      .target-val {
        font-size: 14px;
        font-weight: 600;
        font-variant-numeric: tabular-nums;
        white-space: nowrap;
        flex-shrink: 0;
      }
      .override-clear {
        background: none;
        border: none;
        padding: 0;
        color: var(--primary-color);
        font-size: 11px;
        white-space: nowrap;
        flex-shrink: 0;
        cursor: pointer;
      }
      .card-footer {
        margin-top: 10px;
        padding-top: 8px;
        border-top: 1px solid var(--divider-color, rgba(0, 0, 0, 0.08));
        font-size: 12px;
        color: var(--secondary-text-color);
      }
    `]}};Z([W({attribute:!1})],Q.prototype,`hass`,void 0),Z([G()],Q.prototype,`_config`,void 0),Z([G()],Q.prototype,`_snapshot`,void 0),Z([G()],Q.prototype,`_busy`,void 0),Q=Z([Se(`roommind-room-card`)],Q);var $=class extends U{constructor(...e){super(...e),this._config={}}setConfig(e){this._config=e??{}}render(){let e=this.hass?.language??`en`,t=Object.values(this.hass?.areas??{}),n=this._config.area_id||this._config.room||``;return N`
      <div style="display: flex; flex-direction: column; gap: 12px; padding: 8px 0">
        <label style="font-size: 13px; font-weight: 500"
          >${K(`roomcard.select_room`,e)}</label
        >
        <select
          style="padding: 8px; border-radius: 6px; border: 1px solid var(--divider-color, #ccc)"
          .value=${n}
          @change=${e=>{let t=e.target.value;this.dispatchEvent(new CustomEvent(`config-changed`,{detail:{config:{...this._config,area_id:t}},bubbles:!0,composed:!0}))}}
        >
          <option value="">--</option>
          ${t.map(e=>N`<option value=${e.area_id} ?selected=${e.area_id===n}>${e.name}</option>`)}
        </select>
      </div>
    `}};Z([W({attribute:!1})],$.prototype,`hass`,void 0),Z([G()],$.prototype,`_config`,void 0),$=Z([Se(`roommind-room-card-editor`)],$),window.customCards=window.customCards??[],window.customCards.some(e=>e.type===`roommind-room-card`)||window.customCards.push({type:`roommind-room-card`,name:`RoomMind Room Card`,description:`Monitor temperature, humidity, air quality, and adjust RoomMind targets.`,preview:!0})})();