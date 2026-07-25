# fix: gate the whisper optional-dep announcement on voice-input opt-in

Issue: https://github.com/receptron/mulmoclaude/issues/2553

## Problem

`announceOptionalDeps` warns (log + bell) for every missing optional binary at boot,
including `whisper-server`. Voice input ships OFF (`settings.voiceInput.enabled`
defaults to false), so users who never use it still get a "whisper-server unavailable —
voiceInput degraded" warn + bell on every start. No API key is involved (local whisper.cpp).

## Fix

Only announce a missing optional dep when its feature is wanted.

- Add a pure `shouldAnnounceDep(depId, settings)` in `server/system/announceOptionalDeps.ts`:
  opt-in deps (currently just `whisper` → `voiceInput.enabled`) are announced only when
  enabled; everything else (`docker`, `ffmpeg`) always announces.
- `announceOptionalDeps(settings)` takes settings and `continue`s past a gated-off dep,
  suppressing BOTH the `log.warn` and the bell notification.
- Caller `server/index.ts` passes `loadSettings()`.
- Update the 2 existing degradation-test call sites to pass a settings object.

## Tests

- Unit: `shouldAnnounceDep` — whisper gated (enabled true→announce, false/undefined→skip);
  docker/ffmpeg always true.
- Integration: with whisper absent in the seed, `announceOptionalDeps` emits no `deps` warn
  when voice input is disabled, and does emit one when enabled.
