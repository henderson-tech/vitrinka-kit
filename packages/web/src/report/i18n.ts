/**
 * Every string Report a problem shows, one catalog per locale (cs, en). The
 * browser's language picks one by default; the host's `locale` option,
 * `locale` attribute and `setLocale()` switch it live — the widget repaints
 * its text in place, so a draft and its marks survive the switch.
 *
 * Marking is taught as "click, hold and move" — never "drag" (D21): a
 * first-time reporter does not know the word.
 */
import type { MarkerShape } from './markers';

export type Locale = 'cs' | 'en';
export type ReportKind = 'bug' | 'suggestion' | 'question' | 'other';
export const REPORT_KINDS: readonly ReportKind[] = ['bug', 'suggestion', 'question', 'other'];

export interface Strings {
  button: string;
  title: string;
  close: string;
  settings: string;
  prompt: string;
  placeholder: string;
  /** "The last 5 minutes are attached" for a window of `sec` seconds. */
  attached: (sec: number) => string;
  included: string;
  incReplay: string;
  incReplayMasked: { strict: string; balanced: string; full: string };
  incErrors: string;
  incConsole: string;
  incNetwork: string;
  incFailedRequests: string;
  incEnv: string;
  incIdentity: string;
  incMarks: string;
  showWhere: string;
  /** The reporter's own word for what this is (vt-8020 D11) — a hint Eve reads, never the category. */
  kinds: Record<ReportKind, string>;
  kindsLabel: string;
  /** The marks' list in the card while there are none yet. */
  linesEmpty: string;
  notify: string;
  send: string;
  sending: string;
  retry: string;
  errorCreate: string;
  errorCapture: string;
  sentTitle: string;
  sentBody: string;
  sentNotify: string;
  seeReport: string;
  tools: { circle: string; box: string; arrow: string; hide: string };
  toolbar: string;
  /** The marking bar's one plain line. */
  barLead: string;
  /** The bar's line while Cover is picked: what covering is for. */
  barLeadHide: string;
  /** Leaves marking and drops the marks of this pass (vt-8020 D12). */
  cancelMarking: string;
  discardMarks: (n: number) => string;
  discard: string;
  keep: string;
  /** The coach's line for the picked shape. */
  coach: Record<MarkerShape, string>;
  coachMore: string;
  /** Turns the coach off for good on this browser; Settings turns it back on. */
  coachDismiss: string;
  coachSetting: string;
  /** The marking layer's name, for assistive technology. */
  marking: string;
  /** How to mark from the keyboard: the layer's description for assistive technology, never painted. */
  keyboardHint: string;
  /** Written on a placed cover. */
  hidden: string;
  notePlaceholder: string;
  mark: (n: number) => string;
  removeMark: (n: number) => string;
  shortcut: string;
  shortcutHint: string;
  notSet: string;
  recordShortcut: string;
  pressKeys: string;
  needModifier: string;
  removeShortcut: string;
  back: string;
  // -- the account and the menu (vt-8020 D2, D3, D5) --
  account: string;
  menu: string;
  anonymous: string;
  anonymousHint: string;
  signedInByApp: string;
  linkVitrinka: string;
  linkedAs: (who: string) => string;
  unlink: string;
  myReports: string;
  recentRecordings: string;
  record: string;
  /** Why Record waits: the switch to the pill would lose the unsent report. */
  recordHasDraft: string;
  openVitrinka: string;
  openPortal: string;
  // -- the lists --
  loading: string;
  listFailed: string;
  noReports: string;
  noRecordings: string;
  fromThisBrowser: string;
  /** A report's step as the portal names it; an unknown key shows as is. */
  steps: Record<string, string>;
  waiting: string;
  sentQueued: string;
  // -- the link sheet --
  linkCode: string;
  linkHint: string;
  linkWaiting: string;
  linkExpired: string;
  linkFailed: string;
  // -- attachments (vt-8020 D9): one line names the cap a file broke --
  attach: string;
  removeFile: (name: string) => string;
  fileTooBig: (name: string, cap: string) => string;
  tooManyFiles: (n: number) => string;
  fileType: (name: string, types: string) => string;
  /** The default caps' types as a person reads them (the rest show as configured). */
  typeNames: { image: string; pdf: string; text: string; office: string };
  incFiles: string;
  errorFiles: string;
  // -- moving the button, size and technical details (vt-8020 D9) --
  moveHint: string;
  size: string;
  sizes: { sm: string; md: string; lg: string };
  techDetails: string;
  techVersion: string;
  techWindow: string;
  techCapture: string;
  techBuffer: string;
  techServer: string;
  captureOn: string;
  captureOff: string;
  captureStarting: string;
  bufferMemory: string;
  bufferBrowser: string;
  /** "5 minutes" for a capture window of `sec` seconds. */
  windowLength: (sec: number) => string;
}

/** Czech plural: 1 · 2–4 · 5+ (and 0). */
function csPlural(n: number, one: string, few: string, many: string): string {
  if (n === 1) return one;
  if (n >= 2 && n <= 4) return few;
  return many;
}

const en: Strings = {
  button: 'Report a problem',
  title: 'Report a problem',
  close: 'Close',
  settings: 'Settings',
  prompt: 'What went wrong?',
  placeholder: 'Tell us what happened and what you expected',
  attached: (sec) => {
    if (sec < 60) return `The last ${sec} seconds are attached`;
    const min = Math.round(sec / 60);
    return min === 1 ? 'The last minute is attached' : `The last ${min} minutes are attached`;
  },
  included: 'What’s included',
  incReplay: 'A replay of what happened on this page',
  incReplayMasked: {
    strict: 'Text on the page and anything you typed are hidden in it',
    balanced: 'Anything you typed is hidden in it',
    full: 'It shows the page as you saw it',
  },
  incErrors: 'Errors the page ran into',
  incConsole: 'Messages from the browser console',
  incNetwork: 'Which addresses the page loaded, with their status',
  incFailedRequests: 'Requests that failed — address and status only',
  incEnv: 'Your browser, screen size, language and this page’s address',
  incIdentity: 'Your name and email from this app',
  incMarks: 'The places you marked, with your notes',
  showWhere: 'Show us where',
  kinds: { bug: 'Bug', suggestion: 'Suggestion', question: 'Question', other: 'Other' },
  kindsLabel: 'What is it?',
  linesEmpty: 'Each place you mark gets a line here for its note.',
  notify: 'Email me when it’s fixed',
  send: 'Send',
  sending: 'Sending…',
  retry: 'Try again',
  errorCreate: 'Couldn’t send — your text is safe, try again',
  errorCapture: 'Your report arrived, the recording not yet — try again to attach it',
  sentTitle: 'Thanks — we’ve got it',
  sentBody: 'The team will take a look.',
  sentNotify: 'We’ll email you when it’s fixed.',
  seeReport: 'See your report',
  tools: { circle: 'Circle', box: 'Box', arrow: 'Arrow', hide: 'Cover' },
  toolbar: 'Marking tools',
  barLead: 'Mark where the problem is',
  barLeadHide: 'Cover what the team shouldn’t see',
  cancelMarking: 'Cancel',
  discardMarks: (n) => (n === 1 ? 'Discard 1 mark?' : `Discard ${n} marks?`),
  discard: 'Discard',
  keep: 'Keep',
  coach: {
    box: 'Click, hold and move across the problem.',
    circle: 'Click, hold and move around the problem.',
    arrow: 'Click, hold and move from a clear spot to the problem.',
    hide: 'Click, hold and move across anything private — it stays blank in what you send.',
  },
  coachMore: 'You can mark more than one place.',
  coachDismiss: 'Got it, don’t show again',
  coachSetting: 'Marking tips',
  marking: 'Marking',
  keyboardHint: 'Keyboard: Enter to start, arrows to move, Shift+arrows to resize, Enter to place.',
  hidden: 'Covered — not sent',
  notePlaceholder: 'Add a note (optional)',
  mark: (n) => `Mark ${n}`,
  removeMark: (n) => `Remove mark ${n}`,
  shortcut: 'Keyboard shortcut',
  shortcutHint: 'Opens Report a problem anywhere in this app.',
  notSet: 'Not set',
  recordShortcut: 'Record a new shortcut',
  pressKeys: 'Press keys · Esc cancels',
  needModifier: 'Add Ctrl, Alt or ⌘ — a key on its own would get in the way of typing',
  removeShortcut: 'Remove',
  back: 'Back',
  account: 'Your account',
  menu: 'Menu',
  anonymous: 'Not signed in',
  anonymousHint: 'The team checks your report before it’s filed.',
  signedInByApp: 'Signed in by this app',
  linkVitrinka: 'Link your vitrinka account',
  linkedAs: (who) => `Linked to vitrinka as ${who}`,
  unlink: 'Unlink',
  myReports: 'My reports',
  recentRecordings: 'Recent recordings',
  record: 'Record',
  recordHasDraft: 'Send or clear the report you started first',
  openVitrinka: 'Open vitrinka',
  openPortal: 'Open the report portal',
  loading: 'Loading…',
  listFailed: 'Couldn’t load — try again',
  noReports: 'No reports yet.',
  noRecordings: 'No recordings yet.',
  fromThisBrowser: 'Sent from this browser',
  steps: { received: 'Received', planned: 'Planned', in_progress: 'In progress', fixed: 'Fixed', done: 'Done' },
  waiting: 'Waiting for approval',
  sentQueued: 'The team checks it before it’s filed.',
  linkCode: 'Your code',
  linkHint: 'Approve this code in vitrinka — on this device or another one where you’re signed in.',
  linkWaiting: 'Waiting for approval…',
  linkExpired: 'The code expired.',
  linkFailed: 'Linking didn’t work.',
  attach: 'Attach a file',
  removeFile: (name) => `Remove ${name}`,
  fileTooBig: (name, cap) => `${name} is over the ${cap} limit`,
  tooManyFiles: (n) => (n === 1 ? 'Up to 1 file per report' : `Up to ${n} files per report`),
  fileType: (name, types) => `${name} can’t be attached — ${types} only`,
  typeNames: { image: 'images', pdf: 'PDF', text: 'text files', office: 'office documents' },
  incFiles: 'The files you attached',
  errorFiles: 'Your report arrived, a file not yet — try again to attach it',
  moveHint: 'Click, hold and move it to another corner, or press Alt and an arrow key.',
  size: 'Size',
  sizes: { sm: 'Small', md: 'Medium', lg: 'Large' },
  techDetails: 'Technical details',
  techVersion: 'Version',
  techWindow: 'Capture window',
  techCapture: 'Capture',
  techBuffer: 'Buffer',
  techServer: 'Server',
  captureOn: 'Running',
  captureOff: 'Off',
  captureStarting: 'Starting…',
  bufferMemory: 'In memory',
  bufferBrowser: 'In this browser',
  windowLength: (sec) => {
    if (sec < 60) return sec === 1 ? '1 second' : `${sec} seconds`;
    const min = Math.round(sec / 60);
    return min === 1 ? '1 minute' : `${min} minutes`;
  },
};

const cs: Strings = {
  button: 'Nahlásit problém',
  title: 'Nahlásit problém',
  close: 'Zavřít',
  settings: 'Nastavení',
  prompt: 'Co se pokazilo?',
  placeholder: 'Napište, co se stalo a co jste čekali',
  attached: (sec) => {
    if (sec < 60) {
      return csPlural(sec, 'Poslední sekunda je přiložena', `Poslední ${sec} sekundy jsou přiloženy`, `Posledních ${sec} sekund je přiloženo`);
    }
    const min = Math.round(sec / 60);
    return csPlural(min, 'Poslední minuta je přiložena', `Poslední ${min} minuty jsou přiloženy`, `Posledních ${min} minut je přiloženo`);
  },
  included: 'Co je přiloženo',
  incReplay: 'Záznam toho, co se na stránce dělo',
  incReplayMasked: {
    strict: 'Texty stránky i vše, co jste napsali, jsou v něm skryté',
    balanced: 'Vše, co jste napsali, je v něm skryté',
    full: 'Ukazuje stránku tak, jak jste ji viděli',
  },
  incErrors: 'Chyby, na které stránka narazila',
  incConsole: 'Zprávy z konzole prohlížeče',
  incNetwork: 'Které adresy stránka načítala a s jakým výsledkem',
  incFailedRequests: 'Požadavky, které selhaly — jen adresa a výsledek',
  incEnv: 'Váš prohlížeč, velikost obrazovky, jazyk a adresa stránky',
  incIdentity: 'Vaše jméno a e-mail z této aplikace',
  incMarks: 'Místa, která jste označili, i s poznámkami',
  showWhere: 'Ukažte nám kde',
  kinds: { bug: 'Chyba', suggestion: 'Návrh', question: 'Dotaz', other: 'Jiné' },
  kindsLabel: 'Co to je?',
  linesEmpty: 'Každé označené místo tu dostane řádek pro poznámku.',
  notify: 'Pošlete mi e-mail, až to bude opravené',
  send: 'Odeslat',
  sending: 'Odesílám…',
  retry: 'Zkusit znovu',
  errorCreate: 'Nepodařilo se odeslat — váš text zůstal, zkuste to znovu',
  errorCapture: 'Hlášení dorazilo, záznam zatím ne — zkuste to znovu a přiložíme ho',
  sentTitle: 'Díky — máme to',
  sentBody: 'Tým se na to podívá.',
  sentNotify: 'Až to bude opravené, pošleme vám e-mail.',
  seeReport: 'Zobrazit hlášení',
  tools: { circle: 'Kruh', box: 'Obdélník', arrow: 'Šipka', hide: 'Zakrýt' },
  toolbar: 'Nástroje pro označení',
  barLead: 'Označte, kde je problém',
  barLeadHide: 'Zakryjte, co tým nemá vidět',
  cancelMarking: 'Zrušit',
  discardMarks: (n) => csPlural(n, 'Zahodit 1 značku?', `Zahodit ${n} značky?`, `Zahodit ${n} značek?`),
  discard: 'Zahodit',
  keep: 'Ponechat',
  coach: {
    box: 'Klikněte, podržte a veďte přes problém.',
    circle: 'Klikněte, podržte a veďte kolem problému.',
    arrow: 'Klikněte, podržte a veďte z volného místa k problému.',
    hide: 'Klikněte, podržte a veďte přes vše soukromé — v hlášení zůstane prázdné.',
  },
  coachMore: 'Označit můžete i více míst.',
  coachDismiss: 'Chápu, už nezobrazovat',
  coachSetting: 'Nápověda při označování',
  marking: 'Označování',
  keyboardHint: 'Klávesnice: Enter začne, šipky posouvají, Shift+šipky mění velikost, Enter umístí.',
  hidden: 'Zakryto — neodešle se',
  notePlaceholder: 'Přidejte poznámku (nepovinné)',
  mark: (n) => `Značka ${n}`,
  removeMark: (n) => `Odebrat značku ${n}`,
  shortcut: 'Klávesová zkratka',
  shortcutHint: 'Otevře Nahlásit problém kdekoli v této aplikaci.',
  notSet: 'Nenastavena',
  recordShortcut: 'Nahrát novou zkratku',
  pressKeys: 'Stiskněte klávesy · Esc zruší',
  needModifier: 'Přidejte Ctrl, Alt nebo ⌘ — samotná klávesa by překážela při psaní',
  removeShortcut: 'Odebrat',
  back: 'Zpět',
  account: 'Váš účet',
  menu: 'Nabídka',
  anonymous: 'Nepřihlášeno',
  anonymousHint: 'Hlášení nejdřív zkontroluje tým.',
  signedInByApp: 'Přihlášen touto aplikací',
  linkVitrinka: 'Propojit s vitrinkou',
  linkedAs: (who) => `Propojeno s vitrinkou jako ${who}`,
  unlink: 'Odpojit',
  myReports: 'Moje hlášení',
  recentRecordings: 'Nedávné nahrávky',
  record: 'Nahrávat',
  recordHasDraft: 'Odešlete nebo smažte rozepsané hlášení',
  openVitrinka: 'Otevřít vitrinku',
  openPortal: 'Otevřít portál hlášení',
  loading: 'Načítám…',
  listFailed: 'Nepodařilo se načíst — zkuste to znovu',
  noReports: 'Zatím žádná hlášení.',
  noRecordings: 'Zatím žádné nahrávky.',
  fromThisBrowser: 'Odesláno z tohoto prohlížeče',
  steps: { received: 'Přijato', planned: 'Naplánováno', in_progress: 'Řešíme', fixed: 'Opraveno', done: 'Hotovo' },
  waiting: 'Čeká na schválení',
  sentQueued: 'Než ho zařadíme, tým ho zkontroluje.',
  linkCode: 'Váš kód',
  linkHint: 'Schvalte kód ve vitrince — na tomto nebo jiném zařízení, kde jste přihlášeni.',
  linkWaiting: 'Čekám na schválení…',
  linkExpired: 'Kód vypršel.',
  linkFailed: 'Propojení se nepodařilo.',
  attach: 'Přiložit soubor',
  removeFile: (name) => `Odebrat ${name}`,
  fileTooBig: (name, cap) => `${name} přesahuje limit ${cap}`,
  tooManyFiles: (n) => csPlural(n, 'Nejvýš 1 soubor na hlášení', `Nejvýš ${n} soubory na hlášení`, `Nejvýš ${n} souborů na hlášení`),
  fileType: (name, types) => `${name} nelze přiložit — jen ${types}`,
  typeNames: { image: 'obrázky', pdf: 'PDF', text: 'textové soubory', office: 'kancelářské dokumenty' },
  incFiles: 'Soubory, které jste přiložili',
  errorFiles: 'Hlášení dorazilo, soubor zatím ne — zkuste to znovu a přiložíme ho',
  moveHint: 'Klikněte, podržte a veďte ho do jiného rohu, nebo stiskněte Alt a šipku.',
  size: 'Velikost',
  sizes: { sm: 'Malá', md: 'Střední', lg: 'Velká' },
  techDetails: 'Technické údaje',
  techVersion: 'Verze',
  techWindow: 'Okno záznamu',
  techCapture: 'Záznam',
  techBuffer: 'Vyrovnávací paměť',
  techServer: 'Server',
  captureOn: 'Běží',
  captureOff: 'Vypnutý',
  captureStarting: 'Spouští se…',
  bufferMemory: 'V paměti',
  bufferBrowser: 'V tomto prohlížeči',
  windowLength: (sec) => {
    if (sec < 60) return csPlural(sec, '1 sekunda', `${sec} sekundy`, `${sec} sekund`);
    const min = Math.round(sec / 60);
    return csPlural(min, '1 minuta', `${min} minuty`, `${min} minut`);
  },
};

const CATALOGS: Readonly<Record<Locale, Strings>> = { cs, en };

export function strings(locale: Locale): Strings {
  return CATALOGS[locale];
}

/** `cs`, `cs-CZ`, `CS` → cs; `en-GB` → en; anything else → null. */
export function parseLocale(raw: unknown): Locale | null {
  if (typeof raw !== 'string') return null;
  const lang = raw.trim().toLowerCase().split(/[-_]/)[0];
  return lang === 'cs' || lang === 'en' ? lang : null;
}

/** The first of the browser's languages the widget speaks; English otherwise. */
export function browserLocale(): Locale {
  const nav = globalThis.navigator;
  const prefs = nav ? (nav.languages?.length ? nav.languages : [nav.language]) : [];
  for (const p of prefs) {
    const l = parseLocale(p);
    if (l) return l;
  }
  return 'en';
}
