// The composer sheet's script (see hud.html for why it is an iframe). Talks
// to the content script over postMessage only: the parent says open/close,
// this page answers with the tester's words. The DRAFT lives here — a cancel
// keeps it until the next send (recorder-hud-polish D3) — and so does the
// board|task choice, reset on every open (a destination is per observation).
(() => {
  const $ = (sel) => document.querySelector(sel);
  const I = (name) => (globalThis.VT_ICONS ? VT_ICONS.html(name) : "");
  $(".closeb").innerHTML = I("close");
  $(".sendb-icon").innerHTML = I("arrow-up");
  const ta = $("textarea");
  const dest = $(".dest");
  const post = (msg) => window.parent.postMessage({ vtHud: true, ...msg }, "*");
  let wantTask = false;
  const setDest = (task) => {
    wantTask = task;
    $(".d-board").setAttribute("aria-pressed", String(!task));
    $(".d-task").setAttribute("aria-pressed", String(task));
  };
  $(".d-board").onclick = () => setDest(false);
  $(".d-task").onclick = () => setDest(true);

  const height = () => $(".pop").getBoundingClientRect().height;
  const open = ({ title, ctx, pick }) => {
    $(".pop-title").textContent = title;
    $(".ctx").textContent = ctx;
    setDest(false);
    dest.classList.toggle("show", !!pick);
    $(".row").classList.toggle("nodest", !pick);
    ta.focus();
    ta.setSelectionRange(ta.value.length, ta.value.length);
    post({ type: "opened", height: height() });
  };
  $(".closeb").onclick = () => post({ type: "close" });
  $(".sendb").onclick = () => {
    const text = ta.value.trim();
    ta.value = "";
    post({ type: "send", text, task: wantTask });
  };
  ta.addEventListener("keydown", (e) => {
    // Enter sends (⇧Enter = newline) — the fast path the note exists for (D4).
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); $(".sendb").click(); }
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") { e.preventDefault(); post({ type: "close" }); }
  });
  new ResizeObserver(() => post({ type: "size", height: height() })).observe($(".pop"));

  window.addEventListener("message", (e) => {
    // Only the embedding page's content script speaks to this frame.
    if (e.source !== window.parent || !e.data || !e.data.vtHud) return;
    if (e.data.type === "open") open(e.data);
  });
  post({ type: "ready", height: height() });
})();
