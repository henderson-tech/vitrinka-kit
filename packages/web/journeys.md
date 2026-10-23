# Web overlay journeys

## Window-anchored reporting over a modal

entry: report fixture `/?dialog` and `/?aria-dialog`
roles: reporter

1. Open the page → report button rests 24 px from the window's bottom-right edges.
2. Open the translated, clipped editor and change its month → button stays at the same window corner.
3. Open reporting and type a description → report card stays 24 px from the window's right edge, 96 px above its bottom; the textbox receives focus.
4. Press Escape → only reporting closes; the editor and its draft remain.
5. Reopen reporting → its description remains.
6. Send → acknowledgment appears and the fixture backend receives the description.
7. Close reporting and the editor → button retains its window position and the dialog-associated host is removed.

verified: true · Chromium · disposable fixture backend · spec: `e2e/report.spec.ts`, “the report stays at the window corner above a transformed …”

The native-modal stack and redundant-open-attribute journeys remain covered by the adjacent tests. Safari and Firefox were not run.
