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
 * `vkr_` key or a device link). A linked vitrinka member also switches faces
 * in place (vt-8020 D8, face.ts): the report menu's Record swaps in the pill
 * on the device link, the pill's "Report a problem" swaps back, and the pick
 * survives a reload (npm entry only, like `face: 'recorder'`). The host's
 * openers — `open()` and `open-selector` — swap back too and open the card,
 * except while the pill records.
 */
import { listen } from '../recorder/hud/listen';
import type { RecordLoader } from './engine';
import { memberLinked, pillRecording, rememberFace, startFace, watchMemberLink } from './face';
import { type Locale, parseLocale } from './i18n';
import type { IdentifyInput } from './identity';
import type { CaptureNarrowing } from './profile';
import { hitsOpener, ReportWidget } from './widget';

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
  /** The face on screen — a linked member's Record switch turns a `report` mount into `recorder`. */
  readonly face: ReportFace;
  /** Opens the card; on a member's switched pill it swaps back first (never while the pill records). */
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
  /** The face on screen: `recorder` while a linked member has switched to the pill. */
  readonly face: ReportFace;
  /** Opens the card; on the pill it swaps back first (never while the pill records). */
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
  /** A `vkr_` key; absent or empty = the stored device link (never a baked env key). */
  key?: string;
  appVersion?: string;
  sanitizeUrl?: (url: string) => string;
  /** The pill's menu offers "Report a problem", which calls this; absent = no row. */
  onReportFace?: () => void;
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
    /** The mounted key and base; null until both are set. */
    private at: { key: string; base: string } | null = null;
    /** The face on screen once mounted. */
    private shown: ReportFace | null = null;
    private widget: ReportWidget | null = null;
    /** Unmounts the recorder pill once its lazy face has loaded. */
    private pill: (() => void) | null = null;
    /** Bumped whenever a face comes down: a pill that loads after its face was left never mounts. */
    private gen = 0;
    /** The report widget currently offers Record. */
    private recordOffered = false;
    /** The host's `open-selector` control while the pill shows (the report widget binds it otherwise). */
    private offPillOpener: (() => void) | null = null;
    /** An open() refused on a recording pill has said why. */
    private warnedRecording = false;
    private offLink: (() => void) | null = null;
    private pendingIdentity: IdentifyInput | undefined = undefined;

    get face(): ReportFace {
      return this.shown ?? 'report';
    }

    connectedCallback(): void {
      this.hidden = true;
      this.mount();
    }

    disconnectedCallback(): void {
      this.unmount();
    }

    attributeChangedCallback(name: string, old: string | null, value: string | null): void {
      if (old === value) return;
      if (!this.at) {
        // Connected but waiting for its key or base (a host that configures later): mount now.
        if (this.isConnected && (name === 'key' || name === 'base')) this.mount();
        return;
      }
      if (name === 'key' || name === 'base') {
        this.unmount();
        this.mount();
        return;
      }
      // The rest are the report face's: the pill's opener reads `open-selector` per click, and a switch back reads them afresh.
      if (!this.widget) return;
      if (name === 'locale') this.widget.setLocale(value);
      else if (name === 'button') this.widget.setButton(value !== 'false');
      else if (name === 'open-selector') this.widget.setOpenSelector(value);
    }

    open(): void {
      if (this.shown === 'recorder') this.openFromPill();
      else this.widget?.open();
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

    /** Idempotent: an upgrade runs attributeChangedCallback before connectedCallback, and both land here. */
    private mount(): void {
      if (this.at) return;
      const key = (this.getAttribute('key') ?? '').trim();
      const base = trimBase(this.getAttribute('base') ?? faces.defaultBase());
      if (!key || !base) {
        console.warn(`vitrinka: <${REPORT_TAG}> needs a key${base ? '' : ' and a base'} — nothing mounted`);
        return;
      }
      this.at = { key, base };
      // Only a build that carries the pill can switch to it (the single-file widget does not).
      if (faces.recorderFace) this.offLink = watchMemberLink(() => this.offerRecord());
      this.show(faces.recorderFace ? startFace(base) : 'report');
    }

    private unmount(): void {
      this.offLink?.();
      this.offLink = null;
      this.takeDown();
      this.at = null;
      this.shown = null;
    }

    /** Take the face on screen down; the mount (and its link watch) stays. */
    private takeDown(): void {
      this.gen++;
      this.widget?.unmount();
      this.widget = null;
      this.recordOffered = false;
      this.offPillOpener?.();
      this.offPillOpener = null;
      this.pill?.();
      this.pill = null;
    }

    private show(face: ReportFace): void {
      const at = this.at;
      if (!at) return;
      this.takeDown();
      const loadPill = faces.recorderFace;
      if (face === 'recorder' && loadPill) {
        this.shown = 'recorder';
        // The widget that binds the host's control is down while the pill shows: the control still reaches the card.
        this.offPillOpener = listen(document, 'click', (ev) => {
          if (!hitsOpener(ev, this.getAttribute('open-selector'))) return;
          ev.preventDefault();
          this.open();
        });
        const gen = this.gen;
        loadPill()
          .then((mountPill) => {
            if (gen !== this.gen) return;
            // The member's own device link, never the host's key: a `vkb_` key cannot record.
            this.pill = mountPill({
              base: at.base,
              appVersion: this.options.appVersion,
              sanitizeUrl: this.options.sanitizeUrl,
              onReportFace: () => this.switchTo('report'),
            });
          })
          .catch((e: unknown) => {
            console.warn('vitrinka: the recorder face did not load — showing Report a problem', e);
            if (gen === this.gen) this.show('report');
          });
        return;
      }
      this.shown = 'report';
      this.widget = new ReportWidget({
        base: at.base,
        key: at.key,
        locale: parseLocale(this.getAttribute('locale')),
        button: this.getAttribute('button') !== 'false',
        openSelector: this.getAttribute('open-selector'),
        identity: this.pendingIdentity,
        appVersion: this.options.appVersion,
        capture: this.options.capture,
        sanitizeUrl: this.options.sanitizeUrl,
        loadRecord: faces.loadRecord,
      });
      this.offerRecord();
    }

    /** Record is on the report face's menu exactly while this browser holds a member link for this base. */
    private offerRecord(): void {
      if (!this.widget || !this.at) return;
      const offer = faces.recorderFace !== null && memberLinked(this.at.base);
      if (offer === this.recordOffered) return;
      this.recordOffered = offer;
      this.widget.setRecordSwitch(offer ? () => this.switchTo('recorder') : null);
    }

    /**
     * A host opener on the pill: back to Report a problem — remembered as the
     * pill's own row does — and the card opens there. Never while the pill
     * records: it hides its own way back then, as leaving strands the session.
     */
    private openFromPill(): void {
      if (pillRecording()) {
        if (!this.warnedRecording) {
          console.warn('vitrinka: Report a problem stays closed while the recorder pill records — leaving would strand the session; stop the recording first');
        }
        this.warnedRecording = true;
        return;
      }
      this.switchTo('report', () => this.widget?.open());
    }

    /**
     * The member's pick, remembered for this browser; applied once the menu
     * that asked has let go of its click, then `then` runs on the new face —
     * unless the face changed meanwhile.
     */
    private switchTo(face: ReportFace, then?: () => void): void {
      rememberFace(face);
      const gen = this.gen;
      setTimeout(() => {
        if (gen !== this.gen) return;
        if (this.shown !== face) this.show(face);
        then?.();
      }, 0);
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
  // null is a choice (anonymous, whatever the page-wide identity); only undefined defers.
  if (opts.identity !== undefined) el.identify(opts.identity);
  (opts.parent ?? document.body).append(el);
  return {
    get face() {
      return el.face;
    },
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
        // The host picked this face: no "Report a problem" row — there is no report key to swap back to.
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
