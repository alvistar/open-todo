---
okf_version: "0.2"
---

# open-todo Knowledge Base

open-todo is an MIT-licensed static React UI for self-hosted Vikunja, reimplementing measured Todoist behaviour with original code and assets. It calls Vikunja's public API directly, without a proxy or copied Todoist/Vikunja source.

After the required handover read, use the state snapshot below for current capabilities; the historical handover and README feature summaries lag implementation. Daily commands, including live-test opt-ins, live in the repository's `CLAUDE.md`.

Find concepts with `scripts/okf-recall.sh "<terms>"`, which joins search with drift and withholds stale concepts. For path discovery, `okf search --for-path <file>` has no drift join: verify a hit against its source before trusting it. Each category index below lists its concepts with the same one-line description the concept carries.

- [Project](/project/index.md) — What is true of the project right now, the stack, the setup, and the conventions.
- [Architecture](/architecture/index.md) — How the pieces connect.
- [Decisions](/decisions/index.md) — One concept per decision, with status, date, reasoning and the alternatives rejected.
- [Playbooks](/playbooks/index.md) — Task-specific runbooks. Check here before starting a task — if a playbook exists, follow it.
- [state](/project/state.md) — What is working, what is not yet built, and what is known to be broken — a snapshot, not a history.
