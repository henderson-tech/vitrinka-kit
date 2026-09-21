/**
 * @vitrinka/web — the vitrinka toolkit for React DOM apps.
 *
 * The root export carries only the wire protocol types; the tools live on
 * subpaths so an app bundles exactly what it imports:
 *
 *   @vitrinka/web/recorder   journey recorder (VitrinkaRecorderRoot, VitrinkaRecorderPill)
 *   @vitrinka/web/next       withVitrinkaRecorder (next.config.js build guard, Node-only)
 *   @vitrinka/web/protocol   recorder↔server wire types
 */
export type * from './protocol';
