// wire.js — how this browser addresses a vitrinka instance, in ONE place,
// shared by the service worker, the popup and the options page so the three
// surfaces can never disagree about what a request carries.
//
// A `vkp_` personal access token acts in EVERY workspace its owner belongs
// to, so the base URL alone is not an address: without a workspace the server
// answers 401 `workspace_required` the moment an account has more than one
// membership. The workspace rides as a header rather than a `/w/<slug>` path
// prefix so the base URL stays the plain origin a human recognises and
// switching workspace is one field — the same spelling the CLI and MCP use.

export const WORKSPACE_HEADER = "X-Vitrinka-Workspace";

// vtHeaders builds the credential headers for a fetch. Both parts are
// optional on purpose: a self-hosted instance with no auth sends neither, and
// a single-workspace account still works without the workspace.
export function vtHeaders(token, workspace, extra) {
  const h = { ...(extra || {}) };
  if (token) h.authorization = `Bearer ${token}`;
  if (workspace) h[WORKSPACE_HEADER] = workspace;
  return h;
}
