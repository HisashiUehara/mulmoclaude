<template>
  <div
    v-if="needsReconnect"
    data-testid="remote-host-offline-banner"
    role="alert"
    class="flex items-center gap-2 px-3 py-2 bg-amber-50 border-b border-amber-200 text-amber-800 text-sm"
  >
    <span class="material-icons text-base" aria-hidden="true">phonelink_off</span>
    <div class="flex-1 min-w-0">
      <div class="font-medium">{{ t("remoteHostOffline.title") }}</div>
      <div class="text-xs text-amber-700 truncate">{{ t("remoteHostOffline.body") }}</div>
    </div>
    <button
      type="button"
      data-testid="remote-host-offline-reconnect"
      class="h-8 px-2.5 flex items-center gap-1 text-sm rounded border border-amber-300 text-amber-800 hover:bg-amber-100 disabled:opacity-40"
      :disabled="busy"
      @click="reconnect"
    >
      <span class="material-icons text-sm" :class="busy ? 'animate-spin' : ''" aria-hidden="true">refresh</span>
      {{ t("remoteHostOffline.reconnect") }}
    </button>
  </div>
</template>

<script setup lang="ts">
// Persistent banner shown when the remote host was meant to be connected but has
// dropped and a silent auto-reconnect couldn't restore it (e.g. the parked
// session expired). Reads the shared `useRemoteHost` store; Reconnect re-runs the
// Google sign-in popup from this click (a user gesture, so the popup isn't blocked).
import { useI18n } from "vue-i18n";
import { useRemoteHost } from "../composables/useRemoteHost";

const { t } = useI18n();
const { needsReconnect, busy, connect } = useRemoteHost();

const reconnect = (): Promise<void> => connect();
</script>
