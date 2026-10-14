// Vitrinka Journey Recorder — the ONE recorder endpoint (isolated world).
//
// Extension + page recorder decisions 2026-10-12 (D6): while this extension
// records, a page that embeds @vitrinka/web's recorder must know it — in tabs
// the recording does not capture too — or a second recording starts beside
// it. So this runs in every http(s) top frame for exactly as long as the
// extension records: registered at document_start (the worker's
// registerContentScripts, id "vitrinka-one") and injected into the open tabs
// by a Start/Continue probe. It speaks @vitrinka/web's own codec
// (vendor/vitrinka-one.iife.js, globalThis.VitrinkaOne, injected first):
//
// - it answers `hello` asks only in documents that carry
//   `data-vitrinka-page`, revealing {by, state, here} and nothing else — no
//   session, workspace or URL — so "this person is recording" is not readable
//   by every site;
// - it announces itself when it is installed and says `gone` when the
//   recording ends: an idle page pill in another tab learns of an extension
//   recording only from those announcements or its own Start probe;
// - it writes nothing to the DOM and accepts no command, so a site in another
//   tab can neither pause nor stop the tester's recording.
//
// The worker moves it along with `vt-one` messages ({state, generation};
// state null = the recording ended, `release` = an aborted Start, whose claim
// the probe took in this document, goes with it).

(() => {
  const ONE = globalThis.VitrinkaOne;
  const env = ONE && ONE.documentEnv();
  if (!env) return;
  const prev = globalThis.__vitrinkaOne;
  // Idempotent: a Start's probe re-injects over a registered copy.
  if (prev && !prev.orphaned()) return;
  if (prev) prev.retire(false);

  const runtime = chrome.runtime;
  const self = { from: "extension", inst: ONE.nonce("x") };
  // A Start's probe hands over where its Start stands before it installs this
  // copy; a copy registered at document_start exists only while the extension
  // records: live until told otherwise.
  const handed = globalThis.__vitrinkaOneStart;
  delete globalThis.__vitrinkaOneStart;
  let state = handed ? handed.state : "recording";
  // The recording's generation: the claim a Start's probe (or content.js)
  // takes in a document carries it as its `id`.
  let generation = handed ? handed.generation : "";
  let gone = false;

  // A reloaded or uninstalled extension leaves this script behind with no
  // runtime: it then answers nothing (D5).
  const orphaned = () => {
    try { return !runtime || !runtime.id; } catch { return true; }
  };
  const live = () => {
    const c = ONE.readClaim(env);
    const here = !!generation && !!c && c.by === "extension" && c.id === generation;
    return { by: "extension", state, here, ...(here ? { id: generation } : {}) };
  };
  const speaks = () => {
    if (gone) return false;
    if (orphaned()) {
      retire(false);
      return false;
    }
    return ONE.pageMarked(env);
  };
  const announce = () => {
    if (speaks()) ONE.announce(env, self, live());
  };
  // `set` is the Start probe's door (D13): the endpoint turns `starting` in
  // the same task that reads this document's claim.
  const api = { orphaned, retire, set };
  globalThis.__vitrinkaOne = api;
  const offHello = ONE.serveHello(env, self, live, undefined, { answerIf: speaks });

  function retire(release) {
    if (gone) return;
    gone = true;
    offHello();
    try { runtime.onMessage.removeListener(onMessage); } catch { /* orphaned */ }
    if (release && generation) ONE.releaseClaim(env, generation);
    if (ONE.pageMarked(env)) ONE.announce(env, self, null, { gone: true });
    if (globalThis.__vitrinkaOne === api) delete globalThis.__vitrinkaOne;
  }
  function set(next, gen) {
    if (gone) return;
    if (gen) generation = gen;
    if (next === state) return;
    state = next;
    announce();
  }
  function onMessage(msg) {
    if (!msg || msg.type !== "vt-one") return;
    if (!msg.state) retire(!!msg.release);
    else set(msg.state, typeof msg.generation === "string" ? msg.generation : "");
  }
  runtime.onMessage.addListener(onMessage);

  // A copy registered at document_start learns the state from the worker's
  // record of it; none means the registration outlived its recording.
  chrome.storage.local.get("oneState").then(({ oneState }) => {
    if (gone) return;
    if (!oneState || !oneState.state) retire(false);
    else set(oneState.state, oneState.generation);
  }, () => undefined);

  // Installed into an open tab: a page recorder there hears it at once.
  announce();
})();
