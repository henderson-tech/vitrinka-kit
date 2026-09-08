// Popup: shows what recording this tab would join (project/environment via
// the D5 domain rules), and drives start/pause/stop through the SW.
//
// recorder-live D2/D3/D4: this is the recorder's DETAIL surface. Stop shows
// real drain progress instead of a disabled button, the health block spells
// out what the in-page HUD reduces to one glyph, and reaching the board is a
// separate act that appears when the server has actually built it.

import { newerVersion } from "./version.js";

const $ = (id) => document.getElementById(id);
const send = (msg) => new Promise((res) => chrome.runtime.sendMessage(msg, res));

async function config() {
  const { base = "", token = "" } = await chrome.storage.local.get(["base", "token"]);
  return { base: base.replace(/\/$/, ""), token };
}

// Server-controlled strings (environment, pattern, project) are rendered via
// textContent only — never innerHTML — so a hostile server's settings
// can't inject markup into the privileged popup.
function renderSub(env, rest) {
  const sub = $("sub");
  sub.textContent = "";
  const chip = document.createElement("span");
  chip.className = "env";
  chip.textContent = env;
  sub.append(chip, ` · ${rest}`);
}

function fail(text) {
  // A popup newer than the running service worker answers "unknown message"
  // — the popup reloads from disk on every open, the SW only on extension
  // reload. Say so instead of leaking the protocol error.
  if (text === "unknown message") text = "extension updated — reload it in brave://extensions (↻), then retry";
  $("err").textContent = text;
  $("err").classList.remove("hidden");
}

const show = (id, on) => $(id).classList.toggle("hidden", !on);
const fmtBytes = (n) => {
  if (!n) return "0 B";
  const u = ["B", "KB", "MB", "GB"];
  let i = 0;
  while (n >= 1024 && i < u.length - 1) { n /= 1024; i++; }
  return `${n < 10 && i ? n.toFixed(1) : Math.round(n)} ${u[i]}`;
};
const fmtAge = (ms) =>
  ms === null || ms === undefined ? "—"
    : ms < 1500 ? "just now"
    : ms < 60000 ? `${Math.round(ms / 1000)}s ago`
    : `${Math.round(ms / 60000)}m ago`;

// ---------------------------------------------------------------------------
// health + drain rendering

function renderHealth(h) {
  if (!h) return show("healthPanel", false);
  show("healthPanel", h.state !== "idle");
  $("hQueued").textContent = String(h.queued || 0);
  $("hBytes").textContent = fmtBytes(h.bytes || 0);
  $("hSync").textContent = fmtAge(h.sinceSyncMs);
  // The reconciliation itself (D5): what the SERVER says it holds against
  // what this recorder has allocated.
  $("hSeq").textContent = h.serverMaxSeq >= 0 ? `${h.serverMaxSeq} / ${h.localSeq || 0}` : "—";
  const bad = h.state === "offline" || h.state === "dead";
  $("healthPanel").classList.toggle("bad", bad);
  let note = "";
  if (h.state === "dead") note = h.deadReason || "this session ended on the server";
  else if (h.state === "offline") note = `can't reach vitrinka — ${h.queued} item(s) held on disk, retrying${h.error ? ` · ${h.error}` : ""}`;
  else if (h.state === "backlog") note = "catching up — nothing is lost, the queue drains in order";
  else if (h.synced) note = "everything captured has reached vitrinka";
  $("hNote").textContent = note;
  $("hNote").classList.toggle("bad", bad);
  show("hNote", !!note);
}

function renderWrapping(h) {
  const w = (h && h.wrapping) || null;
  show("wrapPanel", !!w);
  if (!w) return;
  const total = Math.max(1, w.total || 0);
  const left = w.left || 0;
  const sent = Math.max(0, total - left);
  $("fQueue").style.width = `${Math.round((sent / total) * 100)}%`;
  $("nQueue").textContent = `${sent}/${total}`;
  const blobs = w.blobs || 0;
  $("fBlobs").style.width = blobs ? "0%" : "100%";
  $("nBlobs").textContent = blobs ? `${blobs} left` : "done";
}

// ---------------------------------------------------------------------------
// board readiness (D3)

async function renderBoard() {
  const { awaiting, lastBoard } = await chrome.storage.local.get(["awaiting", "lastBoard"]);
  if (awaiting) {
    show("boardPanel", true);
    show("boardOpen", false);
    $("boardState").textContent = "Board building…";
    $("boardMeta").textContent = `${Math.round((Date.now() - awaiting.since) / 1000)}s`;
    return true; // still building — keep polling
  }
  if (lastBoard) {
    show("boardPanel", true);
    show("boardOpen", true);
    $("boardState").textContent = lastBoard.title || "Session";
    $("boardMeta").textContent = "ready";
    $("boardOpen").href = lastBoard.url;
    return false;
  }
  show("boardPanel", false);
  return false;
}

// ---------------------------------------------------------------------------
// main refresh

async function refresh() {
  const { base, token } = await config();
  if (!base) {
    $("proj").textContent = "Not configured";
    $("sub").textContent = "set the vitrinka base URL in settings";
    $("start").disabled = true;
    return;
  }
  $("conn").textContent = new URL(base).host;

  const { rec, health } = await send({ type: "vt-status" });
  renderHealth(health);
  renderWrapping(health);
  const building = await renderBoard();
  if (building) setTimeout(refresh, 1000);

  if (rec) {
    const wrapping = !!rec.stopping;
    $("state").textContent = rec.dead ? "Ended" : wrapping ? "Wrapping up" : rec.paused ? "Paused" : "Recording";
    $("proj").textContent = rec.title || `Session #${rec.sessionId}`;
    renderSub(rec.environment || "?", `${rec.project} · ${Object.keys(rec.tabs).length} tab(s)`);
    show("start", false);
    show("title", false);
    show("recRow", true);
    $("pause").textContent = rec.paused ? "● Resume" : "⏸ Pause";
    $("pause").disabled = wrapping || !!rec.dead;
    $("stop").textContent = wrapping ? "■ Stopping…" : "■ Stop";
    $("stop").disabled = wrapping;
    if (wrapping) setTimeout(refresh, 500);
    return;
  }

  $("state").textContent = "Recorder";
  show("recRow", false);
  show("start", true);
  show("title", true);
  const [active] = await chrome.tabs.query({ active: true, currentWindow: true });
  let host = "";
  try { host = new URL(active.url).host; } catch { /* chrome:// */ }
  if (!host) {
    $("proj").textContent = "No recordable tab";
    $("sub").textContent = "open the app you want to test";
    $("start").disabled = true;
    return;
  }
  try {
    const headers = token ? { authorization: `Bearer ${token}` } : {};
    const r = await (await fetch(`${base}/api/v1/projects/resolve?host=${encodeURIComponent(host)}`, { headers })).json();
    if (r.matched) {
      $("proj").textContent = r.project;
      renderSub(r.environment, `${host} · rule ${r.pattern}`);
      renderRecent(base, headers, r.project);
    } else {
      $("proj").textContent = host;
      $("sub").textContent = "no project domain rule matches — add one in vitrinka project settings";
      $("start").disabled = true;
    }
  } catch (e) {
    fail(`cannot reach vitrinka: ${e.message || e}`);
    $("start").disabled = true;
  }
}

$("start").onclick = async () => {
  $("start").disabled = true;
  $("err").classList.add("hidden");
  const r = await send({ type: "vt-start", title: $("title").value.trim() });
  if (!r.ok) { fail(r.error); $("start").disabled = false; return; }
  refresh();
};
$("pause").onclick = async () => { await send({ type: "vt-pause" }); refresh(); };

// Stop keeps the popup OPEN and reports the real drain (D2). The work runs in
// the service worker, so closing the popup mid-drain is safe — the upload
// continues and the board notification still arrives.
$("stop").onclick = async () => {
  $("stop").disabled = true;
  $("stop").textContent = "■ Stopping…";
  $("err").classList.add("hidden");
  const pending = send({ type: "vt-stop" });
  const tick = setInterval(refresh, 400);
  const r = await pending;
  clearInterval(tick);
  if (!r.ok) {
    fail(r.error);
    $("stop").disabled = false;
    $("stop").textContent = "■ Stop again";
  }
  refresh();
};

// V3: continue an earlier journey — recent sessions of the resolved project.
async function renderRecent(base, headers, project) {
  try {
    const { sessions = [] } = await (await fetch(`${base}/api/v1/sessions?project=${encodeURIComponent(project)}&limit=4`, { headers })).json();
    const done = sessions.filter((s) => s.status === "done");
    if (!done.length) return;
    const box = $("recent");
    box.classList.remove("hidden");
    box.textContent = "";
    const label = document.createElement("div");
    label.className = "recent-label";
    label.textContent = "continue a journey";
    box.append(label);
    for (const s of done) {
      const btn = document.createElement("button");
      btn.className = "recent-row";
      const title = document.createElement("span");
      title.className = "recent-title";
      title.textContent = s.title || `Session #${s.id}`;
      const meta = document.createElement("span");
      meta.className = "recent-meta";
      meta.textContent = `${s.eventCount} ev · ${new Date(s.startedAt).toLocaleDateString()}`;
      btn.append(title, meta);
      btn.onclick = async () => {
        btn.disabled = true;
        const r = await send({ type: "vt-continue", sessionId: s.id });
        if (!r.ok) { fail(r.error); btn.disabled = false; return; }
        refresh();
      };
      box.append(btn);
    }
  } catch { /* recent list is best-effort */ }
}

$("options").onclick = (e) => { e.preventDefault(); chrome.runtime.openOptionsPage(); };

refresh();

// ---------------------------------------------------------------------------
// Updates. Unpacked extensions never auto-update, but Chrome re-reads the
// folder on reload — so with the `vitrinka` CLI registered as a native host the
// whole update is one button: the CLI swaps the files, we reload into them.
//
// Without the host (no CLI on this machine) the button degrades to what it was
// before: a link to the marketplace and the manual download → unzip → ↻ route.
const MARKET = "https://releases.vitrinka.ai";
const btn = $("update");

function showUpdate(text, onClick, enabled = true) {
  btn.textContent = text;
  btn.disabled = !enabled;
  btn.onclick = onClick || null;
  btn.classList.remove("hidden");
}

// reloadInto — activate files already on disk. No host call, so it works with
// the shelf unreachable; the recording guard still applies, because a reload
// tears down the CDP attach either way.
async function reloadInto(to) {
  const { rec } = await chrome.storage.local.get("rec");
  if (rec) {
    showUpdate("✗ stop the recording first — reloading restarts the extension", () => reloadInto(to));
    return;
  }
  showUpdate(`✓ ${to} is on disk — reloading…`, null, false);
  setTimeout(() => chrome.runtime.reload(), 700);
}

async function installUpdate(to) {
  showUpdate(`↑ installing ${to}…`, null, false);
  const r = await send({ type: "vt-ext-update" });
  if (!r || !r.ok) {
    // A live recording refuses the reload — say so on the button itself, and
    // let a second click retry once the tester has stopped.
    showUpdate(`✗ ${(r && r.error) || "update failed"} — click to retry`, () => installUpdate(to));
    return;
  }
  showUpdate(`✓ ${r.to} installed — reloading…`, null, false);
  // The reload tears this popup down with the extension; the pause lets the
  // line land first so a fast update doesn't just look like a flicker.
  setTimeout(() => chrome.runtime.reload(), 700);
}

// The no-host path still needs to know a release exists, so it asks the
// marketplace itself — at most every 6h, cached exactly as it always was. An
// explicit click skips the cache; that is the point of asking.
async function marketLatest(force = false) {
  const { updateSeen } = await chrome.storage.local.get("updateSeen");
  const now = Date.now();
  if (!force && updateSeen && now - updateSeen.at < 6 * 3600 * 1000) return updateSeen.version || "";
  const r = await fetch(`${MARKET}/api/releases/vitrinka-recorder/latest`);
  if (!r.ok) return "";
  const version = (await r.json()).version || "";
  await chrome.storage.local.set({ updateSeen: { version, at: now } });
  return version;
}

// checkUpdates — runs on every popup open, and again on demand from the footer.
// `manual` only changes what silence looks like: opening the popup says nothing
// when you are current, but an explicit click has to answer.
async function checkUpdates(manual = false) {
  const foot = $("check");
  const running = chrome.runtime.getManifest().version;
  if (manual) { foot.textContent = "checking…"; foot.disabled = true; }
  try {
    const st = await send({ type: "vt-ext-status" });
    if (!st) throw new Error("the recorder did not answer");
    // Already swapped on disk by `vitrinka extension update` in a terminal —
    // the files are HERE, so activating them is a plain reload. Deliberately not
    // installUpdate(): that sends vt-ext-update, whose host handler asks the
    // shelf for the latest release first, so routing through it would make an
    // offline machine unable to activate what it has already downloaded.
    if (st.staged) {
      showUpdate(`↑ ${st.disk} is installed — click to reload into it`, () => reloadInto(st.disk));
      // Staged and check-failed are not exclusive: the host can have a newer
      // folder on disk AND have failed to reach the shelf. Activating the disk
      // copy is still right, but the footer must not imply the check succeeded.
      foot.textContent = st.checkFailed ? `v${running} · check failed` : `v${running}`;
      if (st.checkFailed && manual) console.warn("vitrinka: update check failed —", st.error);
      return;
    }
    if (st.host === "ok") {
      if (st.available) {
        showUpdate(`↑ update to ${st.latest} — click to install`, () => installUpdate(st.latest));
        foot.textContent = `v${running}`;
      } else if (st.checkFailed) {
        // The host could not reach the shelf. Saying "up to date" here would be
        // a false success on the one surface that exists to answer honestly.
        foot.textContent = `v${running} · check failed`;
        if (manual) console.warn("vitrinka: update check failed —", st.error);
      } else {
        foot.textContent = manual ? `v${running} · up to date` : `v${running} · check`;
      }
      return;
    }
    // No CLI host on this machine — the pre-host manual route, unchanged.
    const latest = await marketLatest(manual);
    if (latest && newerVersion(latest, running)) {
      showUpdate(`↑ update ${latest} available — download, unzip over the folder, ↻ reload`, () => {
        chrome.tabs.create({ url: `${MARKET}/get/vitrinka-recorder` });
      });
      foot.textContent = `v${running}`;
    } else {
      foot.textContent = latest && manual ? `v${running} · up to date` : `v${running} · check`;
    }
  } catch (e) {
    // Never break the popup over the update banner — but an explicit click
    // must not look like it silently worked either.
    foot.textContent = manual ? `v${running} · check failed` : `v${running} · check`;
    if (manual) console.warn("vitrinka: update check failed", e);
  } finally {
    foot.disabled = false;
  }
}

$("check").onclick = () => checkUpdates(true);
checkUpdates();
