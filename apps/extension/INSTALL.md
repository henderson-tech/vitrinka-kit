# Install the Vitrinka Journey Recorder (Chrome / Brave / Edge)

The recorder is a plain unpacked MV3 extension — no Web Store, no build step.
The `vitrinka` CLI installs it and keeps it current, so updates are one click in
the popup instead of a download-and-reload chore.

## 1. Install it

`vitrinka install` offers the recorder as one of its steps, naming the browsers
it found — so on a machine you have already onboarded, re-running it is enough.
Or go straight at it:

```sh
vitrinka setup extension setup
```

Either way that downloads the current release into
`~/.config/vitrinka/extension`, verifies its checksum, and registers the CLI as
a native-messaging host for every Chromium browser it detects (that registration
is what lets the popup update the extension in place later). Install another
browser later and `vitrinka doctor --fix` registers it too.

Then load it once:

1. Open `chrome://extensions` (or `brave://extensions` / `edge://extensions`).
2. Turn on **Developer mode** (top-right toggle).
3. Click **Load unpacked** and pick `~/.config/vitrinka/extension`.
4. Check the id reads `lidjccailicbgjdfaplpgmbmmecehlfo`.
5. Pin "Vitrinka Journey Recorder" from the puzzle-piece menu so the popup is
   one click away.

Keep that folder where it is — the CLI updates it in place, and Chrome loads
from it, so moving or deleting it uninstalls the extension.

**No CLI on this machine?** Download and unzip
`vitrinka-recorder-<version>.zip` from
https://apps.fixit.app/get/vitrinka-recorder and load that folder instead.
Everything records the same way; only in-place updating needs the CLI.

## 2. Connect it to vitrinka

Nothing to do, usually: on first load the extension asks the CLI for this
machine's base URL, workspace and token and fills them in. You need the options
page only to override them:

1. Right-click the extension icon → **Options** (or the ⚙ link in the popup).
2. **Base URL**: `https://app.vitrinka.ai`, or your own instance's origin.
3. **Workspace**: the slug of the workspace to record into. A personal token
   acts in EVERY workspace you belong to, so without this the server refuses
   with `workspace_required` the moment you belong to more than one — the
   popup says so in as many words rather than blaming your domain rules.
4. **Token**: a `vkp_` personal access token — mint one in vitrinka under
   Settings → tokens, or hit **Fill from the vitrinka CLI** to re-take the one
   `vitrinka login` saved, workspace included. Then **Save & test**.

## 3. Record a journey

- Open the app you're testing. If its domain is mapped to a vitrinka project
  (project settings → domains), the popup shows the resolved project — hit
  **Start**. Other tabs on the same project's domains join automatically.
- The corner HUD shows rec · timer · pause · a pencil (note) · a crosshair (annotate).
  Shortcuts: `Alt+Shift+A` annotate (click an element or drag a region, type
  a note, Enter sends), `Alt+Shift+N` note, `Alt+Shift+P` pause.
- Before sending a snap, pick where it lands: **board** leaves it as an
  annotation on the frame, **task** also files it as a draft on the project for
  triage. The choice resets to board each time — and only ↑ Send commits it.
- **Stop** (popup) projects the session into a journey board and opens it —
  screenshots wired by your clicks, network failures folded in, timeline
  inspector on the left. Crosshair annotations land as real board annotations.
- Finished a session too early? The popup's **continue a journey** list
  reopens a recent one and appends to the same board.

## Updating

Opening the popup checks for a release. When a newer one exists it shows **↑
update to \<version\> — click to install**; clicking it is the whole update — the
CLI downloads the release, verifies its checksum, swaps the folder, and the
extension reloads into it. Settings survive (they live in
`chrome.storage.local`, not in the folder).

The popup's footer carries the running version and doubles as an explicit
**check** button, for when you want an answer rather than silence.

It refuses while a recording is live — a reload would tear down the CDP attach
mid-session. Stop first, then update.

From a terminal instead:

```sh
vitrinka setup extension update          # install the newest release
vitrinka setup extension update --check  # just say whether one exists
```

A terminal update is picked up by the running extension within the hour; open
the popup and click **reload into it** to apply it now.

### When something is off

```sh
vitrinka doctor        # check every link in the chain
vitrinka doctor --fix  # re-register the host, rewrite the shim
```

`doctor --fix` is the answer after you reinstall the CLI (a global reinstall can
move `node` or the CLI itself, and the host shim bakes both paths in).

Loaded from a zip with no CLI? Then the banner stays the old manual one:
download from https://apps.fixit.app/get/vitrinka-recorder, unzip **over the
same folder**, and hit ↻ on the extension's card.

### Moving off a hand-unzipped install

The extension now pins its id, so a folder you unzipped yourself and the
CLI-managed one are *different extensions* to Chrome. Migrate once:

1. Stop any recording.
2. `vitrinka setup extension setup`
3. Load `~/.config/vitrinka/extension` as above.
4. **Remove the old card** in `chrome://extensions` — otherwise both copies
   answer `Alt+Shift+…` and both try to record.
5. Re-check the options page: the new install seeds base URL, workspace and
   token from the CLI, but anything you had pasted by hand into the old copy
   does not carry over (different id, different storage).

## Notes & quirks

- Chrome shows an "is debugging this browser" banner while recording — that
  is the CDP network capture (expected; closing it detaches capture).
- DevTools open on the same tab wins over the recorder: network bodies
  degrade gracefully for that tab.
- Everything is captured (bodies, headers, DOM) by design, bounded by your
  workspace's redaction policy. Don't record against third-party production
  sites.
- Full capture matrix + known limits: `README.md` in this folder.
