// Truncating preview for log payloads.
//
// Logs of user-supplied freeform text (prompts, wiki bodies, search
// queries) must never include the full body — partly to keep log
// files small, partly to limit accidental PII / secret leakage when
// logs are shared during debugging. 120 chars + an ellipsis is the
// shape the image-generation logging (PR #780) settled on; this
// module exists so other routes use the same constant rather than
// hand-rolling their own cap.
//
// Usage:
//   log.info("wiki", "page: start", { pageNamePreview: previewSnippet(pageName) });
//
// `null` / `undefined` → empty string, so the logger never has to
// guard against missing input.

const PREVIEW_CHAR_LIMIT = 120;
const ELLIPSIS = "…";

export function previewSnippet(input: string | null | undefined): string {
  if (!input) return "";
  if (input.length <= PREVIEW_CHAR_LIMIT) return input;
  return `${input.slice(0, PREVIEW_CHAR_LIMIT)}${ELLIPSIS}`;
}

/** Collapse newlines so a request-supplied value cannot forge log records.
 *
 *  A slug or id taken straight off `req.params` can contain CR/LF; logged
 *  verbatim it ends the current line and writes attacker-chosen text as what
 *  looks like a separate, legitimate entry. Route it through here for anything
 *  request-derived that reaches `log.*`.
 *
 *  Both CR and LF are replaced individually (not as a `\r\n` pair) so a lone
 *  `\r` — which many log viewers also treat as a line break — cannot slip
 *  through. Substituting a space rather than deleting keeps the original token
 *  boundaries readable during triage. */
export function singleLineForLog(input: string | null | undefined): string {
  if (!input) return "";
  return input.replace(/[\r\n]/g, " ");
}
