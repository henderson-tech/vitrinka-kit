// Vitrinka Journey Recorder — content script (isolated world).
// Captures clicks (selector + text + rect in image px), records the DOM via
// rrweb (vendor/rrweb-record.min.js injected before this file), and renders
// the corner HUD (D10 take A): rec dot · timer · pause · note · snap, plus
// the element-pick/region-drag snap flow. All UI lives in an OPEN shadow root
// (e2e asserts into it) — style isolation only; the page can reach in, which
// is acceptable for a dev tool. Idempotent: re-injection (SPA navs,
// SW restarts) is a no-op while the previous instance is alive.

(() => {
  if (window.__vitrinkaRecorder) return;
  window.__vitrinkaRecorder = true;

  const send = (msg) => new Promise((res) => {
    try { chrome.runtime.sendMessage(msg, res); } catch { res(null); }
  });

  // -------------------------------------------------------------------------
  // click capture (capture phase — sees clicks the app swallows)

  const shortSelector = (el) => {
    if (!(el instanceof Element)) return "";
    if (el.id) return `#${el.id}`;
    const t = el.getAttribute("data-testid") || el.getAttribute("data-test");
    if (t) return `[data-testid="${t}"]`;
    const parts = [];
    let n = el;
    while (n instanceof Element && parts.length < 4) {
      let p = n.tagName.toLowerCase();
      if (n.classList.length) p += "." + [...n.classList].slice(0, 2).join(".");
      parts.unshift(p);
      if (n.id) { parts[0] = `#${n.id}`; break; }
      n = n.parentElement;
    }
    return parts.join(" > ");
  };

  const imageRect = (el) => {
    const r = el.getBoundingClientRect();
    const s = window.devicePixelRatio || 1;
    return { x: Math.round(r.x * s), y: Math.round(r.y * s), w: Math.round(r.width * s), h: Math.round(r.height * s) };
  };

  document.addEventListener("click", (e) => {
    if (picking) return; // pick mode owns the click
    const el = e.target instanceof Element ? (e.target.closest("a,button,[role=button],input,select,textarea,label") || e.target) : null;
    if (!el || hud.contains(el)) return;
    send({
      type: "vt-click", route: location.pathname,
      payload: {
        selector: shortSelector(el),
        text: (el.innerText || el.value || "").trim().slice(0, 80),
        rect: imageRect(el),
      },
    });
  }, true);

  // -------------------------------------------------------------------------
  // rrweb (D3): batch events to the SW every 2s; SW uploads them as chunks

  let rrBuf = [];
  try {
    // rrweb ≥2.x UMD exposes a module object ({record}); ≤alpha.4 exposed the
    // bare function. Accept both so a bundle swap can't silently stop recording.
    const rrRec = typeof rrwebRecord === "function" ? rrwebRecord
      : (typeof rrwebRecord === "object" && rrwebRecord && rrwebRecord.record);
    if (typeof rrRec === "function") {
      // collectFonts (rrweb-replay decisions D6): fonts become data URLs in
      // the event stream so replay is faithful without a proxy. inlineImages
      // stays OFF: on a tainted canvas rrweb sets crossOrigin="anonymous" on
      // the LIVE page's <img>, which re-fetches it in CORS mode and breaks
      // every presigned or no-CORS image the tester is looking at (FixIt
      // #2904, the kit recorder's CRIT-1) — images replay hotlinked instead.
      // The SW splits oversized batches into size-bounded
      // chunks (splitRRWebEvents), letting a big full snapshot ride alone up
      // to the 12 MiB wire cap; a single event beyond even that is
      // undeliverable — it is dropped AND surfaced as a ⚠ note on the
      // session timeline (replay may be incomplete from there).
      //
      // Redaction (SaaS data-security 2026-08-23 #2): ask the SW for the
      // workspace policy first — maskAllInputs is the fail-closed DEFAULT
      // (an unreachable SW still records with every input masked), the
      // policy can only add maskAllText or, self-host only, fullFidelity.
      // The one-message wait costs milliseconds before the full snapshot.
      send({ type: "vt-policy" }).then((r) => {
        try {
          const pol = (r && r.policy) || null;
          const opts = { emit: (ev) => rrBuf.push(ev), inlineImages: false, collectFonts: true };
          if (!(pol && pol.fullFidelity)) {
            opts.maskAllInputs = true;
            if (pol && pol.maskAllText) {
              opts.maskAllText = true;      // rrweb ≥2.x spelling
              opts.maskTextSelector = "*";  // alpha-era spelling
            }
          }
          rrRec(opts);
        } catch (e) { console.warn("vitrinka: rrweb failed to start", e); }
      });
    }
  } catch (e) { console.warn("vitrinka: rrweb failed to start", e); }
  let rrInFlight = false;
  const rrTimer = setInterval(async () => {
    if (!rrBuf.length || rrInFlight) return;
    const events = rrBuf;
    rrBuf = [];
    rrInFlight = true;
    const r = await send({ type: "vt-rrweb", events });
    rrInFlight = false;
    if (!r || r.ok === false) {
      // Upload failed (or SW unreachable) — keep the batch, retry next tick.
      rrBuf = events.concat(rrBuf);
    }
  }, 2000);

  // Console errors are captured via CDP Runtime in the background SW — an
  // isolated-world console.error wrap only ever saw the extension's own calls.

  // -------------------------------------------------------------------------
  // Web Vitals per step (sessions-UI D8): LCP / CLS / INP for THIS page load,
  // reported once — after the metrics settle (10s past load or first hide),
  // whichever comes first. Real navigations re-inject the script, so each
  // loaded document contributes one vitals event to its step.

  let vitals = { lcp: null, cls: 0, inp: null };
  let vitalsSent = false;
  const vitalsObservers = [];
  try {
    const obs = (type, cb, opts) => {
      const o = new PerformanceObserver((list) => list.getEntries().forEach(cb));
      o.observe({ type, buffered: true, ...opts });
      vitalsObservers.push(o);
    };
    obs("largest-contentful-paint", (e) => { vitals.lcp = e.startTime; });
    obs("layout-shift", (e) => { if (!e.hadRecentInput) vitals.cls += e.value; });
    // INP approximation: worst event duration past the 40ms threshold.
    obs("event", (e) => {
      if (vitals.inp === null || e.duration > vitals.inp) vitals.inp = e.duration;
    }, { durationThreshold: 40 });
  } catch { /* older engine — vitals stay unreported */ }
  const sendVitals = () => {
    if (vitalsSent || (vitals.lcp === null && !vitals.cls && vitals.inp === null)) return;
    vitalsSent = true;
    vitalsObservers.forEach((o) => { try { o.disconnect(); } catch { /* already gone */ } });
    send({ type: "vt-vitals", payload: {
      lcp: vitals.lcp, cls: Math.round(vitals.cls * 1000) / 1000, inp: vitals.inp,
      url: location.href, route: location.pathname,
    } });
  };
  const vitalsTimer = setTimeout(sendVitals, 10000);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") sendVitals();
  });
  addEventListener("pagehide", sendVitals);

  // -------------------------------------------------------------------------
  // corner HUD (closed shadow root)

  const hud = document.createElement("div");
  hud.style.cssText = "all:initial;position:fixed;z-index:2147483647;right:20px;bottom:20px;";
  const root = hud.attachShadow({ mode: "open" }); // open: e2e asserts into it
  // Manifest icons: vendor/vitrinka-icons.js is injected ahead of this script
  // (background.js executeScript files list). Icon markup only — user/server
  // strings NEVER ride innerHTML, they are appended as text nodes.
  const I = (name, cls) => (globalThis.VT_ICONS ? VT_ICONS.html(name, cls) : "");
  // Keycap prefix for the manifest commands (Alt+Shift+…): the platform's glyphs.
  const MOD = /Mac|iPhone|iPad/.test(navigator.platform) ? "⌥⇧" : "Alt⇧";
  root.innerHTML = `
    <style>
      * { box-sizing: border-box; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; }
      /* manifest icons (vendor/vitrinka-icons.js): 1em, currentColor, sized by the host's font */
      svg { width:1em; height:1em; vertical-align:-.125em; }
      .stack { display:flex; flex-direction:column; align-items:flex-end; gap:6px; }
      .pill { display:flex; align-items:center; gap:10px; padding:8px 10px 8px 14px;
        background:#1d1a1b; border:1px solid #292526; border-radius:999px;
        box-shadow:0 8px 30px rgba(0,0,0,.35); color:#f0eae4; }
      .dot { width:10px; height:10px; border-radius:50%; background:#ff3b57; animation:p 1.4s ease infinite; }
      .paused .dot { animation:none; background:#756e68; }
      @keyframes p { 50% { opacity:.35; } }
      /* Health (recorder-live D4): one glyph at rest, a second line only when
         something is actually wrong — or while Stop drains. */
      .sync { font:600 11px/1 ui-monospace, Menlo, monospace; color:#5f7a5f; }
      .sync.warn { color:#e8a33d; }
      .sync.bad { color:#ff3b57; }
      .sync.busy { color:#a8a099; }
      .detail { max-width:320px; padding:6px 12px; border-radius:999px;
        background:#1d1a1b; border:1px solid #292526; color:#a8a099;
        font:500 10px/1.4 ui-monospace, Menlo, monospace;
        opacity:0; transform:translateY(-3px); transition:opacity .24s ease, transform .24s ease;
        pointer-events:none; }
      .detail.show { opacity:1; transform:none; }
      .detail.bad { border-color:#ff3b57; color:#f0eae4; }
      /* pair-mode narration: the listening/fixing micro-label (mono, quiet) */
      .pairline { max-width:320px; padding:6px 12px; border-radius:999px;
        background:#1d1a1b; border:1px solid #292526; color:#756e68;
        font:500 10px/1.4 ui-monospace, Menlo, monospace;
        opacity:0; transform:translateY(-3px); transition:opacity .24s ease, transform .24s ease;
        pointer-events:none; }
      .pairline.show { opacity:1; transform:none; }
      .pairline.busy { color:#e8d5a3; }
      .pairline.click { pointer-events:auto; cursor:pointer; }
      /* pair panel (pair-panel 2026-08-29): the pairline grown into a quiet
         column — mono micro-labels, progressive disclosure, collapsed by
         default. Opens by clicking the pairline. */
      .pairpanel { display:none; width:320px; max-height:46vh; overflow:auto;
        padding:10px 12px; background:#1d1a1b; border:1px solid #292526;
        border-radius:14px; box-shadow:0 8px 30px rgba(0,0,0,.35);
        font:500 10px/1.5 ui-monospace, Menlo, monospace; color:#a8a099;
        text-align:left; pointer-events:auto; }
      .pairpanel.open { display:block; }
      .pp-head { display:flex; justify-content:space-between; gap:8px;
        font:700 9px/1 ui-monospace, Menlo, monospace; letter-spacing:.18em;
        text-transform:uppercase; color:#756e68; margin-bottom:7px; }
      .pp-item { display:flex; gap:7px; align-items:baseline; padding:2px 0; cursor:pointer; }
      .pp-item:hover .pp-t { color:#f0eae4; }
      .pp-g { flex:none; width:12px; text-align:center; }
      .pp-g.s-open { color:#e8a33d; } .pp-g.s-working { color:#e8d5a3; }
      .pp-g.s-in_review { color:#5f7a5f; } .pp-g.s-resolved { color:#5f7a5f; }
      .pp-g.s-staged, .pp-g.s-cancelled { color:#756e68; }
      .pp-t { flex:1; color:#d8d2cc; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
      .pp-t.done { color:#756e68; text-decoration:line-through; }
      .pp-no { flex:none; color:#756e68; }
      .pp-detail { margin:2px 0 8px 19px; }
      .pp-tl { color:#756e68; margin:2px 0 4px; }
      .pp-msg { margin:2px 0; white-space:pre-wrap; word-break:break-word; }
      .pp-msg b { color:#756e68; font-weight:700; }
      .pp-msg a, .pp-relay a { color:#e8d5a3; text-decoration:none; }
      .pp-msg a:hover { text-decoration:underline; }
      .pp-row { display:flex; gap:6px; margin-top:6px; align-items:center; }
      .pp-in { flex:1; min-width:0; background:#141213; border:1px solid #363132;
        border-radius:7px; color:#f0eae4; font:inherit; padding:5px 8px; outline:none; }
      .pp-in:focus { border-color:#756e68; }
      .pp-b { all:unset; cursor:pointer; flex:none; padding:4px 8px; border-radius:6px;
        color:#a8a099; border:1px solid #363132; font:inherit; }
      .pp-b:hover { color:#f0eae4; border-color:#756e68; }
      .pp-b.ok:hover { color:#5f7a5f; } .pp-b.no:hover { color:#e8a33d; }
      .pp-relay { margin-top:8px; padding-top:6px; border-top:1px solid #292526;
        color:#756e68; font-size:9.5px; white-space:pre-wrap; word-break:break-word; }
      .pp-err { color:#ff3b57; margin-top:4px; }
      .time { font:600 11px/1 ui-monospace, Menlo, monospace; }
      .name { font:500 10px/1 ui-monospace, Menlo, monospace; color:#756e68;
        border-left:1px solid #292526; padding-left:10px; max-width:140px;
        overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
      button { all:unset; cursor:pointer; position:relative; width:28px; height:28px; border-radius:50%;
        border:1px solid #363132; color:#a8a099; font-size:12px; text-align:center; line-height:28px; }
      button:hover { color:#f0eae4; border-color:#756e68; }
      button:focus-visible, .sendb:focus-visible, .closeb:focus-visible { outline:2px solid #ff3b57; outline-offset:2px; }
      button.snap { background:#ff3b57; border-color:#ff3b57; color:#fff; }
      /* Keycaps (recorder-hud-polish D1): the shortcut above the hovered or
         focused button — quiet at rest, discoverable on intent. One at a
         time: three caps over three 28px buttons would overlap. Right-
         anchored on the last button so it never leaves the viewport; hidden
         while the sheet is open so it never sits on its bottom edge. */
      kbd { position:absolute; left:50%; bottom:calc(100% + 8px); transform:translateX(-50%);
        padding:4px 6px; border-radius:5px; background:#252122; border:1px solid #363132;
        color:#a8a099; font:600 9.5px/1 ui-monospace, Menlo, monospace; letter-spacing:.06em;
        white-space:nowrap; opacity:0; transition:opacity .16s ease; pointer-events:none; }
      .b-snap kbd { left:auto; right:0; transform:none; }
      button:hover kbd, button:focus-visible kbd { opacity:1; }
      .pill.composing kbd { opacity:0; }
      /* The pick chrome (dim, outline, hint) lives in this shadow root too;
         the stack and the sheet sit above it. */
      .stack { position:relative; z-index:4; }
      /* The sheet (recorder-hud-polish D2 · recorder-iframe vt-2985) is an
         extension-origin IFRAME (hud.html): a page's focus trap cannot pull
         focus back from another document, and its keystrokes never reach
         the page. The frame is sized by the sheet inside it; only placement
         and open/close live here. */
      .pop { position:absolute; right:0; bottom:52px; z-index:4; width:360px; height:0;
        border:0; background:transparent; display:none; color-scheme:normal; }
      .pop.open { display:block; }
    </style>
    <div class="stack">
      <div class="pill" part="pill">
        <span class="dot"></span>
        <span class="time">00:00</span>
        <span class="name"></span>
        <span class="sync" data-icon="check" title="everything captured has reached vitrinka">${I("check")}</span>
        <button class="b-pause" aria-label="Pause">${I("pause")}<kbd>${MOD}P pause</kbd></button>
        <button class="b-note" aria-label="Note">${I("pencil")}<kbd>${MOD}N note</kbd></button>
        <button class="snap b-snap" aria-label="Snap to vitrinka">${I("annotate")}<kbd>${MOD}A annotate</kbd></button>
      </div>
      <div class="detail"></div>
      <div class="pairline"></div>
      <div class="pairpanel">
        <div class="pp-head"><span>pair</span><span class="pp-state"></span></div>
        <div class="pp-list"></div>
        <div class="pp-row">
          <input class="pp-in pp-new" placeholder="report a bug — enter sends" />
        </div>
        <div class="pp-relay" style="display:none"></div>
        <div class="pp-err" style="display:none"></div>
      </div>
    </div>
    <iframe class="pop" title="vitrinka composer"></iframe>`;
  // Shield (recorder-hud-polish): nothing the tester does on the HUD reaches
  // the host page. Shadow retargeting makes every event look like it happened
  // on the host div, and a page's "close on outside pointerdown / focus" logic
  // would close the very dialog being reported. Bubble-phase stops on the
  // host — no preventDefault, so buttons and the textarea still focus. Pick
  // mode keeps its own document-level capture handlers.
  for (const t of ["pointerdown", "pointerup", "pointermove", "pointerover", "pointerout", "pointercancel",
    "mousedown", "mouseup", "mousemove", "mouseover", "mouseout", "click", "dblclick", "auxclick", "contextmenu",
    "touchstart", "touchend", "touchmove", "touchcancel", "wheel",
    "focusin", "focusout", "keydown", "keyup", "keypress"]) {
    hud.addEventListener(t, (e) => e.stopPropagation());
  }

  const $ = (sel) => root.querySelector(sel);
  const pill = $(".pill"), pop = $(".pop");
  const syncEl = $(".sync"), detailEl = $(".detail"), pairEl = $(".pairline");

  // Pair surface (pair 2026-08-28 #2 + pair-panel 2026-08-29): the pairline
  // is the collapsed pill — narration/listening plus an item count — and
  // clicking it unfolds the panel: every pair item as title + live status,
  // expandable into its thread + status timeline + commit links, with a
  // reply box, accept/bounce, and a new-item box. Frames arrive over the
  // background worker's websocket ("vt-pair-frame"); the legacy ~5s poll
  // ("vt-pair") keeps the line honest whenever the socket is down. All
  // writes go through the worker, over REST — the panel never invents state,
  // it renders echoes.
  const panelEl = $(".pairpanel"), listEl = $(".pp-list"), stateEl = $(".pp-state");
  const relayEl = $(".pp-relay"), errEl = $(".pp-err"), newInput = $(".pp-new");
  const pp = {
    seen: false, open: false, wsUp: false, listening: false, working: null,
    items: [], replies: {}, timeline: {}, relay: [], threads: {}, expanded: 0,
  };
  let pollPair = null; // last legacy poll answer (fallback wire)

  const esc = (s) => String(s).replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  // Linkify plain URLs; commit pills arrive separately (server-verified).
  const richText = (s) => esc(s).replace(/(https?:\/\/[^\s<]+)/g,
    (u) => `<a href="${u}" target="_blank" rel="noreferrer">${u}</a>`);
  const STATUS_ICON = { staged: "circle-dashed", open: "circle", working: "loader", in_review: "circle-dot", resolved: "check", cancelled: "circle-x" };
  const openish = (st) => st === "open" || st === "working" || st === "in_review";
  const hhmm = (iso) => {
    const d = new Date(iso);
    return isNaN(d) ? "" : `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  };
  const showErr = (msg) => {
    errEl.textContent = msg || "";
    errEl.style.display = msg ? "block" : "none";
  };

  const renderPairLine = () => {
    const working = pp.working || (pollPair && pollPair.status
      ? { status: pollPair.status, actor: pollPair.actor } : null);
    const listening = pp.seen ? pp.listening : !!(pollPair && pollPair.listening);
    // icon = the state marker (manifest svg), text = the words beside it —
    // actor/status arrive from the server, so they are appended as text.
    let icon = "", text = "", busy = false;
    if (working && working.status) {
      icon = "loader";
      text = (working.actor ? working.actor + " · " : "") + working.status;
      busy = true;
    } else if (listening) {
      icon = "circle-dot"; text = "claude listening";
    }
    if (pp.items.length) {
      const n = pp.items.filter((i) => openish(i.status)).length;
      text += (text ? " · " : "") + `${n}/${pp.items.length} open`;
    }
    // Even a quiet session keeps the pill reachable: with no narration, no
    // listener and no items yet, the panel is still where you TYPE the first
    // bug — an invisible opener made the new-item box unreachable exactly
    // when it matters most (r3886550912).
    if (!text && pp.seen) { icon = "circle-dashed"; text = "pair"; }
    const line = !!text;
    pairEl.textContent = "";
    if (line) {
      if (icon) pairEl.insertAdjacentHTML("beforeend", I(icon) + " ");
      pairEl.append(text);
      if (pp.seen) pairEl.insertAdjacentHTML("beforeend", " " + I(pp.open ? "chevron-down" : "chevron-right"));
    }
    pairEl.classList.toggle("show", line);
    pairEl.classList.toggle("busy", busy);
    pairEl.classList.toggle("click", pp.seen && line);
    // a11y (r3886550925): the pill is a disclosure button.
    if (pp.seen && line) {
      pairEl.setAttribute("role", "button");
      pairEl.setAttribute("tabindex", "0");
      pairEl.setAttribute("aria-expanded", pp.open ? "true" : "false");
      pairEl.setAttribute("aria-label", "pair panel: " + text);
    } else {
      pairEl.removeAttribute("role");
      pairEl.removeAttribute("tabindex");
      pairEl.removeAttribute("aria-expanded");
    }
  };

  const threadHTML = (id) => {
    const ann = pp.threads[id];
    const rows = [];
    const tl = pp.timeline[id] || [];
    if (tl.length) {
      rows.push(`<div class="pp-tl">${tl.map((s) => `${esc(s.status)} ${hhmm(s.at)}`).join(" → ")}</div>`);
    }
    const msgs = [];
    if (ann) {
      if (ann.prompt) msgs.push({ author: "you", body: ann.prompt, commits: [] });
      for (const m of ann.messages || []) msgs.push(m);
    }
    for (const m of pp.replies[id] || []) {
      // Live echoes of replies that landed after the thread fetch.
      if (!msgs.some((x) => x.id && m.id && x.id === m.id)) msgs.push(m);
    }
    for (const m of msgs) {
      let commits = "";
      for (const c of m.commits || []) {
        commits += ` <a href="https://github.com/${esc(c.repo)}/commit/${esc(c.sha)}" target="_blank" rel="noreferrer">${esc(c.sha.slice(0, 7))}</a>`;
      }
      rows.push(`<div class="pp-msg"><b>${esc((m.author || "?").toUpperCase())}</b> ${richText(m.body || "")}${commits}</div>`);
    }
    const it = pp.items.find((x) => x.id === id) || {};
    const verdicts = it.status === "in_review" || it.status === "resolved"
      ? `<button class="pp-b ok" data-act="accept" data-id="${id}" title="accept — fix verified" aria-label="accept — fix verified">${I("check")}</button>
         <button class="pp-b no" data-act="bounce" data-id="${id}" title="bounce — still broken" aria-label="bounce — still broken">${I("undo")}</button>` : "";
    return `<div class="pp-detail">${rows.join("")}
      <div class="pp-row">
        <input class="pp-in pp-reply" data-id="${id}" placeholder="reply — enter sends" aria-label="reply to item №${id}" />${verdicts}
      </div></div>`;
  };

  const renderPanel = () => {
    renderPairLine();
    panelEl.classList.toggle("open", pp.open && pp.seen);
    if (!pp.open || !pp.seen) return;
    stateEl.textContent = (pp.listening ? "listening" : "no listener") + (pp.wsUp ? "" : " · poll");
    // Preserve what the tester is typing across live-frame rebuilds.
    const live = root.activeElement;
    const keep = live && live.classList && live.classList.contains("pp-in")
      ? { reply: live.classList.contains("pp-reply") ? live.dataset.id : null, value: live.value, pos: live.selectionStart } : null;
    let html = "";
    for (const it of pp.items) {
      const g = I(STATUS_ICON[it.status] || "circle-dashed");
      html += `<div class="pp-item" data-id="${it.id}" role="button" tabindex="0" aria-expanded="${pp.expanded === it.id}">
        <span class="pp-g s-${esc(it.status)}" data-status="${esc(it.status)}">${g}</span>
        <span class="pp-t${it.status === "resolved" || it.status === "cancelled" ? " done" : ""}">${esc(it.title || "(untitled)")}</span>
        <span class="pp-no">№${it.id}</span></div>`;
      if (pp.expanded === it.id) html += threadHTML(it.id);
    }
    if (!pp.items.length) html = `<div class="pp-tl">no items yet — ${I("annotate")} snap or type below</div>`;
    listEl.innerHTML = html;
    listEl.querySelectorAll(".pp-item").forEach((el) => {
      el.addEventListener("click", () => toggleItem(Number(el.dataset.id)));
      el.addEventListener("keydown", (e) => {
        if (e.key === "Enter" || e.key === " ") { e.preventDefault(); toggleItem(Number(el.dataset.id)); }
      });
    });
    listEl.querySelectorAll(".pp-reply").forEach((el) => {
      el.addEventListener("keydown", (e) => {
        e.stopPropagation();
        if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendReply(Number(el.dataset.id), el); }
      });
    });
    listEl.querySelectorAll("[data-act]").forEach((el) => {
      el.addEventListener("click", (e) => {
        e.stopPropagation();
        verdict(el.dataset.act, Number(el.dataset.id));
      });
    });
    if (keep && keep.reply) {
      const el = listEl.querySelector(`.pp-reply[data-id="${keep.reply}"]`);
      if (el) { el.value = keep.value; el.focus(); try { el.setSelectionRange(keep.pos, keep.pos); } catch { /* ok */ } }
    }
    const tail = pp.relay.slice(-3);
    relayEl.style.display = tail.length ? "block" : "none";
    relayEl.innerHTML = tail.map((l) => richText(l.text)).join("<br>");
  };

  const toggleItem = (id) => {
    pp.expanded = pp.expanded === id ? 0 : id;
    showErr("");
    if (pp.expanded && !pp.threads[id]) {
      send({ type: "vt-pair-thread", id }).then((r) => {
        if (r && r.ok) { pp.threads[id] = r.annotation; renderPanel(); }
      });
    }
    renderPanel();
  };
  const sendReply = (id, el) => {
    const body = el.value.trim();
    if (!body) return;
    el.value = "";
    send({ type: "vt-pair-reply", id, body }).then((r) => {
      if (!r || !r.ok) { el.value = body; showErr((r && r.error) || "reply failed — recorder offline?"); }
      else showErr("");
    });
  };
  const verdict = (act, id) => {
    const el = listEl.querySelector(`.pp-reply[data-id="${id}"]`);
    const note = el ? el.value.trim() : "";
    if (el) el.value = "";
    send({ type: act === "accept" ? "vt-pair-accept" : "vt-pair-bounce", id, body: note || undefined })
      .then((r) => showErr(r && r.ok ? "" : (r && r.error) || `${act} failed`));
  };
  // One idempotency key per DRAFT, kept until the server confirms: a retry
  // after a lost response replays the same key and the server dedupes,
  // instead of filing the bug twice (r3886550919).
  let newItemKey = "";
  newInput.addEventListener("keydown", (e) => {
    e.stopPropagation();
    if (e.key === "Escape") { pp.open = false; renderPanel(); }
    if (e.key !== "Enter" || e.shiftKey) return;
    e.preventDefault();
    const text = newInput.value.trim();
    if (!text) return;
    if (!newItemKey) newItemKey = (crypto.randomUUID && crypto.randomUUID()) || String(Date.now()) + Math.random();
    newInput.value = "";
    send({ type: "vt-pair-new", text, clientKey: newItemKey }).then((r) => {
      if (!r || !r.ok) { newInput.value = text; showErr((r && r.error) || "report failed"); }
      else { newItemKey = ""; showErr(""); }
    });
  });
  const togglePanel = () => {
    if (!pp.seen) return;
    pp.open = !pp.open;
    if (pp.open) {
      // On-demand snapshot + WS kick (this is vt-pair-panel's whole job —
      // wired here so a just-woken worker refreshes the state the moment
      // the tester looks; r3886550926).
      send({ type: "vt-pair-panel" }).then((r) => {
        if (r && r.ok && r.panel) seedPanel(r.panel);
      });
    }
    renderPanel();
  };
  pairEl.addEventListener("click", togglePanel);
  pairEl.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " ") { e.preventDefault(); togglePanel(); }
  });

  // seedPanel adopts the worker's whole snapshot (fresh injection, SW wake).
  const seedPanel = (panel) => {
    if (!panel) return;
    pp.seen = true;
    pp.wsUp = !!panel.wsUp;
    pp.listening = !!panel.listening;
    pp.working = panel.working || null;
    pp.items = panel.items || [];
    pp.replies = panel.replies || {};
    pp.timeline = panel.timeline || {};
    pp.relay = panel.relay || [];
    renderPanel();
  };
  const applyPairFrame = (f) => {
    pp.seen = true;
    switch (f.type) {
      case "ws": pp.wsUp = !!f.up; break;
      case "hello": pp.listening = !!f.listening; pp.working = f.working || null; break;
      case "items": pp.items = f.items || []; break;
      case "item": {
        if (!f.item) break;
        const i = pp.items.findIndex((x) => x.id === f.item.id);
        if (i >= 0) pp.items[i] = f.item; else pp.items.push(f.item);
        const tl = pp.timeline[f.item.id] || (pp.timeline[f.item.id] = []);
        if (!tl.length || tl[tl.length - 1].status !== f.item.status) tl.push({ status: f.item.status, at: f.item.updatedAt || new Date().toISOString() });
        break;
      }
      case "status": {
        const it = pp.items.find((x) => x.id === f.id);
        if (it) it.status = f.status;
        const tl = pp.timeline[f.id] || (pp.timeline[f.id] = []);
        if (!tl.length || tl[tl.length - 1].status !== f.status) tl.push({ status: f.status, at: f.at || new Date().toISOString() });
        break;
      }
      case "reply": {
        const list = pp.replies[f.id] || (pp.replies[f.id] = []);
        list.push(f.message);
        if (list.length > 20) list.shift();
        break;
      }
      case "working": pp.working = f.status ? { status: f.status, actor: f.actor } : null; break;
      case "listening": pp.listening = !!f.listening; break;
      case "relay": pp.relay.push({ text: f.text, ts: f.ts }); if (pp.relay.length > 40) pp.relay.shift(); break;
    }
    renderPanel();
  };
  // Legacy poll fallback keeps the collapsed line honest while the ws is down.
  const renderPair = (p) => {
    if (p) pollPair = p;
    renderPairLine();
  };

  // Health (recorder-live D4/D5). The pill stays ONE line while everything is
  // fine — a recorder sitting on top of the app under test earns its footprint
  // — and a second line unfolds only for a backlog, an outage, a server-side
  // close, or the wrapping-up drain after Stop. The glyph itself is the
  // at-a-glance answer; the full detail lives in the extension popup.
  const fmtAge = (ms) =>
    ms < 1000 ? "just now" : ms < 60000 ? `${Math.round(ms / 1000)}s` : `${Math.round(ms / 60000)}m`;
  const renderHealth = (h) => {
    if (!h) return;
    // glyph = manifest icon name; mirrored on data-icon so tests read the
    // state, never the svg.
    let glyph = "check", cls = "", line = "", bad = false;
    switch (h.state) {
      case "wrapping": {
        const w = h.wrapping || {};
        const total = w.total || 0;
        const sent = Math.max(0, total - (w.left || 0));
        glyph = "loader"; cls = "busy";
        line = `wrapping up · ${sent}/${total} sent`;
        if (w.blobs) line += ` · ${w.blobs} shot(s) left`;
        break;
      }
      case "offline":
        glyph = "warning"; cls = "bad"; bad = true;
        line = `offline${h.sinceSyncMs ? " " + fmtAge(h.sinceSyncMs) : ""} · ${h.queued} held · retrying`;
        break;
      case "dead":
        glyph = "circle-x"; cls = "bad"; bad = true;
        line = h.deadReason || "this session ended on the server";
        break;
      case "backlog":
        glyph = "loader"; cls = "busy";
        line = `syncing · ${h.queued} queued`;
        break;
      default:
        // Healthy: check once the server is confirmed to hold everything
        // sent, a quiet dashed circle while that reconciliation catches up.
        glyph = h.synced ? "check" : "circle-dashed";
    }
    syncEl.innerHTML = I(glyph);
    syncEl.dataset.icon = glyph;
    syncEl.className = "sync" + (cls ? " " + cls : "");
    detailEl.textContent = line;
    detailEl.classList.toggle("show", !!line);
    detailEl.classList.toggle("bad", bad);
    if (h.state === "wrapping" || h.state === "dead") pill.classList.add("paused");
  };
  // Active-time clock: base comes from the SW (activeMs), freezes on pause.
  let elapsedBase = 0, elapsedAt = Date.now(), paused = false;
  const setPaused = (p, elapsedMs) => {
    paused = p;
    if (elapsedMs !== undefined) { elapsedBase = elapsedMs; elapsedAt = Date.now(); }
    pill.classList.toggle("paused", paused);
  };
  // The SW can be asleep when a fresh page injects us — one lost status call
  // left the pill at 00:00 with no name. Retry until the state arrives.
  (async () => {
    for (let i = 0; i < 6; i++) {
      const r = await send({ type: "vt-status" });
      if (r && r.rec) {
        setPaused(!!r.rec.paused, r.elapsedMs || 0);
        $(".name").textContent = r.rec.title || `${r.rec.project} · ${r.rec.environment}`;
        renderHealth(r.health);
        renderPair(r.pair);
        seedPanel(r.pairPanel);
        return;
      }
      await new Promise((res) => setTimeout(res, 600));
    }
  })();
  const clock = setInterval(() => {
    const ms = elapsedBase + (paused ? 0 : Date.now() - elapsedAt);
    const s = Math.max(0, Math.floor(ms / 1000));
    $(".time").textContent = `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
  }, 1000);

  // note popover (plain note, no element)
  let pendingPick = null;
  // Where the next ⌖ snap lands. A snap is ALWAYS an annotation on the frame;
  // "task" additionally files it as an intake draft on the project, which the
  // server does as it projects the annotation. Resets to board every time the
  // popover opens — a destination is a per-observation choice, not a mode you
  // can forget you left on. A plain note has no frame to annotate, so the
  // choice is hidden for it.
  // Backing out (recorder-hud-polish D3): ✕, Esc from anywhere and a click
  // outside the HUD all leave through closePop — the pick is dropped, the
  // words are kept until the next send so a slip costs nothing.
  // The sheet itself (textarea, draft, board|task, Send) lives in hud.html;
  // this side places it, opens/closes it and turns its answer into the wire
  // message. The draft survives a cancel inside the frame (D3).
  const hudPost = (msg) => { if (pop.contentWindow) pop.contentWindow.postMessage({ vtHud: true, ...msg }, "*"); };
  // Reparenting the host (the modal ride-along below) reloads the frame; an
  // "open" posted before its script is back is lost, so opens wait for the
  // frame's "ready" and the last one is replayed when it arrives.
  let hudReady = false, pendingOpen = null;
  const closePop = () => {
    pendingOpen = null;
    if (!pop.classList.contains("open")) return;
    pop.classList.remove("open");
    pill.classList.remove("composing");
    pendingPick = null;
  };
  const openPop = (title, ctx) => {
    // Above the whole stack (pill + detail + pairline), never over the pill.
    pop.style.bottom = `${$(".stack").offsetHeight + 8}px`;
    pop.classList.add("open");
    pill.classList.add("composing");
    const msg = { type: "open", title, ctx: ctx || `step · ${location.pathname}`, pick: !!pendingPick };
    if (hudReady) hudPost(msg); else pendingOpen = msg;
  };
  $(".b-note").onclick = () => { pendingPick = null; openPop("Note", null); };
  window.addEventListener("message", (e) => {
    // Only our own composer frame speaks on this channel.
    if (e.source !== pop.contentWindow || !e.data || !e.data.vtHud) return;
    const m = e.data;
    if (m.type === "ready" || m.type === "size" || m.type === "opened") {
      if (m.height) pop.style.height = `${Math.ceil(m.height)}px`;
      if (m.type === "ready") {
        hudReady = true;
        if (pendingOpen) { hudPost(pendingOpen); pendingOpen = null; }
      }
    } else if (m.type === "close") {
      closePop();
    } else if (m.type === "send") {
      const pick = pendingPick;
      closePop();
      if (pick) {
        send({ type: "vt-snap", route: location.pathname, payload: { ...pick, note: m.text, task: !!m.task } });
      } else if (m.text) {
        send({ type: "vt-note", payload: { text: m.text, route: location.pathname } });
      }
    }
  });
  // Esc from a pill control — the shield stops keydown at the host, so this
  // is the HUD-side half of "Esc anywhere"; the frame handles its own Esc,
  // the document capture listener below is the page side.
  root.addEventListener("keydown", (e) => {
    if (e.key !== "Escape" || !pop.classList.contains("open")) return;
    e.preventDefault();
    closePop();
  });
  // Esc anywhere and click-outside: capture-phase document listeners, so they
  // run before the page — and the Esc that closes the sheet never reaches the
  // page's own dialog. Pick mode owns its pointer events while it is on.
  document.addEventListener("keydown", (e) => {
    if (e.key !== "Escape" || !pop.classList.contains("open") || hud.contains(e.target)) return;
    e.preventDefault(); e.stopPropagation();
    closePop();
  }, true);
  document.addEventListener("pointerdown", (e) => {
    if (picking || !pop.classList.contains("open") || hud.contains(e.target)) return;
    closePop();
  }, true);
  $(".b-pause").onclick = () => send({ type: "vt-pause" }); // state echoes back via vt-paused

  // -------------------------------------------------------------------------
  // element-pick snap (⌖): crosshair, outline hovered element, click → note

  let picking = false;
  const outline = document.createElement("div");
  outline.style.cssText = "all:initial;position:fixed;z-index:2;pointer-events:none;" +
    "border:2px solid #ff3b57;border-radius:6px;box-shadow:0 0 0 4px rgba(255,59,87,.15);display:none;";
  // Annotate-mode chrome (shadow-root children): page dim + hint bar — the ⌖ press must be
  // unmistakable (first test: "I click it and get no feedback").
  const dim = document.createElement("div");
  dim.style.cssText = "all:initial;position:fixed;inset:0;z-index:1;pointer-events:none;" +
    "background:rgba(0,0,0,.22);";
  const hint = document.createElement("div");
  hint.style.cssText = "all:initial;position:fixed;top:16px;left:50%;transform:translateX(-50%);" +
    "z-index:3;padding:8px 16px;border-radius:999px;background:#1d1a1b;" +
    "border:1px solid #ff3b57;box-shadow:0 8px 30px rgba(0,0,0,.4);" +
    "font:600 12px/1 -apple-system,BlinkMacSystemFont,sans-serif;color:#f0eae4;";
  hint.innerHTML = I("annotate") + " annotate — click an element or drag an area · enter sends · esc cancels";
  const startPick = () => {
    if (picking) return;
    picking = true;
    root.append(dim, outline, hint); // in the shadow root: the page cannot restyle the chrome
    document.documentElement.style.cursor = "crosshair";
    // V1 (recorder-v2): click an element OR drag a free region — a drag past
    // 6px switches from element-outline to marquee.
    let downAt = null, dragging = false;
    const showRect = (x, y, w, h) => {
      outline.style.display = "block";
      outline.style.left = x + "px"; outline.style.top = y + "px";
      outline.style.width = w + "px"; outline.style.height = h + "px";
    };
    const move = (e) => {
      if (downAt && (dragging || Math.hypot(e.clientX - downAt.x, e.clientY - downAt.y) > 6)) {
        dragging = true;
        showRect(Math.min(downAt.x, e.clientX), Math.min(downAt.y, e.clientY),
          Math.abs(e.clientX - downAt.x), Math.abs(e.clientY - downAt.y));
        return;
      }
      const el = document.elementFromPoint(e.clientX, e.clientY);
      if (!el || hud.contains(el)) { outline.style.display = "none"; return; }
      const r = el.getBoundingClientRect();
      showRect(r.x - 3, r.y - 3, r.width + 2, r.height + 2);
    };
    const down = (e) => {
      if (hud.contains(e.target)) return;
      e.preventDefault(); e.stopPropagation();
      downAt = { x: e.clientX, y: e.clientY };
    };
    const up = (e) => {
      if (!downAt) return;
      e.preventDefault(); e.stopPropagation();
      const start = downAt;
      const wasDrag = dragging;
      downAt = null; dragging = false;
      const s = window.devicePixelRatio || 1;
      if (wasDrag) {
        const x = Math.min(start.x, e.clientX), y = Math.min(start.y, e.clientY);
        const w = Math.abs(e.clientX - start.x), h = Math.abs(e.clientY - start.y);
        cleanup();
        if (w < 4 || h < 4) return;
        pendingPick = { rect: { x: Math.round(x * s), y: Math.round(y * s), w: Math.round(w * s), h: Math.round(h * s) }, selector: "", text: "" };
        openPop("Annotate region", `${Math.round(w)}×${Math.round(h)} · ${location.pathname}`);
        return;
      }
      const el = document.elementFromPoint(e.clientX, e.clientY);
      cleanup();
      if (!el || hud.contains(el)) return;
      pendingPick = { rect: imageRect(el), selector: shortSelector(el), text: (el.innerText || "").trim().slice(0, 80) };
      openPop("Annotate element", `${pendingPick.selector} · ${location.pathname}`);
    };
    const swallowClick = (e) => { e.preventDefault(); e.stopPropagation(); };
    const key = (e) => { if (e.key === "Escape") cleanup(); };
    const cleanup = () => {
      picking = false; downAt = null; dragging = false;
      outline.remove(); dim.remove(); hint.remove();
      document.documentElement.style.cursor = "";
      document.removeEventListener("pointermove", move, true);
      document.removeEventListener("pointerdown", down, true);
      document.removeEventListener("pointerup", up, true);
      document.removeEventListener("click", swallowClick, true);
      document.removeEventListener("keydown", key, true);
    };
    document.addEventListener("pointermove", move, true);
    document.addEventListener("pointerdown", down, true);
    document.addEventListener("pointerup", up, true);
    document.addEventListener("click", swallowClick, true);
    document.addEventListener("keydown", key, true);
  };
  $(".b-snap").onclick = startPick;

  // commands + stop from the SW
  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg.type === "vt-pick") startPick();
    else if (msg.type === "vt-note-ui") { pendingPick = null; openPop("Note", null); }
    else if (msg.type === "vt-paused") setPaused(msg.paused, msg.elapsedMs);
    else if (msg.type === "vt-health") renderHealth(msg.health);
    else if (msg.type === "vt-pair") renderPair(msg.pair);
    else if (msg.type === "vt-pair-frame") applyPairFrame(msg.frame);
    else if (msg.type === "vt-stop") {
      clearInterval(clock); clearInterval(rrTimer); clearTimeout(vitalsTimer);
      sendVitals(); // the final page's vitals ride out before the SW drains
      hud.remove(); outline.remove(); dim.remove(); hint.remove();
      window.__vitrinkaRecorder = false;
      // Ship the final sub-2s rrweb batch before the SW drains its buffer —
      // detachAll awaits this response, so the last DOM events aren't lost.
      const events = rrBuf;
      rrBuf = [];
      const finish = () => { try { sendResponse({ ok: true }); } catch { /* channel gone */ } };
      if (events.length) send({ type: "vt-rrweb", events }).then(finish, finish);
      else finish();
      return true;
    }
  });

  document.documentElement.append(hud);
  pop.src = chrome.runtime.getURL("hud.html");
  // Top layer (recorder-iframe vt-2985): a manual popover paints above every
  // page z-index. A native <dialog>.showModal() is stronger than paint order:
  // Chrome makes every node outside the modal's subtree INERT — hit-testing
  // skips it even when it paints on top (probed 2026-09-21: the pill's
  // point resolved to the <dialog>). The one non-inert place is the modal's
  // own subtree, so the HUD rides INSIDE the topmost open modal while one is
  // up and comes home to <html> when it closes or is unmounted. Moving the
  // host reloads the composer iframe, so the sheet closes first. Older
  // engines (no Popover API) keep the z-index:2147483647 host as before.
  const canPop = typeof hud.showPopover === "function";
  const raise = () => {
    if (!canPop) return;
    try { hud.hidePopover(); } catch { /* not shown */ }
    try { hud.showPopover(); } catch { /* detached */ }
  };
  if (canPop) hud.popover = "manual";
  const topModal = () => {
    const open = [...document.querySelectorAll("dialog[open]")];
    for (let i = open.length - 1; i >= 0; i--) {
      try { if (open[i].matches(":modal")) return open[i]; } catch { return open[i]; }
    }
    return null;
  };
  const place = () => {
    if (!window.__vitrinkaRecorder) return; // stopped
    const want = topModal() || document.documentElement;
    if (hud.parentNode !== want) {
      closePop();
      hudReady = false; // the frame reloads on reparent; "ready" re-arms opens
      want.append(hud);
    }
    raise();
  };
  let placing = false;
  const schedule = () => {
    if (placing) return;
    placing = true;
    queueMicrotask(() => { placing = false; place(); });
  };
  const touchesDialog = (m) => {
    if (m.type === "attributes") return m.target instanceof HTMLDialogElement;
    for (const list of [m.addedNodes, m.removedNodes]) {
      for (const n of list) {
        if (n === hud || (n instanceof Element && (n.matches("dialog") || n.querySelector("dialog")))) return true;
      }
    }
    return false;
  };
  new MutationObserver((muts) => {
    if (!hud.isConnected || muts.some(touchesDialog)) schedule();
  }).observe(document.documentElement, { subtree: true, childList: true, attributes: true, attributeFilter: ["open"] });
  place();
})();
