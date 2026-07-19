// Auto-scroll the sidebar chat list to the bottom when new results
// arrive or a run starts. Also re-focuses the chat input when a run
// finishes.
//
// Following is gated on the reader still being at the bottom: streaming
// appends fire this watch on every chunk, and forcing the scroll each
// time dragged the view out from under anyone who had scrolled up to
// read (#2179). A run starting is treated as an explicit user action
// (they just sent something), so that one re-arms and jumps.

import { computed, nextTick, watch, type ComputedRef, type Ref } from "vue";
import type { ToolResultComplete } from "gui-chat-protocol/vue";
import { useStickToBottom } from "./useStickToBottom";

export function useChatScroll<T extends { focus: () => void }>(opts: {
  sessionSidebarRef: Ref<{ root: HTMLDivElement | null } | null>;
  toolResults: ComputedRef<ToolResultComplete[]>;
  isRunning: ComputedRef<boolean>;
  chatInputRef: Ref<T | null>;
}) {
  const { sessionSidebarRef, toolResults, isRunning, chatInputRef } = opts;

  const chatListRef = computed(() => sessionSidebarRef.value?.root ?? null);
  const { stuck, resume } = useStickToBottom(chatListRef);
  // Key that changes both on new results AND on streaming updates to
  // the last text card (which appends in place, leaving length stable).
  const latestResultScrollKey = computed(() => {
    const list = toolResults.value;
    const last = list[list.length - 1];
    return `${list.length}:${last?.uuid ?? ""}:${last?.message?.length ?? 0}`;
  });

  function scrollChatToBottom(options: { force?: boolean } = {}): void {
    if (!options.force && !stuck.value) return;
    // Scrolling after the DOM settles is the whole point; callers are sync and
    // have nothing to do with the tick's completion.
    void nextTick(() => {
      if (chatListRef.value) {
        chatListRef.value.scrollTop = chatListRef.value.scrollHeight;
      }
    });
  }

  function focusChatInput(): void {
    chatInputRef.value?.focus();
  }

  watch(latestResultScrollKey, () => scrollChatToBottom());
  watch(isRunning, (running) => {
    if (running) {
      resume();
      scrollChatToBottom({ force: true });
    } else {
      void nextTick(() => focusChatInput());
    }
  });

  return { scrollChatToBottom, focusChatInput, stuckToBottom: stuck };
}
