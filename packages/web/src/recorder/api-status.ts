/**
 * Transport-status vocabulary — ONE copy lives in `@vitrinka/link` (the
 * zero-dependency package every recorder already depends on); this module
 * keeps the import path stable for `api.ts` and the tests.
 */
export { permanentStatus, VitrinkaApiError } from '@vitrinka/link';
