---
type: Decision
title: "Closed date grammar around chrono"
description: "Chrono resolves dates but the application admits only approved grammar shapes, preventing ordinary task words from silently becoming dates."
status: stable
date: 2026-09-10
tags:
- grammar
- chrono
- dates
- parser
- falsepositives
- vocabulary
sources:
- resource: docs/HANDOVER.md
- resource: docs/data-model-mapping.md
- resource: package.json
code_refs:
- src/model/quickadd/datePhrase.ts
- src/model/quickadd/grammar.ts
- src/model/quickadd/parse.ts
last_updated: 2026-09-16
---

# Closed date grammar around chrono

## Context
D-parser adopted chrono for date/time resolution (`dc78ff1`). Its broader vocabulary then consumed ordinary words such as sat and mar, and month/day text could resolve as a year.

## Decision
D-vocab (`54830ea`, `cca8394`, recorded in `ce08f85`) makes mapping §5.1 the acceptor before candidate selection. Recurrence, sigils and masking remain application-owned. Entire quoted lines are literal.

## Reasoning
Chrono is valuable for calendar resolution, not task intent. Requiring an admissible shape, a certain day for month names and no past date stops plausible but destructive interpretations.

## Alternatives considered
Digit/length heuristics and word stoplists miss context; per-parser removal drops valid language forms. rrule silently misreads Italian recurrence, and browser/remote language models add disproportionate cost and a third-party dependency.

## Consequences
Grammar amendments need an explicit product decision, not a refactor label. Keep text on refusal, test warnings and inert prose separately, and review golden changes. chrono-node stays exactly pinned.

## Related
- [Quick-add pipeline](/architecture/quick-add.md) — current pack and masking implementation
- [Amend quick-add](/playbooks/amend-quick-add.md) — how to change it safely
