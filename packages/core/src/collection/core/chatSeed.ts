// The slash-command chat seed a collection view sends to the agent when the
// user starts a chat from a skill-backed collection or one of its records.
// Skill-backed collections have a `/<slug>` command, so seed that. (Feeds are
// skill-less and seeded differently; that branch stays in the view because it
// is i18n-driven.)

/** `/<slug> <message>`, or `/<slug> id=<itemId> <message>` when a specific
 *  record is addressed. The `id=` selector goes BEFORE the free-text message so
 *  the skill's argument parser reads it as a flag rather than as prose. */
export function skillCommandSeed(slug: string, message: string, itemId?: string): string {
  return itemId ? `/${slug} id=${itemId} ${message}` : `/${slug} ${message}`;
}
