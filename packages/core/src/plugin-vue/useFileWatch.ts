// Per-file change subscription over the host-agnostic runtime pubsub, shared by
// the html and markdown plugin Views (a plugin can't import another plugin, so
// this lives in core). It subscribes to the plugin-scoped `file:<path>` channel
// (resolves to `plugin:<pkg>:file:<path>`) and bumps a monotonic `version` ref on
// each `{ mtimeMs }` event. The host forwards its workspace file-change events
// onto that channel; if it doesn't, live-refresh simply never fires (self-saves
// already update local state optimistically).

import { ref, watch, onUnmounted, type Ref } from "vue";
import { useRuntime } from "gui-chat-protocol/vue";
import { fileWatchChannel, nextFileVersion, type FileChangePayload } from "./fileWatch.ts";

export function useFileWatch(filePath: Ref<string | null>): { version: Ref<number> } {
  const version = ref(0);
  const { pubsub } = useRuntime();
  let unsubscribe: (() => void) | null = null;

  function bind(nextPath: string | null): void {
    unsubscribe?.();
    unsubscribe = null;
    version.value = 0;
    if (!nextPath) return;
    unsubscribe = pubsub.subscribe<FileChangePayload>(fileWatchChannel(nextPath), (data) => {
      version.value = nextFileVersion(version.value, data);
    });
  }

  watch(filePath, bind, { immediate: true });
  onUnmounted(() => {
    unsubscribe?.();
    unsubscribe = null;
  });

  return { version };
}
