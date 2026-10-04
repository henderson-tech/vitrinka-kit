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
    return (el.innerText || el.value || "").trim().slice(0, 80);
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

  const captureClick = (e) => {
    if (stopped || picking) return; // pick mode owns the click
    const el = e.target instanceof Element ? (e.target.closest("a,button,[role=button],input,select,textarea,label") || e.target) : null;
    if (!el || hud.contains(el)) return;
    send({
      type: "vt-click", route: location.pathname,
      payload: {
        selector: shortSelector(el),
        text: clickText(el),
        rect: imageRect(el),
      },
    });
  };
  document.addEventListener("click", captureClick, true);

  // -------------------------------------------------------------------------
  // rrweb (D3): batch events to the SW every 2s; SW uploads them as chunks

  let rrBuf = [];
  let stopRR = null;
  let stopped = false;
  const emitRR = (ev) => { if (!stopped) rrBuf.push(ev); };
  try {
    // rrweb ≥2.x UMD exposes a module object ({record}); ≤alpha.4 exposed the
    // bare function. Accept both so a bundle swap can't silently stop recording.
    const rrRec = typeof rrwebRecord === "function" ? rrwebRecord
      : (typeof rrwebRecord === "object" && rrwebRecord && rrwebRecord.record);
    if (typeof rrRec === "function") {
      // inlineImages/collectFonts (rrweb-replay decisions D6): assets become
      // data URLs in the event stream so replay is faithful without a proxy.
      // No-CORS cross-origin images can't be inlined (tainted canvas) and
      // stay hotlinked. The SW splits oversized batches into size-bounded
      // chunks (splitRRWebEvents), letting a big full snapshot ride alone up
      // to the 12 MiB wire cap; a single event beyond even that is
      // undeliverable — it is dropped AND surfaced as a ⚠ note on the
      // session timeline (replay may be incomplete from there).
      //
      // Redaction (SaaS data-security decision #2): ask the SW for the
      // engine-computed mask directives first — maskAllInputs is the
      // fail-closed DEFAULT (an unreachable SW still records with every
      // input masked); the policy can only add maskAllText or, self-host
      // only, fullFidelity. The directive mapping itself lives in the shared
      // engine (maskDirectives via the SW's vt-policy response) so DOM
      // semantics can never drift from it; this side only translates the
      // directives into rrweb options. The one-message wait costs
      // milliseconds before the full snapshot.
      send({ type: "vt-policy" }).then((r) => {
        if (stopped) return;
        try {
          // Missing/failed responses cannot establish a workspace's policy.
          const settled = r && r.ok === true && r.mask
            && typeof r.mask.maskAllInputs === "boolean" && typeof r.mask.maskAllText === "boolean";
          const mask = settled ? r.mask : { maskAllInputs: true, maskAllText: true };
          blurShots = !settled || r.pixel === "blur";
          maskInputs = mask.maskAllInputs;
          maskText = mask.maskAllText;
          const opts = { emit: emitRR, inlineImages: true, collectFonts: true };
          if (mask.maskAllInputs) opts.maskAllInputs = true;
          if (mask.maskAllText) {
            opts.maskAllText = true;                                  // rrweb ≥2.x spelling
            opts.maskTextSelector = mask.maskTextSelector || "*";     // alpha-era spelling
          }
          stopRR = rrRec(opts);
        } catch (e) { console.warn("vitrinka: rrweb failed to start", e); }
      }).catch(() => {
        // The message channel itself failed — start anyway, fully masked.
        if (stopped) return;
        try {
          blurShots = maskInputs = maskText = true;
          stopRR = rrRec({ emit: emitRR, inlineImages: true, collectFonts: true,
            maskAllInputs: true, maskAllText: true, maskTextSelector: "*" });
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
  root.innerHTML = `
    <style>
      * { box-sizing: border-box; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; }
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
      .time { font:600 11px/1 ui-monospace, Menlo, monospace; }
      .name { font:500 10px/1 ui-monospace, Menlo, monospace; color:#756e68;
        border-left:1px solid #292526; padding-left:10px; max-width:140px;
        overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
      button { all:unset; cursor:pointer; width:28px; height:28px; border-radius:50%;
        border:1px solid #363132; color:#a8a099; font-size:12px; text-align:center; line-height:28px; }
      button:hover { color:#f0eae4; border-color:#756e68; }
      button:focus-visible, .sendb:focus-visible { outline:2px solid #ff3b57; outline-offset:2px; }
      button.snap { background:#ff3b57; border-color:#ff3b57; color:#fff; }
      .pop { position:absolute; right:0; bottom:52px; width:260px; padding:12px;
        background:#1d1a1b; border:1px solid #292526; border-radius:14px;
        box-shadow:0 8px 30px rgba(0,0,0,.35); display:none; }
      .pop.open { display:block; }
      .pop label { display:flex; align-items:center; gap:7px; font:700 9.5px/1 ui-monospace, Menlo, monospace;
        letter-spacing:.18em; text-transform:uppercase; color:#756e68; }
      .pop label i { width:3px; height:10px; background:#ff3b57; }
      textarea { width:100%; margin-top:8px; padding:8px; min-height:56px; resize:vertical;
        background:#141213; border:1px solid #363132; border-radius:8px; color:#f0eae4; font-size:12px; }
      .row { display:flex; justify-content:space-between; align-items:center; margin-top:8px; }
      .ctx { font:500 9px/1 ui-monospace, Menlo, monospace; color:#756e68; }
      .sendb { all:unset; cursor:pointer; padding:5px 12px; border-radius:7px; background:#ff3b57;
        color:#fff; font-size:11px; font-weight:600; }
    </style>
    <div class="stack">
      <div class="pill" part="pill">
        <span class="dot"></span>
        <span class="time">00:00</span>
        <span class="name"></span>
        <span class="sync" title="everything captured has reached vitrinka">✓</span>
        <button class="b-pause" title="Pause (Alt+Shift+P)">⏸</button>
        <button class="b-note" title="Note (Alt+Shift+N)">✎</button>
        <button class="snap b-snap" title="Snap to vitrinka (Alt+Shift+S)">⌖</button>
      </div>
      <div class="detail"></div>
    </div>
    <div class="pop">
      <label><i></i><span class="pop-title">Note</span></label>
      <textarea placeholder="what's wrong / what to refine…"></textarea>
      <div class="row"><span class="ctx"></span><button class="sendb">↑ Send</button></div>
    </div>`;

  const $ = (sel) => root.querySelector(sel);
  const pill = $(".pill"), pop = $(".pop"), ta = $("textarea");
  const syncEl = $(".sync"), detailEl = $(".detail");

  // Health (recorder-live D4/D5). The pill stays ONE line while everything is
  // fine — a recorder sitting on top of the app under test earns its footprint
  // — and a second line unfolds only for a backlog, an outage, a server-side
  // close, or the wrapping-up drain after Stop. The glyph itself is the
  // at-a-glance answer; the full detail lives in the extension popup.
  const fmtAge = (ms) =>
    ms < 1000 ? "just now" : ms < 60000 ? `${Math.round(ms / 1000)}s` : `${Math.round(ms / 60000)}m`;
  const renderHealth = (h) => {
    if (!h) return;
    let glyph = "✓", cls = "", line = "", bad = false;
    switch (h.state) {
      case "wrapping": {
        const w = h.wrapping || {};
        const total = w.total || 0;
        const sent = Math.max(0, total - (w.left || 0));
        glyph = "⟳"; cls = "busy";
        line = `wrapping up · ${sent}/${total} sent`;
        if (w.blobs) line += ` · ${w.blobs} shot(s) left`;
        break;
      }
      case "offline":
        glyph = "⚠"; cls = "bad"; bad = true;
        line = `offline${h.sinceSyncMs ? " " + fmtAge(h.sinceSyncMs) : ""} · ${h.queued} held · retrying`;
        break;
      case "dead":
        glyph = "⛔"; cls = "bad"; bad = true;
        line = h.deadReason || "this session ended on the server";
        break;
      case "backlog":
        glyph = "⟳"; cls = "busy";
        line = `syncing · ${h.queued} queued`;
        break;
      default:
        // Healthy: ✓ once the server is confirmed to hold everything sent,
        // a quiet · while that reconciliation is still catching up.
        glyph = h.synced ? "✓" : "·";
    }
    syncEl.textContent = glyph;
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
  const openPop = (title, ctx) => {
    $(".pop-title").textContent = title;
    $(".ctx").textContent = ctx || `step · ${location.pathname}`;
    pop.classList.add("open");
    ta.value = "";
    ta.focus();
  };
  $(".b-note").onclick = () => { pendingPick = null; openPop("Note", null); };
  $(".sendb").onclick = () => {
    const text = ta.value.trim();
    pop.classList.remove("open");
    if (pendingPick) {
      send({ type: "vt-snap", route: location.pathname, payload: { ...pendingPick, note: text } });
      pendingPick = null;
    } else if (text) {
      send({ type: "vt-note", payload: { text, route: location.pathname } });
    }
  };
  ta.addEventListener("keydown", (e) => {
    e.stopPropagation();
    // Enter sends (⇧Enter = newline) — the fast path the note exists for.
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); $(".sendb").click(); }
    if (e.key === "Escape") { pop.classList.remove("open"); pendingPick = null; }
  });
  $(".b-pause").onclick = () => send({ type: "vt-pause" }); // state echoes back via vt-paused

  // -------------------------------------------------------------------------
  // element-pick snap (⌖): crosshair, outline hovered element, click → note

  let picking = false;
  const outline = document.createElement("div");
  outline.style.cssText = "all:initial;position:fixed;z-index:2147483646;pointer-events:none;" +
    "border:2px solid #ff3b57;border-radius:6px;box-shadow:0 0 0 4px rgba(255,59,87,.15);display:none;";
  // Annotate-mode chrome: page dim + hint bar — the ⌖ press must be
  // unmistakable (first test: "I click it and get no feedback").
  const dim = document.createElement("div");
  dim.style.cssText = "all:initial;position:fixed;inset:0;z-index:2147483644;pointer-events:none;" +
    "background:rgba(0,0,0,.22);";
  const hint = document.createElement("div");
  hint.style.cssText = "all:initial;position:fixed;top:16px;left:50%;transform:translateX(-50%);" +
    "z-index:2147483646;padding:8px 16px;border-radius:999px;background:#1d1a1b;" +
    "border:1px solid #ff3b57;box-shadow:0 8px 30px rgba(0,0,0,.4);" +
    "font:600 12px/1 -apple-system,BlinkMacSystemFont,sans-serif;color:#f0eae4;";
  hint.textContent = "⌖ annotate — click an element or drag an area · enter sends · esc cancels";
  const startPick = () => {
    if (picking) return;
    picking = true;
    document.body.append(outline, dim, hint);
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
      // Same CSS→image factor as element picks — under a blur policy the
      // keyframe is 96px wide and a raw devicePixelRatio rect would land far
      // outside it.
      const s = imageScale();
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
  const onMessage = (msg, _sender, sendResponse) => {
    if (msg.type === "vt-pick") startPick();
    // A surviving content-script instance (re-injection no-ops) would keep a
    // stale pixel policy across a stop→start with a changed workspace policy
    // — the SW pushes the fresh value at session start.
    else if (msg.type === "vt-policy-push") blurShots = msg.pixel === "blur";
    else if (msg.type === "vt-note-ui") { pendingPick = null; openPop("Note", null); }
    else if (msg.type === "vt-paused") setPaused(msg.paused, msg.elapsedMs);
    else if (msg.type === "vt-health") renderHealth(msg.health);
    else if (msg.type === "vt-stop") {
      stopped = true;
      try { if (typeof stopRR === "function") stopRR(); }
      catch (e) { console.warn("vitrinka: rrweb failed to stop", e); }
      stopRR = null;
      chrome.runtime.onMessage.removeListener(onMessage);
      document.removeEventListener("click", captureClick, true);
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
  };
  chrome.runtime.onMessage.addListener(onMessage);

  document.documentElement.append(hud);
})();
