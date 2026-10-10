// Vitrinka Journey Recorder — content script (isolated world).
// Captures clicks (selector + text + rect in image px), records the DOM via
// rrweb (vendor/rrweb-record.min.js injected before this file), and mounts
// the shared recorder HUD — @vitrinka/web's, vendor/vitrinka-hud.iife.js,
// the same pill, sheets, annotate mode and ⋯ menu the in-app recorder shows —
// through a HudController backed by the service worker (the adapter below).
// The pair panel keeps its own small shadow host: the HUD has no seat for it.
// Every recorder surface carries data-vitrinka-recorder, which keeps it out
// of rrweb and out of the click lane.
//
// Idempotent: re-injection (SPA navs, SW restarts) is a no-op while the
// previous instance records. A NEW session in the same document (Start on
// the HUD a stop left behind, or the popup) retires the previous instance —
// its listeners, its HUD — before this one takes over.

(() => {
  const prev = window.__vitrinkaRecorder;
  if (prev && prev.live !== false) return;
  if (prev && prev.retire) prev.retire();
  const self = { live: true, retire: () => undefined };
  window.__vitrinkaRecorder = self;
  // Undone by endCapture (the session stopped) and retire (a new instance).
  const captureOff = [];
  const off = (fn) => captureOff.push(fn);

  const send = (msg) => new Promise((res) => {
    try { chrome.runtime.sendMessage(msg, res); } catch { res(null); }
  });
  // Every recorder surface: the HUD host, a sheet it portals into a dialog,
  // the annotate stylesheet, the pair host. rrweb blocks them; clicks on them
  // are the tester's, not the journey's.
  const RECORDER_SEL = "[data-vitrinka-recorder]";
  // The HUD's annotate mode (HudSnapshot.annotating) owns the page pointer.
  let annotating = false;
  // Settles once the HUD is mounted (or will not be); rrweb starts after it.
  let hudMountedDone = () => undefined;
  const hudMounted = new Promise((res) => { hudMountedDone = res; });

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

  // Under a blur policy (maskAllText) keyframes are downscaled to 96px wide,
  // so rects must land in THAT pixel space — device-pixel coordinates would
  // sit far outside the image. Set from the vt-policy response; recomputed at
  // use time so a window resize can't stale the factor.
  let blurShots = true;
  let maskInputs = true;
  let maskText = true;
  const clickText = (el) => {
    // Field values lack the key context a free-text scrub needs to find secrets.
    const input = /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName);
    if (maskText || (maskInputs && input)) return "[redacted]";
    if (el.closest(".rr-mask,.rr-block") || el.querySelector(".rr-mask,.rr-block")) return "[redacted]";
    return (el.innerText || (input && !maskInputs ? el.value : "") || "").trim().slice(0, 80);
  };
  const imageScale = () => {
    const s = window.devicePixelRatio || 1;
    // CSS px → captured-image px: device scale normally; 96/viewport-width
    // when keyframes are blurred to 96px wide.
    if (!blurShots) return s;
    return window.innerWidth > 0 ? 96 / window.innerWidth : s;
  };
  const imageRect = (el) => {
    const r = el.getBoundingClientRect();
    const s = imageScale();
    return { x: Math.round(r.x * s), y: Math.round(r.y * s), w: Math.round(r.width * s), h: Math.round(r.height * s) };
  };

  const onClick = (e) => {
    if (!self.live || annotating) return; // annotate mode owns the click
    const el = e.target instanceof Element ? (e.target.closest("a,button,[role=button],input,select,textarea,label") || e.target) : null;
    if (!el || el.closest(RECORDER_SEL)) return;
    send({
      type: "vt-click", route: location.pathname,
      payload: {
        selector: shortSelector(el),
        text: clickText(el),
        rect: imageRect(el),
      },
    });
  };
  document.addEventListener("click", onClick, true);
  off(() => document.removeEventListener("click", onClick, true));

  // -------------------------------------------------------------------------
  // rrweb (D3): batch events to the SW every 2s; SW uploads them as chunks

  let rrBuf = [];
  const emitRR = (ev) => { if (self.live) rrBuf.push(ev); };
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
      // The snapshot also waits for the HUD to mount, so its blocked host is
      // IN the snapshot: added later, it is an <html>-level mutation, and
      // rrweb's replay loses every mutation after it on a seek.
      Promise.all([send({ type: "vt-policy" }), hudMounted]).then(([r]) => {
        try {
          if (!self.live) return; // stopped before the policy answered
          // Only engine directives establish a policy. A missing/malformed
          // response keeps BOTH inputs and text masked, never just the inputs.
          const settled = r && r.ok === true && r.mask
            && typeof r.mask.maskAllInputs === "boolean" && typeof r.mask.maskAllText === "boolean";
          const mask = settled ? r.mask : { maskAllInputs: true, maskAllText: true };
          blurShots = !settled || r.pixel === "blur";
          maskInputs = mask.maskAllInputs;
          maskText = mask.maskAllText;
          // blockSelector: the recorder's own surfaces never enter the
          // replay — rrweb leaves an empty placeholder for the 0×0 hosts.
          const opts = { emit: emitRR, inlineImages: false, collectFonts: true, blockSelector: RECORDER_SEL };
          if (mask.maskAllInputs) opts.maskAllInputs = true;
          if (mask.maskAllText) {
            opts.maskAllText = true;                                  // rrweb ≥2.x spelling
            opts.maskTextSelector = mask.maskTextSelector || "*";     // alpha-era spelling
          }
          const stopRr = rrRec(opts);
          if (typeof stopRr === "function") off(stopRr);
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
  off(() => clearInterval(rrTimer));

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
  const onHidden = () => { if (document.visibilityState === "hidden") sendVitals(); };
  document.addEventListener("visibilitychange", onHidden);
  addEventListener("pagehide", sendVitals);
  off(() => {
    clearTimeout(vitalsTimer);
    document.removeEventListener("visibilitychange", onHidden);
    removeEventListener("pagehide", sendVitals);
  });

  // -------------------------------------------------------------------------
  // pair host: the pair line + panel in their own small shadow host (the
  // shared HUD has no seat for them), resting just inside the HUD's spot
  // (placePair). Open: e2e asserts into it.

  const pairHost = document.createElement("div");
  pairHost.setAttribute("data-vitrinka-recorder", "");
  const root = pairHost.attachShadow({ mode: "open" });
  // Manifest icons: vendor/vitrinka-icons.js is injected ahead of this script
  // (background.js CONTENT_FILES). Icon markup only — user/server strings
  // NEVER ride innerHTML, they are appended as text nodes.
  const I = (name, cls) => (globalThis.VT_ICONS ? VT_ICONS.html(name, cls) : "");
  root.innerHTML = `
    <style>
      * { box-sizing: border-box; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; }
      /* manifest icons (vendor/vitrinka-icons.js): 1em, currentColor, sized by the host's font */
      svg { width:1em; height:1em; vertical-align:-.125em; }
      :host { --ink:rgba(26,22,23,.72); --edge:rgba(255,255,255,.11); --rim:rgba(0,0,0,.30);
        --glass-shadow:inset 0 0 0 1px var(--edge), 0 0 0 .5px var(--rim), 0 10px 28px -10px rgba(0,0,0,.5), 0 2px 6px -2px rgba(0,0,0,.28); }
      .stack { display:flex; flex-direction:column; align-items:flex-end; gap:6px; }
      :host([data-col="l"]) .stack { align-items:flex-start; }
      /* pair-mode narration: the listening/fixing micro-label (mono, quiet) */
      .pairline { max-width:320px; padding:6px 12px; border-radius:999px;
        background:var(--ink); -webkit-backdrop-filter:blur(16px); backdrop-filter:blur(16px); border:0; box-shadow:var(--glass-shadow); color:#756e68;
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
        padding:10px 12px; background:var(--ink); -webkit-backdrop-filter:blur(16px); backdrop-filter:blur(16px); border:0;
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
      .pp-b:focus-visible { outline:2px solid #ff3b57; outline-offset:-2px; }
      .pp-b.ok:hover { color:#5f7a5f; } .pp-b.no:hover { color:#e8a33d; }
      .pp-relay { margin-top:8px; padding-top:6px; border-top:1px solid #292526;
        color:#756e68; font-size:9.5px; white-space:pre-wrap; word-break:break-word; }
      .pp-err { color:#ff3b57; margin-top:4px; }
      @media (prefers-reduced-motion: reduce) {
        *, *::before, *::after { transition-duration:0ms !important; animation:none !important; }
      }
    </style>
    <div class="stack">
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
    </div>`;
  // Shield (recorder-hud-polish): nothing the tester does on the panel
  // reaches the host page — the same bubble-phase stops the HUD host makes.
  for (const t of ["pointerdown", "pointerup", "pointermove", "pointerover", "pointerout", "pointercancel",
    "mousedown", "mouseup", "mousemove", "mouseover", "mouseout", "click", "dblclick", "auxclick", "contextmenu",
    "touchstart", "touchend", "touchmove", "touchcancel", "wheel",
    "focusin", "focusout", "keydown", "keyup", "keypress"]) {
    pairHost.addEventListener(t, (e) => e.stopPropagation());
  }
  // The HUD's spot (its `dock` key in hudStore below): the pair line sits
  // just inside it, toward the page — above a bottom pill, below a top one;
  // beside the side edge's foot for a middle or tucked pill.
  const placePair = (dockRaw) => {
    let spot = "br";
    try {
      const p = JSON.parse(dockRaw || "null");
      if (p && typeof p.spot === "string") spot = p.spot;
      else if (p && (p.tuck === "left" || p.tuck === "right")) spot = `m${p.tuck[0]}`;
    } catch { /* no spot remembered: bottom right */ }
    const [row, col] = spot;
    pairHost.dataset.col = col === "l" ? "l" : "r";
    const x = col === "l" ? "left:16px;" : col === "r" ? "right:16px;" : "left:50%;transform:translateX(-50%);";
    const y = row === "t" ? "top:60px;" : row === "b" ? "bottom:60px;" : "bottom:16px;";
    pairHost.style.cssText = `all:initial;position:fixed;z-index:2147483647;${x}${y}`;
  };
  placePair(null);

  const $ = (sel) => root.querySelector(sel);
  const pairEl = $(".pairline");

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

  // -------------------------------------------------------------------------
  // the HUD adapter: a HudController (@vitrinka/web/hud's contract,
  // packages/web/src/recorder/hud/controller.ts in vitrinka-kit) over the
  // worker's messages. Capture, redaction and the session lifecycle stay the
  // worker's; this only translates.
  //
  //   snapshot.recording  ← vt-status (on load), vt-paused, vt-health
  //   account/prefs/recents/workspaceUrl/canAttach ← vt-hud (hudState in background.js)
  //   start · togglePause · stop → vt-start · vt-pause · vt-stop
  //   note · annotate → vt-note · vt-snap (rect in image px, as clicks;
  //     attachments ride beside the payload as data URLs)
  //   getMe · setPrefs · refreshRecents → vt-hud-me · vt-hud-prefs · vt-hud-recents
  //   link → the options page (its device-code dance); unlink is the options page's too

  const VERSION = `extension/${chrome.runtime.getManifest().version}`;
  // The live recording as the HUD paints it; null once it ended.
  let live = null; // {sessionId, title, paused, activeMs, resumedAt, boardUrl}
  let health = null; // the worker's last health()
  let hud = { base: "", workspace: "", live: null, recents: [], prefs: { size: "md", verbose: false, sheetW: 0, sheetH: 0 }, account: null, canAttach: false };
  // True while THIS tab's HUD stops the session: the vt-stop the worker sends
  // every recorded tab then ends capture here but keeps the HUD for "Saved".
  let stoppingHere = false;
  // This instance, to the worker: a board named after its Stop is told to it
  // alone (vt-board), never to a later instance a new Start put in this tab.
  const hudToken = crypto.randomUUID();
  // The session this pill stopped ({recent, boardUrl}), whose board link the
  // Saved face takes from its recent once vt-board names it.
  let saved = null;

  const adoptRec = (rec, elapsedMs) => {
    live = rec ? {
      sessionId: String(rec.sessionId),
      title: rec.title || `${rec.project} · ${rec.environment}`,
      paused: !!rec.paused,
      activeMs: elapsedMs || 0,
      resumedAt: rec.paused || rec.stopping || rec.dead ? null : Date.now(),
      boardUrl: "",
    } : null;
  };
  const syncOf = (h) => {
    const queued = (h && h.queued) || 0;
    // The worker's "wrapping" (Stop drains) is the HUD's saving face; its
    // sync reads as the backlog it is.
    const state = !h ? "ok" : ["offline", "dead", "backlog"].includes(h.state) ? h.state
      : h.state === "wrapping" && queued > 0 ? "backlog" : "ok";
    return {
      state, synced: !!(h && h.synced), queued, chunks: (h && h.chunks) || 0,
      failures: (h && h.failures) || 0, error: (h && h.error) || "",
      lastSyncAt: (h && h.lastSyncAt) || null, events: (h && h.localSeq) || 0,
      serverMaxSeq: h ? h.serverMaxSeq : -1, deadReason: (h && h.deadReason) || "",
    };
  };
  const build = () => {
    let recording = null;
    if (live) {
      const dead = !!health && health.state === "dead";
      const boardUrl = (health && health.boardUrl) || live.boardUrl;
      recording = {
        sessionId: live.sessionId, title: live.title, ...(boardUrl ? { boardUrl } : {}),
        paused: live.paused, dead, activeMs: live.activeMs, resumedAt: dead ? null : live.resumedAt,
        sync: syncOf(health),
      };
    }
    const ws = hud.workspace;
    let recents = hud.recents.slice(0, 5);
    // The board named after this pill's Stop rides on that session's recent,
    // leading the list when the HUD's scope has moved on: the Saved face finds
    // its recent by id alone, and #N repeats across workspaces.
    if (saved && saved.boardUrl) {
      const own = (r) => r.sessionId === saved.recent.sessionId && r.base === saved.recent.base && r.workspace === saved.recent.workspace;
      recents = recents.some(own)
        ? recents.map((r) => (own(r) ? { ...r, boardUrl: saved.boardUrl } : r))
        : [{ ...saved.recent, status: "saved", boardUrl: saved.boardUrl }, ...recents].slice(0, 5);
    }
    return {
      linked: !!hud.base,
      canUnlink: false,
      annotating,
      recording,
      account: hud.account,
      prefs: hud.prefs,
      // A "recording" that is not the live session was never stopped.
      recents: recents.map(({ base: _base, workspace: _ws, ...r }) =>
        r.status === "recording" && r.sessionId !== hud.live ? { ...r, status: "unsaved" } : r),
      workspaceUrl: hud.base ? (ws ? `${hud.base}/w/${encodeURIComponent(ws)}` : hud.base) : "",
      version: VERSION,
      // The paperclip, while this recording's workspace takes images (D6).
      canAttach: !!recording && hud.canAttach === true,
    };
  };
  const listeners = new Set();
  let snap = build(), snapKey = JSON.stringify(snap);
  // getSnapshot hands back the SAME object until something in it changed.
  const changed = () => {
    const next = build(), key = JSON.stringify(next);
    if (key === snapKey) return;
    snap = next; snapKey = key;
    listeners.forEach((l) => l());
  };
  const adoptHealth = (h) => {
    if (!h) return;
    health = h;
    // Stop draining or a server-side close freezes the clock where it stood.
    if (live && live.resumedAt !== null && (h.state === "wrapping" || h.state === "dead")) {
      live = { ...live, activeMs: h.elapsedMs || live.activeMs, resumedAt: null };
    }
    changed();
  };
  const adoptHud = (h) => {
    if (!h || !Array.isArray(h.recents)) return;
    hud = h;
    changed();
  };
  const fail = (r, fallback) => new Error((r && r.error) || fallback);

  // A tester's images (recorder attachments D5) cross to the worker as data
  // URLs: a runtime message is JSON, and a Blob would arrive as {}. The HUD
  // already normalized each one (re-encoded, ≤ 2560 px, ≤ 12 MiB), so nothing
  // is re-encoded here; only a note whose images would outgrow one message
  // (Chrome caps it at 64 MiB, base64 adds a third) keeps the first ones.
  const ATTACH_MESSAGE_BYTES = 40 * 1024 * 1024;
  const dataUrlOf = (blob) => new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(String(r.result));
    r.onerror = () => rej(r.error);
    r.readAsDataURL(blob);
  });
  const wireAttachments = async (attachments) => {
    const out = [];
    let total = 0;
    for (let i = 0; i < attachments.length; i++) {
      const a = attachments[i];
      total += a.blob.size;
      if (total > ATTACH_MESSAGE_BYTES) {
        console.warn(`vitrinka: ${attachments.length - i} attachment(s) past one message's budget — dropped`);
        break;
      }
      try {
        out.push({ name: a.name, dataUrl: await dataUrlOf(a.blob), w: a.w, h: a.h });
      } catch (e) { console.warn("vitrinka: an attachment could not be read — dropped", e); }
    }
    return out;
  };

  const controller = {
    getSnapshot: () => snap,
    subscribe(l) { listeners.add(l); return () => listeners.delete(l); },
    // The worker records the ACTIVE tab — this one — and injects a fresh
    // instance into it, which retires this one (and its HUD).
    async start({ title }) {
      const r = await send({ type: "vt-start", title });
      if (!r || !r.ok) throw fail(r, "the recorder did not answer — try again");
    },
    async togglePause() { await send({ type: "vt-pause" }); }, // echoes back as vt-paused
    async stop() {
      stoppingHere = true;
      const boardBefore = snap.recording && snap.recording.boardUrl;
      const sessionId = snap.recording && snap.recording.sessionId;
      // Its recent as the live HUD lists it (the session's own base + workspace).
      const recent = hud.recents.find((x) => x.sessionId === sessionId)
        || { base: hud.base, workspace: hud.workspace, sessionId, title: (snap.recording && snap.recording.title) || "", startedAt: Date.now() };
      // Expected before the stop goes out: the worker may announce the board
      // while the stop's answer is still on its way.
      saved = sessionId ? { recent, boardUrl: "" } : null;
      let r;
      try { r = await send({ type: "vt-stop", hud: hudToken }); } finally { stoppingHere = false; }
      if (!r || !r.ok) {
        saved = null;
        throw fail(r, "the recorder did not answer — try again"); // the session is kept
      }
      live = null; health = null;
      self.live = false;
      changed();
      adoptHud(await send({ type: "vt-hud" }));
      const done = r.done;
      if (!done) {
        saved = null;
        throw new Error("the server refused to close this session — it ended locally, not saved");
      }
      const boardUrl = done.boardUrl || (done.board && done.board.url) || boardBefore;
      // The server builds the board after the stop (stills first, 30–60 s),
      // so Saved rarely has it yet: `sessionId` names the recent whose link
      // the face takes once the worker's board wait (D11) tells this pill.
      return { ...(boardUrl ? { boardUrl } : {}), ...(sessionId ? { sessionId } : {}) };
    },
    // Without images a note goes at once, its seq where the tester wrote it;
    // with them it goes once they are read, the images riding beside it.
    note(text, attachments) {
      const msg = { type: "vt-note", payload: { text, route: location.pathname } };
      if (!attachments || !attachments.length) return void send(msg);
      wireAttachments(attachments).then((files) => {
        if (files.length || text) send({ ...msg, attachments: files });
      });
    },
    annotate({ text, rect, selector, task, attachments }) {
      const s = imageScale();
      const msg = { type: "vt-snap", route: location.pathname, payload: {
        rect: { x: Math.round(rect.x * s), y: Math.round(rect.y * s), w: Math.round(rect.w * s), h: Math.round(rect.h * s) },
        selector, note: text, task: !!task,
      } };
      if (!attachments || !attachments.length) return void send(msg);
      wireAttachments(attachments).then((files) => send({ ...msg, attachments: files }));
    },
    setAnnotating(on) { annotating = !!on; changed(); },
    async link() {
      await send({ type: "vt-open-options" });
      throw new Error("Link this browser in the recorder's Settings — they opened in a new tab.");
    },
    unlink() { /* canUnlink is false: the Settings page owns the link */ },
    async getMe() { adoptHud(await send({ type: "vt-hud-me" })); return snap.account; },
    async setPrefs(patch) {
      hud = { ...hud, prefs: { ...hud.prefs, ...patch } }; // at once; the worker persists
      changed();
      adoptHud(await send({ type: "vt-hud-prefs", patch }));
    },
    async refreshRecents() { adoptHud(await send({ type: "vt-hud-recents" })); },
  };

  // The HUD's own UI state (its dock spot) per origin in extension storage,
  // never the page's localStorage; RecorderStorage is synchronous, so it is
  // read once before mounting and written through.
  const hudKey = `vtHud:${location.origin}`;
  const hudStore = {};
  const persistHud = () => {
    try { chrome.storage.local.set({ [hudKey]: { ...hudStore } }); } catch { /* the spot lasts this page */ }
  };
  const storage = {
    getString: (k) => (k in hudStore ? hudStore[k] : null),
    set: (k, v) => { hudStore[k] = v; persistHud(); if (k === "dock") placePair(v); },
    remove: (k) => { delete hudStore[k]; persistHud(); },
  };

  // The manifest commands (Alt+Shift+A / N) reach the worker, not the page;
  // it relays them here and the HUD hears the chord it binds itself.
  const chord = (code) => window.dispatchEvent(new KeyboardEvent("keydown",
    { code, key: code.slice(3), altKey: true, shiftKey: true, bubbles: true, cancelable: true }));

  let unmountHud = null;
  // endCapture: the session stopped — capture ends in this document, once.
  const endCapture = () => {
    self.live = false;
    while (captureOff.length) {
      try { captureOff.pop()(); } catch (e) { console.warn("vitrinka: capture teardown", e); }
    }
  };
  const removeUi = () => {
    if (unmountHud) { unmountHud(); unmountHud = null; }
    pairHost.remove();
    placeObserver.disconnect();
  };

  // The stopping pill still paints drain health and its late board link, but
  // never handles capture/annotation commands after its capture listener ends.
  const onSavedBoard = (msg) => {
    if (msg.type === "vt-health") return adoptHealth(msg.health);
    if (msg.type === "vt-hud") return adoptHud(msg.hud);
    if (msg.type !== "vt-board" || !saved || msg.hud !== hudToken
      || msg.sessionId !== saved.recent.sessionId || !msg.boardUrl) return;
    saved = { ...saved, boardUrl: String(msg.boardUrl) };
    changed();
  };

  const onMessage = (msg, _sender, sendResponse) => {
    if (msg.type === "vt-policy-push") blurShots = msg.pixel === "blur";
    else if (msg.type === "vt-pick") chord("KeyA");
    else if (msg.type === "vt-note-ui") chord("KeyN");
    else if (msg.type === "vt-paused") {
      if (live) live = { ...live, paused: !!msg.paused, activeMs: msg.elapsedMs || 0, resumedAt: msg.paused ? null : Date.now() };
      changed();
    }
    else if (msg.type === "vt-health") adoptHealth(msg.health);
    else if (msg.type === "vt-hud") adoptHud(msg.hud);
    else if (msg.type === "vt-board") {
      // Only for the session this very instance stopped.
      if (!saved || msg.hud !== hudToken || msg.sessionId !== saved.recent.sessionId || !msg.boardUrl) return;
      saved = { ...saved, boardUrl: String(msg.boardUrl) };
      changed();
    }
    else if (msg.type === "vt-pair") renderPair(msg.pair);
    else if (msg.type === "vt-pair-frame") applyPairFrame(msg.frame);
    else if (msg.type === "vt-stop") {
      sendVitals(); // the final page's vitals ride out before the SW drains
      endCapture();
      chrome.runtime.onMessage.removeListener(onMessage);
      if (stoppingHere) chrome.runtime.onMessage.addListener(onSavedBoard);
      // The pair panel lives exactly as long as the recording; the HUD stays
      // only when it is the one stopping (its Saving → Saved faces).
      pairHost.remove();
      if (!stoppingHere) removeUi();
      // Ship the final sub-2s rrweb batch before the SW drains its buffer —
      // detachAll awaits this response, so the last DOM events aren't lost.
      const events = rrBuf;
      rrBuf = [];
      const finish = () => { try { sendResponse({ ok: true }); } catch { /* channel gone */ } };
      if (events.length) send({ type: "vt-rrweb", events }).then(finish, finish);
      else finish();
      return true;
    }
  };
  chrome.runtime.onMessage.addListener(onMessage);

  self.retire = () => {
    endCapture();
    chrome.runtime.onMessage.removeListener(onMessage);
    chrome.runtime.onMessage.removeListener(onSavedBoard);
    removeUi();
  };

  // Top layer: the pair host is a manual popover, above every page z-index.
  // A native <dialog>.showModal() makes everything outside its subtree INERT
  // (hit-testing included), so the host rides inside the topmost open modal
  // while one is up and comes home to <html> after.
  const canPop = typeof pairHost.showPopover === "function";
  if (canPop) pairHost.popover = "manual";
  const topModal = () => {
    const open = [...document.querySelectorAll("dialog[open]")];
    for (let i = open.length - 1; i >= 0; i--) {
      try { if (open[i].matches(":modal")) return open[i]; } catch { return open[i]; }
    }
    return null;
  };
  const place = () => {
    if (!self.live) return;
    const want = topModal() || document.documentElement;
    if (pairHost.parentNode !== want) want.append(pairHost);
    if (!canPop) return;
    try { pairHost.hidePopover(); } catch { /* not shown */ }
    try { pairHost.showPopover(); } catch { /* detached */ }
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
        if (n === pairHost || (n instanceof Element && (n.matches("dialog") || n.querySelector("dialog")))) return true;
      }
    }
    return false;
  };
  const placeObserver = new MutationObserver((muts) => {
    if (!pairHost.isConnected || muts.some(touchesDialog)) schedule();
  });
  placeObserver.observe(document.documentElement, { subtree: true, childList: true, attributes: true, attributeFilter: ["open"] });
  place();

  // Mount: the HUD's stored spot first (synchronous storage), the state next
  // — the worker can be asleep when a fresh page injects us, so the status
  // call retries — then the HUD, painting the recording from its first frame.
  (async () => {
    try {
      const saved = (await chrome.storage.local.get(hudKey))[hudKey];
      if (saved && typeof saved === "object") Object.assign(hudStore, saved);
    } catch { /* no storage: the default spot */ }
    placePair(hudStore.dock);
    for (let i = 0; i < 6; i++) {
      const r = await send({ type: "vt-status" });
      if (r && r.rec) {
        adoptRec(r.rec, r.elapsedMs);
        adoptHealth(r.health);
        renderPair(r.pair);
        seedPanel(r.pairPanel);
        break;
      }
      await new Promise((res) => setTimeout(res, 600));
    }
    adoptHud(await send({ type: "vt-hud" }));
    // Retired, or stopped while we waited: a pill mounted now would paint a
    // recording that has ended. (A HUD stop keeps a HUD only once mounted.)
    if (window.__vitrinkaRecorder !== self || !self.live) return;
    if (!globalThis.VitrinkaHud) {
      console.warn("vitrinka: the HUD bundle did not load — recording without the pill");
      return;
    }
    unmountHud = globalThis.VitrinkaHud.mount(controller, { title: () => document.title, storage });
  })().catch((e) => console.warn("vitrinka: the HUD failed to mount", e)).finally(() => hudMountedDone());
})();
