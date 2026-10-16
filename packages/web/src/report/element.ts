/**
 * The two ways in, shared by the npm entry (`@vitrinka/web/report`) and the
 * single-file widget (`build/report-widget.mjs`): the `<vitrinka-report>`
 * custom element and `mountReport(opts)`, which creates one.
 *
 *   <vitrinka-report key="vkb_…" base="https://vitrinka.example"
 *                    locale="cs" button="false" open-selector="#help-report">
 *
 * The element is a configuration holder that renders nothing itself: the
 * widget paints into the shared HUD host on `<html>` (top layer, shadow
 * root). Attributes are live — `locale` repaints in place, `button` shows or
 * hides the floating button, `open-selector` rebinds; a changed `key` or
 * `base` remounts. The face is config (QA Studio D6): `face: 'recorder'`
 * mounts the recorder pill instead (npm entry only — it needs React and a
 * `vkr_` key or a device link).
 */
import type { RecordLoader } from './engine';
import { type Locale, parseLocale } from './i18n';
import type { IdentifyInput } from './identity';
import type { CaptureNarrowing } from './profile';
import { ReportWidget } from './widget';

export const REPORT_TAG = 'vitrinka-report';

export type ReportFace = 'report' | 'recorder';

/** Options a host passes in script, beyond what attributes carry. */
export interface ReportScriptOptions {
  appVersion?: string;
  /** Narrow the project's capture profile (never widen it). */
  capture?: CaptureNarrowing;
  /** Rewrite captured URLs and routes before redaction (credentials in paths). */
  sanitizeUrl?: (url: string) => string;
}

export interface ReportOptions extends ReportScriptOptions {
  /** The project's `vkb_` report key (`face: 'recorder'`: a `vkr_` key, or none for the device link). */
  key: string;
  /** vitrinka's origin; the single-file widget defaults to the origin it was served from. */
  base?: string;
  /** Default `report`. */
  face?: ReportFace;
  /** `cs` | `en`; default: the browser's language. */
  locale?: Locale | string;
  /** The large floating button (default true); false = open it from your own control. */
  button?: boolean;
  /** Your control(s) that open the card, as a CSS selector. */
  openSelector?: string;
  /** Who reports: a token your server signed, or an asserted email. */
  identity?: IdentifyInput;
  /** Where the element goes (default `document.body`). */
  parent?: Element;
}

export interface ReportHandle {
  readonly face: ReportFace;
  open(): void;
  close(): void;
  identify(who: IdentifyInput): void;
  setLocale(locale: Locale | string): void;
  unmount(): void;
}

/** `<vitrinka-report>` as script sees it. */
export interface VitrinkaReportElement extends HTMLElement {
  /** Set before the element connects (mountReport does). */
  options: ReportScriptOptions;
  open(): void;
  close(): void;
  identify(who: IdentifyInput): void;
  setLocale(locale: Locale | string): void;
}

declare global {
  interface HTMLElementTagNameMap {
    'vitrinka-report': VitrinkaReportElement;
  }
}

export interface RecorderFaceOptions {
  base: string;
  key: string;
  appVersion?: string;
  sanitizeUrl?: (url: string) => string;
}

/** What each build brings: how rrweb loads, the recorder face (npm only), the default base. */
export interface Faces {
  loadRecord: RecordLoader;
  recorderFace: (() => Promise<(opts: RecorderFaceOptions) => () => void>) | null;
  defaultBase: () => string;
}

const ATTRS = ['key', 'base', 'open-selector', 'locale', 'button'] as const;

function trimBase(raw: string): string {
  return raw.trim().replace(/\/+$/, '');
}

/** Define `<vitrinka-report>` once per page (the first build to load wins). */
export function defineReportElement(faces: Faces): void {
  if (typeof customElements === 'undefined' || customElements.get(REPORT_TAG)) return;

  class ReportElement extends HTMLElement implements VitrinkaReportElement {
    static get observedAttributes(): readonly string[] {
      return ATTRS;
    }

    options: ReportScriptOptions = {};
    private widget: ReportWidget | null = null;
    private pendingIdentity: IdentifyInput | undefined = undefined;

    connectedCallback(): void {
      this.hidden = true;
      this.mountWidget();
    }

    disconnectedCallback(): void {
      this.widget?.unmount();
      this.widget = null;
    }

    attributeChangedCallback(name: string, old: string | null, value: string | null): void {
      if (!this.widget || old === value) return;
      if (name === 'locale') this.widget.setLocale(value);
      else if (name === 'button') this.widget.setButton(value !== 'false');
      else if (name === 'open-selector') this.widget.setOpenSelector(value);
      else {
        this.widget.unmount();
        this.widget = null;
        this.mountWidget();
      }
    }

    open(): void {
      this.widget?.open();
    }

    close(): void {
      this.widget?.close();
    }

    identify(who: IdentifyInput): void {
      this.pendingIdentity = who;
      this.widget?.identify(who);
    }

    setLocale(locale: Locale | string): void {
      // The attribute is the one source: it repaints through attributeChangedCallback.
      this.setAttribute('locale', String(locale));
    }

    private mountWidget(): void {
      const key = (this.getAttribute('key') ?? '').trim();
      const base = trimBase(this.getAttribute('base') ?? faces.defaultBase());
      if (!key || !base) {
        console.warn(`vitrinka: <${REPORT_TAG}> needs a key${base ? '' : ' and a base'} — nothing mounted`);
        return;
      }
      this.widget = new ReportWidget({
        base,
        key,
        locale: parseLocale(this.getAttribute('locale')),
        button: this.getAttribute('button') !== 'false',
        openSelector: this.getAttribute('open-selector'),
        identity: this.pendingIdentity,
        appVersion: this.options.appVersion,
        capture: this.options.capture,
        sanitizeUrl: this.options.sanitizeUrl,
        loadRecord: faces.loadRecord,
      });
    }
  }

  customElements.define(REPORT_TAG, ReportElement);
}

/** Mount Report a problem (or, with `face: 'recorder'`, the recorder pill) and get its handle. */
export function mountReport(opts: ReportOptions, faces: Faces): ReportHandle {
  if (opts.face === 'recorder') return mountRecorder(opts, faces);
  defineReportElement(faces);
  const el = document.createElement(REPORT_TAG);
  el.setAttribute('key', opts.key);
  if (opts.base) el.setAttribute('base', opts.base);
  if (opts.locale) el.setAttribute('locale', String(opts.locale));
  if (opts.button === false) el.setAttribute('button', 'false');
  if (opts.openSelector) el.setAttribute('open-selector', opts.openSelector);
  el.options = { appVersion: opts.appVersion, capture: opts.capture, sanitizeUrl: opts.sanitizeUrl };
  if (opts.identity) el.identify(opts.identity);
  (opts.parent ?? document.body).append(el);
  return {
    face: 'report',
    open: () => el.open(),
    close: () => el.close(),
    identify: (who) => el.identify(who),
    setLocale: (l) => el.setLocale(l),
    unmount: () => el.remove(),
  };
}

function mountRecorder(opts: ReportOptions, faces: Faces): ReportHandle {
  const base = trimBase(opts.base ?? faces.defaultBase());
  let unmount: (() => void) | null = null;
  let gone = false;
  if (!faces.recorderFace) {
    console.warn('vitrinka: the recorder face needs the npm package (@vitrinka/web/report) — nothing mounted');
  } else {
    faces
      .recorderFace()
      .then((mount) => {
        if (!gone) unmount = mount({ base, key: opts.key, appVersion: opts.appVersion, sanitizeUrl: opts.sanitizeUrl });
      })
      .catch((e: unknown) => console.warn('vitrinka: the recorder face did not load', e));
  }
  // The pill is always on screen and English-only, and speaks for the device link: no card to open.
  const inert = () => undefined;
  return {
    face: 'recorder',
    open: inert,
    close: inert,
    identify: inert,
    setLocale: inert,
    unmount: () => {
      gone = true;
      unmount?.();
    },
  };
}
