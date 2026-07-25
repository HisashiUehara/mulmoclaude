// The I/O half of the diagnostics report: read the settings, the MCP config,
// the OS and the plugin-collision cache, and hand them to the pure builder.
// Kept apart from `report.ts` so the redaction rules stay testable without a
// workspace on disk — `sandboxEnabled` arrives as a parameter because it's a
// mutable boot-time value owned by server/index.ts.
import { arch, homedir, platform } from "node:os";
import { loadSettings, loadMcpConfig } from "../../system/config.js";
import { APP_VERSION } from "../../system/appVersion.js";
import { collectPluginMetaDiagnostics } from "../../plugins/diagnostics.js";
import { buildSandboxStatus } from "../../api/sandboxStatus.js";
import { env } from "../../system/env.js";
import { buildDiagnosticsReport, type DiagnosticsInput } from "./report.js";

export interface CollectDiagnosticsParams {
  sandboxEnabled: boolean;
  workspacePath: string;
}

export function collectDiagnosticsInput(params: CollectDiagnosticsParams): DiagnosticsInput {
  const home = homedir();
  const sandbox = buildSandboxStatus({
    sandboxEnabled: params.sandboxEnabled,
    sshAgentForward: env.sandboxSshAgentForward,
    configMountNames: env.sandboxMountConfigs,
    sshAuthSock: process.env.SSH_AUTH_SOCK,
  });
  return {
    appVersion: APP_VERSION,
    nodeVersion: process.version,
    platform: platform(),
    arch: arch(),
    home,
    sandboxEnabled: params.sandboxEnabled,
    sandboxMounts: sandbox?.mounts ?? [],
    sshAgentForwarded: sandbox?.sshAgent ?? false,
    settings: loadSettings(),
    mcpServerNames: Object.keys(loadMcpConfig().mcpServers),
    pluginDiagnostics: collectPluginMetaDiagnostics().map((entry) => entry.message),
    workspacePath: params.workspacePath,
  };
}

/** Convenience for the route: collect, then render. */
export const buildDiagnosticsMarkdown = (params: CollectDiagnosticsParams): string => buildDiagnosticsReport(collectDiagnosticsInput(params));
