# Chrome Web Store listing — Vitrinka Journey Recorder

The submission source of truth: listing copy, the single-purpose statement,
and the per-permission justifications the review form asks for. Keep this in
lockstep with `apps/extension/manifest.json` and `docs/PROTOCOL.md`.

## Single purpose

Record manual-testing sessions of the user's own web applications —
screenshots, interactions, network activity, console errors, and typed notes —
and upload them exclusively to the vitrinka server the user configures, where
they become reviewable testing boards.

## Store description (draft)

> **Record manual-testing journeys into vitrinka.**
>
> Start a session, click through your app, stop — and get a journey board:
> every step as a screenshot wired to your clicks, failed API calls folded in,
> console errors, a scrubbable DOM replay, and your notes as annotations a
> teammate (or an AI agent) can pick up as work items.
>
> Built for testing **your own applications**: sessions upload only to the
> vitrinka server you configure — no third-party telemetry, no data collection
> by us. The extension's full source is public: github.com/henderson-tech/vitrinka-kit
> — including a plain-language contract of exactly what is captured
> (docs/PROTOCOL.md).
>
> Requires a vitrinka server (your team's instance and access token).
> Learn more at vitrinka.ai.

## Permission justifications

| Permission | Why it is needed |
|---|---|
| `debugger` | The core capture mechanism: Chrome DevTools Protocol is the only API that provides full request/response bodies and console/exception events for the recorded tab. Attached only to tabs in a session the user explicitly started; Chrome's "is debugging this browser" banner stays visible throughout; detached on stop. |
| `tabs` + `webNavigation` | Resolve which project a tab belongs to (domain rules), follow SPA navigations as journey steps, and let same-project tabs join the session. |
| `scripting` | Inject the content script (click capture, HUD, DOM stream) into session tabs. |
| `<all_urls>` | The user's applications live on arbitrary domains (localhost, staging, preview URLs); which hosts actually record is governed by the user's own per-project domain rules. Capture never runs outside a started session. |
| `storage` + `unlimitedStorage` | Configuration and the durable upload queue — sessions keep recording through server outages; screenshots and DOM chunks buffer locally (IndexedDB) until delivered, and nothing is silently dropped. |
| `alarms` | Retry/reconcile timers for the upload queue across service-worker restarts. |
| `notifications` | One notification when the finished board is ready. |
| `nativeMessaging` | Optional integration with the `vitrinka` CLI on the user's machine (configuration hand-off and, for unpacked installs, in-place updates). Store installs work without the CLI. |

## Privacy disclosure (data-usage form)

- **What is collected**: screenshots, interaction events, network
  request/response data, console errors, and notes — of the pages the user
  records, during sessions the user starts.
- **Where it goes**: solely to the vitrinka server URL the user configures
  (their own infrastructure). The developer receives nothing; there is no
  analytics, telemetry, or third-party endpoint.
- **Secrets**: network capture is a testing feature for the user's own apps;
  the companion Expo recorder redacts secret-shaped keys, and the same
  hardening is planned here (tracked in the public repo). Users are
  instructed to record only against environments they own.

## Submission checklist

- [ ] Developer account verified; publisher name decided
- [ ] Screenshots: popup (project resolved), HUD mid-session, a finished
      journey board, options page
- [ ] 128px icon = `apps/extension/marketplace-icon.png`
- [ ] Listing links: homepage → https://vitrinka.ai, support → vitrinka-kit
      repo issues (repo must be public first — the description links it as
      the source)
- [ ] `dist.sh` **store** zip uploaded (`vitrinka-recorder-store-*.zip` — the
      `key`-stripped variant; the Web Store rejects a first upload whose
      manifest contains `key`); store version == `manifest.json` version
- [ ] Post-approval: fill the store URL into `apps/extension/INSTALL.md`
- [ ] Post-approval: the store install has its own extension ID (the store
      signs with its own key, so it differs from the pinned unpacked ID) —
      add it to the vitrinka CLI native-messaging host `allowed_origins` if
      store installs should reach the CLI
