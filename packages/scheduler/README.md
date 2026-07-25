# @receptron/task-scheduler

Persistent task scheduler with catch-up recovery. Schedule recurring tasks, survive process restarts, and automatically recover missed runs.

Designed for AI agent backends that need reliable background tasks (journal summarization, index backfill, daily reports) but don't want to depend on external cron infrastructure.

## Features

- **Schedule types**: interval, daily, weekly, one-shot
- **Catch-up on restart**: detects missed windows and applies a per-task policy (skip / run-once / run-all)
- **Persistent state**: tracks last-run, consecutive failures, total runs per task
- **Execution log**: append-only JSONL, one file per day, queryable
- **DI-pure**: all I/O injected via deps — easy to test with in-memory stubs
- **Zero dependencies**: no external packages required

## Install

```bash
npm install @receptron/task-scheduler
```

## Usage

```typescript
import {
  computeCatchUpPlan,
  loadState,
  updateAndSave,
  appendLogEntry,
  nextWindowAfter,
  type CatchUpTask,
  type StateDeps,
  type LogDeps,
} from "@receptron/task-scheduler";

// Define tasks
const tasks: CatchUpTask[] = [
  {
    id: "daily-report",
    name: "Daily Report",
    schedule: { type: "daily", time: "08:00" },
    missedRunPolicy: "run-once",
    enabled: true,
  },
];

// Load persisted state
const stateDeps: StateDeps = { readFile, writeFileAtomic, exists };
const stateMap = await loadState("/path/to/state.json", stateDeps);

// Compute catch-up plan after restart
const plan = computeCatchUpPlan(tasks, stateMap, Date.now());
for (const run of plan.runs) {
  await executeTask(run.taskId, run.context);
}

// Compute next window
const next = nextWindowAfter(
  { type: "daily", time: "08:00" },
  Date.now(),
);
```

## Schedule Types

| Type | Example | Description |
|---|---|---|
| `interval` | `{ type: "interval", intervalSec: 3600 }` | Every N seconds, epoch-aligned |
| `daily` | `{ type: "daily", time: "08:00" }` | Daily at HH:MM UTC |
| `weekly` | `{ type: "weekly", daysOfWeek: [1,3,5], time: "09:00" }` | Specific weekdays (0=Sun) |
| `once` | `{ type: "once", at: "2026-05-01T00:00:00Z" }` | One-shot at a specific time |

## Missed Run Policies

| Policy | Behavior |
|---|---|
| `skip` | Advance lastRunAt, log the skip, no execution |
| `run-once` | Execute once for the latest missed window |
| `run-all` | Execute once per missed window (capped at 24) |

## Exports

| Export | Description |
|---|---|
| `computeCatchUpPlan()` | Pure function: tasks + state + now → catch-up plan |
| `nextWindowAfter()` | Next scheduled window at or after a timestamp |
| `listMissedWindows()` | All windows in a (from, to] range |
| `isDueAt()` | Check if a schedule fires within a tick window |
| `loadState()` / `saveState()` / `updateAndSave()` | State persistence (I/O injected) |
| `appendLogEntry()` / `queryLog()` | Execution log (I/O injected) |
| `emptyState()` | Create a fresh TaskExecutionState |
| Types | `TaskSchedule`, `MissedRunPolicy`, `TaskExecutionState`, `TaskLogEntry`, `CatchUpTask`, etc. |

## Ecosystem

Standalone package from [Receptron](https://github.com/receptron). Works with any Node.js application.

## Related projects

Published from the MulmoClaude monorepo by [Receptron](https://github.com/receptron).

- **[MulmoClaude](https://github.com/receptron/mulmoclaude)** — an open-source AI assistant platform that runs on your own computer. Claude Code as the engine, a personal wiki for long-term memory, schema-driven collections for your data, and chat that summons the right GUI (markdown, charts, forms, spreadsheets, wikis) for each task.
- **[MulmoTerminal](https://github.com/receptron/mulmoterminal)** — a terminal-first cockpit for running many AI coding agents in parallel. One roster showing every session's summary and PR status, tmux-backed session persistence, git-worktree isolation, one-click PRs, and mobile push with remote reply.
- **[MulmoTerminal manual](https://receptron.github.io/mulmoterminal/)** — setup, workflows, feature reference, configuration, mobile notifications, and alternative / local model providers. Available in English and Japanese.

## License

MIT
