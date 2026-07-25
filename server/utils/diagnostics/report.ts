// The environment report a user pastes into a bug report, assembled and
// REDACTED here rather than by the agent. mulmoterminal's equivalent skill
// asked the model to withhold `*_KEY` values as a prose instruction; the same
// approach here would be worse — `googleMapsApiKey` is stored in plaintext and
// `config/mcp.json` carries provider tokens in `env` / `headers`. A rule that
// only exists in a prompt cannot be tested, so it lives in code with the
// redaction decisions as pure functions.
//
// Everything here is pure: the caller reads the files, the OS and the plugin
// diagnostics, then hands the values in. That keeps the redaction rules
// testable without a workspace, a server, or a developer's real settings.
import { APP_SETTINGS_KEYS, SAFE_SETTINGS_KEYS } from "../../system/config.js";
import { isRecord } from "../types.js";

/** What a redacted setting reports instead of its value. */
export const REDACTED_PRESENT = "(set — value withheld)";
export const REDACTED_ABSENT = "(not set)";

export interface RedactedSetting {
  key: string;
  /** Rendered value: the real one for allow-listed keys, a marker otherwise. */
  value: string;
  /** True when the value was withheld — surfaced so a reader can tell the
   *  difference between "off" and "we refused to print it". */
  redacted: boolean;
}

const isSafeKey = (key: string): boolean => SAFE_SETTINGS_KEYS.some((safe) => safe === key);

const renderValue = (value: unknown): string => (typeof value === "string" ? value : JSON.stringify(value));

const readOwn = (settings: Record<string, unknown>, key: string): unknown => (Object.prototype.hasOwnProperty.call(settings, key) ? settings[key] : undefined);

/** Render every requested setting, printing values ONLY for allow-listed keys.
 *  Absent keys are reported too: "not set" is the answer to half the FAQ
 *  entries ("voice input does nothing" → it ships off), so dropping them would
 *  remove the most useful line in the report.
 *
 *  Takes `unknown`, not `Partial<AppSettings>`: the redaction decision is made
 *  from the key NAME against the allow list, so a settings file holding a field
 *  this build has never heard of must flow through the same path rather than
 *  being a type error at the call site. `hasOwnProperty` rather than
 *  `key in settings` — a settings object parsed from JSON still inherits
 *  `constructor`, and `in` would report it present. */
export function redactSettings(settings: unknown, keys: readonly string[]): RedactedSetting[] {
  const record = isRecord(settings) ? settings : {};
  return keys.map((key) => {
    const value = readOwn(record, key);
    if (value === undefined) return { key, value: REDACTED_ABSENT, redacted: false };
    if (!isSafeKey(key)) return { key, value: REDACTED_PRESENT, redacted: true };
    return { key, value: renderValue(value), redacted: false };
  });
}

/** Replace the home directory prefix with `~`. A report is read by strangers,
 *  and an absolute path leaks the account name on every line that has one. */
export function shortenHome(text: string, home: string): string {
  const trimmed = home.endsWith("/") || home.endsWith("\\") ? home.slice(0, -1) : home;
  if (!trimmed) return text;
  return text.split(trimmed).join("~");
}

export interface DiagnosticsInput {
  appVersion: string;
  nodeVersion: string;
  platform: string;
  arch: string;
  /** Home dir, used only to shorten paths — never printed on its own. */
  home: string;
  sandboxEnabled: boolean;
  /** Config mount names the sandbox was started with (`gh`, …). Names only. */
  sandboxMounts: readonly string[];
  sshAgentForwarded: boolean;
  /** The parsed settings object, as loaded. Typed loosely on purpose — see
   *  `redactSettings`: an unrecognised field must still reach the allow-list
   *  check rather than being rejected by the type system. */
  settings: unknown;
  /** MCP server NAMES only. Never the spec — `env` / `headers` hold tokens. */
  mcpServerNames: readonly string[];
  /** One line per plugin-aggregation collision, already formatted upstream. */
  pluginDiagnostics: readonly string[];
  workspacePath: string;
}

const yesNo = (value: boolean): string => (value ? "yes" : "no");

const bullets = (items: readonly string[], whenEmpty: string): string[] => (items.length === 0 ? [`- ${whenEmpty}`] : items.map((item) => `- ${item}`));

const settingsLines = (settings: unknown): string[] => redactSettings(settings, APP_SETTINGS_KEYS).map(({ key, value }) => `- \`${key}\`: ${value}`);

/** Build the markdown block. Pure — same input, same bytes (golden-testable).
 *  Home shortening runs once over the assembled text so no caller has to
 *  remember it per field. */
export function buildDiagnosticsReport(input: DiagnosticsInput): string {
  const lines = [
    "## Environment",
    "",
    `- MulmoClaude: ${input.appVersion}`,
    `- Node: ${input.nodeVersion}`,
    `- OS: ${input.platform} ${input.arch}`,
    `- Workspace: ${input.workspacePath}`,
    "",
    "### Sandbox",
    "",
    `- enabled: ${yesNo(input.sandboxEnabled)}`,
    `- SSH agent forwarded: ${yesNo(input.sshAgentForwarded)}`,
    ...bullets(
      input.sandboxMounts.map((name) => `mounted config: \`${name}\``),
      "no config mounts",
    ),
    "",
    "### Settings",
    "",
    ...settingsLines(input.settings),
    "",
    "### MCP servers",
    "",
    ...bullets(
      input.mcpServerNames.map((name) => `\`${name}\``),
      "none registered",
    ),
    "",
    "### Plugin diagnostics",
    "",
    ...bullets(input.pluginDiagnostics, "no collisions reported"),
    "",
    "> Secrets are withheld by the server, not by the agent. Values marked",
    `> "${REDACTED_PRESENT}" are present in the config but never printed.`,
  ];
  return `${shortenHome(lines.join("\n"), input.home)}\n`;
}
