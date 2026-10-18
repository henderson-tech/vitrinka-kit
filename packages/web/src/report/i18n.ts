/**
 * Every string Report a problem shows, one catalog per locale (cs, en). The
 * browser's language picks one by default; the host's `locale` option,
 * `locale` attribute and `setLocale()` switch it live — the widget repaints
 * its text in place, so a draft and its marks survive the switch.
 *
 * Marking is taught as "click, hold and move" — never "drag" (D21): a
 * first-time reporter does not know the word.
 */
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
  /** Leaves marking and drops the marks of this pass (vt-8020 D12). */
  cancelMarking: string;
  discardMarks: (n: number) => string;
  discard: string;
  keep: string;
  coach: string;
  coachMore: string;
  /** The marking layer's name, for assistive technology. */
  marking: string;
  /** How to mark from the keyboard (the layer's description; shown in the coach card). */
  keyboardHint: string;
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
  tools: { circle: 'Circle', box: 'Box', arrow: 'Arrow', hide: 'Hide' },
  toolbar: 'Marking tools',
  barLead: 'Mark where the problem is',
  cancelMarking: 'Cancel',
  discardMarks: (n) => (n === 1 ? 'Discard 1 mark?' : `Discard ${n} marks?`),
  discard: 'Discard',
  keep: 'Keep',
  coach: 'Click, hold and move around the problem.',
  coachMore: 'You can mark more than one place.',
  marking: 'Marking',
  keyboardHint: 'Keyboard: Enter to start, arrows to move, Shift+arrows to resize, Enter to place.',
  hidden: 'Hidden',
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
  tools: { circle: 'Kruh', box: 'Obdélník', arrow: 'Šipka', hide: 'Skrýt' },
  toolbar: 'Nástroje pro označení',
  barLead: 'Označte, kde je problém',
  cancelMarking: 'Zrušit',
  discardMarks: (n) => csPlural(n, 'Zahodit 1 značku?', `Zahodit ${n} značky?`, `Zahodit ${n} značek?`),
  discard: 'Zahodit',
  keep: 'Ponechat',
  coach: 'Klikněte, podržte a veďte kolem problému.',
  coachMore: 'Označit můžete i více míst.',
  marking: 'Označování',
  keyboardHint: 'Klávesnice: Enter začne, šipky posouvají, Shift+šipky mění velikost, Enter umístí.',
  hidden: 'Skryto',
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
