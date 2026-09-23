import { vtHeaders } from "./wire.js";

const $ = (id) => document.getElementById(id);
const send = (msg) => new Promise((res) => chrome.runtime.sendMessage(msg, res));
// Status line = manifest icon (check / circle-x) + words. The words can carry
// CLI/server strings, so they land as a text node — only the icon is markup.
const status = (el, icon, text, cls) => {
  el.textContent = "";
  if (icon) el.insertAdjacentHTML("beforeend", VT_ICONS.html(icon) + " ");
  el.append(text);
  el.className = cls || "";
};

chrome.storage.local.get(["base", "workspace", "token"]).then(({ base = "", workspace = "", token = "" }) => {
  $("base").value = base;
  $("workspace").value = workspace;
  $("token").value = token;
});

// The background seeds empty settings from the CLI on first run; this is the
// override for a machine whose saved token has gone stale — the CLI's copy is
// the one `vitrinka login` refreshes.
$("fromCli").onclick = async () => {
  const st = $("status");
  st.textContent = "asking the vitrinka CLI…";
  st.className = "";
  const r = await send({ type: "vt-ext-config" });
  if (!r || !r.ok) {
    status(st, "circle-x", r && r.absent
      ? "no vitrinka CLI registered on this machine — run: vitrinka setup extension setup"
      : (r && r.error) || "the CLI did not answer", "bad");
    return;
  }
  if (r.base) $("base").value = String(r.base).replace(/\/$/, "");
  if (r.workspace) $("workspace").value = r.workspace;
  if (r.token) $("token").value = r.token;
  // An older CLI answers without a workspace. Say so rather than leaving the
  // field blank and letting the first call fail with workspace_required.
  status(st, "check",
    !r.token ? "base URL filled; the CLI has no token (run: vitrinka login)"
      : !r.workspace ? "filled, but the CLI named no workspace — type one, then Save & test"
        : "filled — hit Save & test",
    r.token && r.workspace ? "ok" : "bad");
};

// Device link (recorder decisions 2026-09-21 D5): the same dance the CLI and
// the in-app recorders use. Start → show the code, the approve link and the
// server-rendered QR → poll the claim → store an ingest-only vkr_ token pinned
// to the workspace the approver picked. Nothing here needs the CLI.
let linkAbort = null;
const linkOrigin = (base) => new URL(base).origin;
$("link").onclick = async () => {
  const base = $("base").value.trim().replace(/\/$/, "");
  const st = $("linkStatus");
  if (!base) {
    status(st, "circle-x", "type the base URL first", "bad");
    return;
  }
  if (linkAbort) linkAbort.abort();
  const ac = new AbortController();
  linkAbort = ac;
  const origin = linkOrigin(base);
  status(st, null, "asking vitrinka for a code…", "");
  let start;
  try {
    const res = await fetch(`${origin}/api/v1/cli/auth`, {
      method: "POST", headers: { "content-type": "application/json" }, signal: ac.signal,
      body: JSON.stringify({ kind: "recorder", label: `${browserName()} on ${osName()} · extension` }),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    start = await res.json();
  } catch (e) {
    status(st, "circle-x", `could not start: ${e.message || e}`, "bad");
    return;
  }
  const verifyUrl = start.verify_url || origin + start.verify_path;
  $("linkCode").textContent = start.user_code;
  $("linkOpen").href = verifyUrl;
  $("linkQr").src = origin + start.qr_path;
  $("linkBox").hidden = false;
  status(st, null, "waiting for approval…", "");
  const interval = Math.max(2, Number(start.interval) || 2) * 1000;
  const deadline = Date.now() + (Number(start.expires_in) || 600) * 1000;
  while (!ac.signal.aborted && Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, interval));
    let res;
    try {
      res = await fetch(`${origin}/api/v1/cli/auth/claim`, {
        method: "POST", headers: { "content-type": "application/json" }, signal: ac.signal,
        body: JSON.stringify({ device_code: start.device_code }),
      });
    } catch (e) {
      if (ac.signal.aborted) return;
      continue;
    }
    if (res.status === 202) continue;
    if (res.status === 404) {
      status(st, "circle-x", "code expired — link again", "bad");
      $("linkBox").hidden = true;
      return;
    }
    if (!res.ok) {
      status(st, "circle-x", `HTTP ${res.status}`, "bad");
      return;
    }
    const claim = await res.json();
    await chrome.storage.local.set({ base, workspace: claim.workspace || "", token: claim.token });
    $("workspace").value = claim.workspace || "";
    $("token").value = claim.token;
    $("linkBox").hidden = true;
    status(st, "check", `linked — records into ${claim.workspace || "your workspace"}`, "ok");
    return;
  }
  if (!ac.signal.aborted) {
    status(st, "circle-x", "code expired — link again", "bad");
    $("linkBox").hidden = true;
  }
};

function browserName() {
  const ua = navigator.userAgent;
  if (/Edg\//.test(ua)) return "Edge";
  if (/OPR\//.test(ua)) return "Opera";
  if (/Brave/.test(ua) || navigator.brave) return "Brave";
  if (/Chrome\//.test(ua)) return "Chrome";
  return "Browser";
}
function osName() {
  const ua = navigator.userAgent;
  if (/Mac OS X/.test(ua)) return "macOS";
  if (/Windows/.test(ua)) return "Windows";
  if (/Android/.test(ua)) return "Android";
  if (/Linux/.test(ua)) return "Linux";
  return "this device";
}

$("save").onclick = async () => {
  const base = $("base").value.trim().replace(/\/$/, "");
  const workspace = $("workspace").value.trim();
  const token = $("token").value.trim();
  await chrome.storage.local.set({ base, workspace, token });
  const st = $("status");
  st.textContent = "testing…";
  st.className = "";
  try {
    const headers = vtHeaders(token, workspace);
    const res = await fetch(`${base}/api/v1/version`, { headers });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    status(st, "check", `connected (${(await res.json()).cli || "ok"})`, "ok");
  } catch (e) {
    status(st, "circle-x", String(e.message || e), "bad");
  }
};

// ---------------------------------------------------------------------------
// Recorder data (recorder-live D9). Nothing is dropped to make room (D8), so
// usage needs a visible home: per-session rows, an automatic sweep of what the
// SERVER says is finished, and a manual clear-all for everything else.

const fmtBytes = (n) => {
  if (!n) return "0 B";
  const u = ["B", "KB", "MB", "GB"];
  let i = 0;
  while (n >= 1024 && i < u.length - 1) { n /= 1024; i++; }
  return `${n < 10 && i ? n.toFixed(1) : Math.round(n)} ${u[i]}`;
};

function row(label, value, live) {
  const el = document.createElement("div");
  el.className = "r" + (label === "total" ? " total" : "");
  const l = document.createElement("span");
  l.textContent = label;
  if (live) l.className = "live";
  const v = document.createElement("span");
  v.textContent = value;
  el.append(l, v);
  return el;
}

async function renderStorage() {
  const [stats, { rec }] = await Promise.all([
    send({ type: "vt-storage" }),
    chrome.storage.local.get("rec"),
  ]);
  const box = $("rows");
  box.textContent = "";
  if (!stats || !stats.count) {
    box.append(row("nothing queued", "0 B"));
    return;
  }
  for (const [sessionId, s] of Object.entries(stats.bySession)) {
    const live = rec && String(rec.sessionId) === String(sessionId);
    box.append(row(`session #${sessionId}${live ? " · recording" : ""}`,
      `${s.count} item(s) · ${fmtBytes(s.bytes)}`, live));
  }
  box.append(row("total", `${stats.count} item(s) · ${fmtBytes(stats.bytes)}`));
}

$("reap").onclick = async () => {
  const st = $("dataStatus");
  st.textContent = "checking with vitrinka…";
  st.className = "";
  const r = await send({ type: "vt-reap" });
  if (r && r.ok) status(st, "check", "finished sessions cleared", "ok");
  else status(st, "circle-x", (r && r.error) || "failed", "bad");
  renderStorage();
};

$("clear").onclick = async () => {
  if (!confirm("Delete every queued recording still held on this machine?")) return;
  const st = $("dataStatus");
  const r = await send({ type: "vt-clear-all" });
  if (r && r.ok) status(st, "check", "cleared", "ok");
  else status(st, "circle-x", (r && r.error) || "failed", "bad");
  renderStorage();
};

renderStorage();
