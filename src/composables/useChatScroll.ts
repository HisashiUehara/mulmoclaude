// Auto-scroll the sidebar chat list to the bottom when new results
// arrive or a run starts. Also re-focuses the chat input when a run
// finishes.
//
// Following is gated on the reader still being at the bottom: streaming
// appends fire this watch on every chunk, and forcing the scroll each
// time dragged the view out from under anyone who had scrolled up to
// read (#2179). A run starting is treated as an explicit user action
// (they just sent something), so that one re-arms and jumps.

import { computed, nextTick, ref, watch, type ComputedRef, type Ref } from "vue";
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

  // Whether output actually arrived while the reader was detached. `stuck`
  // alone can't answer that: scrolling up to re-read something old also
  // un-sticks, and a "new messages" badge shown then would be claiming
  // something that never happened. Set on append-while-detached, cleared the
  // moment following is re-armed.
  const hasNewWhileDetached = ref(false);

  watch(latestResultScrollKey, () => {
    if (!stuck.value) hasNewWhileDetached.value = true;
    scrollChatToBottom();
  });
  watch(stuck, (isStuck) => {
    if (isStuck) hasNewWhileDetached.value = false;
  });
  watch(isRunning, (running) => {
    if (running) {
      resume();
      scrollChatToBottom({ force: true });
    } else {
      void nextTick(() => focusChatInput());
    }
  });

  /** Jump to the newest output and re-arm following. Bound to the "new
   *  messages" affordance — the reader scrolled away, so `scrollChatToBottom`
   *  alone would no-op on the `stuck` gate; resume first, then force. */
  function jumpToLatest(): void {
    resume();
    scrollChatToBottom({ force: true });
  }

  return { scrollChatToBottom, focusChatInput, jumpToLatest, stuckToBottom: stuck, hasNewWhileDetached };
}
