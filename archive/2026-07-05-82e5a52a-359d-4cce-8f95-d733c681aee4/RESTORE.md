# Restore "ほしい物リスト（Hisashi）" (collection `wishlist`)

This folder is an automatic backup made when the collection was deleted.
Follow these steps to restore it.

1. Recreate the skill files in `data/skills/wishlist/` using the **Write
   tool**: read each file under `skill/` and Write it to the matching
   path — `SKILL.md`, `schema.json`, and any `templates/*`.

   IMPORTANT — use the Write tool, NOT `cp` / `mv` / a shell redirect.
   The skill-bridge hook mirrors `data/skills/wishlist/` into
   `.claude/skills/wishlist/`, and that mirror is what actually registers
   the collection. The hook only fires on Write/Edit tool calls, so a
   `cp` would leave the files in staging with no `.claude/skills/`
   mirror — the collection would stay invisible. (Writing
   `.claude/skills/` directly is not an option either: that path is
   permission-gated.)

2. Copy the item data: `cp` every file under `records/` into
   `data/wishlist/items/`. The records are part of the collection and
   must be restored. They are plain data files (NOT bridged), so use
   `cp` — the Write-tool rule in step 1 applies ONLY to the skill
   files, not to these records (there may be many; copy them, do not
   Write them one by one).

3. Confirm the collection reappears at `/collections/wishlist`.

- slug: `wishlist`
- title: ほしい物リスト（Hisashi）
- dataPath: `data/wishlist/items`
