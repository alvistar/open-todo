---
type: Reference
title: "Quick-add pipeline"
description: "Quick-add masking, language packs, closed date grammar and user overrides. Load when interpreting task text or changing parser behaviour."
tags:
- quickadd
- parser
- grammar
- language
- recurrence
- masking
- overrides
sources:
- resource: docs/data-model-mapping.md
- resource: docs/HANDOVER.md
- resource: src/model/quickadd/lang/pack.ts
- resource: src/model/quickadd/decisions.ts
- resource: CHANGELOG.md
code_refs:
- src/model/quickadd/parse.ts
- src/model/quickadd/datePhrase.ts
- src/model/quickadd/grammar.ts
- src/model/quickadd/lang/index.ts
- src/model/quickadd/lang/it.ts
- src/model/titleEdit.ts
last_updated: 2026-09-16
---

# Quick-add pipeline

## Pipeline
`parseQuickAdd` returns a title, spans, due date, project, labels, priority, recurrence and warnings. Whole-line matching quotes bypass interpretation. Masking keeps recognised sigils and rejected recurrence spans away from later date resolution without removing rejected text from the title. `datePhrase` asks active chrono resolvers for candidates, admits only closed grammar shapes, then selects earliest/longest with explicit pack preference for ties. Impossible/past dates, uncertain day-of-month readings and unapproved shapes cannot silently become schedules.

## Language Packs
`ACTIVE_PACKS` contains English and Italian. Packs supply vocabulary, resolver instances, native phrases and counter-example corpora; the engine composes shapes across packs, preserving mixed-language phrases. Pack regex fragments must not introduce capturing groups. English short weekdays are recurrence-only; Italian short weekdays are deliberately absent. `set` is excluded as a month abbreviation. The Italian pack patches chrono's time parsing/refining for `ore`; the old handover text about rewriting input describes an earlier implementation.

## Preview and Submit
The composer applies `withDecisions` to recognition and re-applies those decisions when parsing with a fresh clock at submit. Declined spans retain their words; a bare repeat adverb is inert until accepted. Date-only values use the effective default due time (20:00 fallback) in the browser zone. Detail title editing reuses parsing and previews date/project/priority/labels, but its TaskPatch writes title and changed supported columns, then labels separately; do not claim that every quick-add recurrence capability is editable there.

## Guardrails and Limits
Unsupported recurrence stays visible with a warning, and its whole span must be masked to prevent a leftover date leaking through. Workday recurrence is an explicitly warned approximation; a fixed yearly interval remains 365 days. Golden records characterise behaviour but do not establish correctness; each new shape needs negative and inert prose examples. Old F7/F10/F11 and language-pack TODO comments lag the actual fixes: inspect tests and current pack contents before treating them as open defects.

## Related
- [Closed grammar](/decisions/closed-date-grammar.md) — why resolution and admission are separate
- [Ambiguous recurrence](/decisions/offer-repeat-adverbs.md) — why a bare adverb needs consent
- [Amend quick-add](/playbooks/amend-quick-add.md) — implementation and verification sequence
