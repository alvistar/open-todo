---
type: Decision
title: "Offer ambiguous repeat adverbs"
description: "A trailing daily or mensilmente is offered, not applied: user acceptance determines recurrence when text alone cannot distinguish intent."
status: stable
date: 2026-09-15
tags:
- recurrence
- adverbs
- suggestions
- chips
- intent
- consent
sources:
- resource: docs/HANDOVER.md
- resource: docs/data-model-mapping.md
- resource: src/model/quickadd/decisions.test.ts
code_refs:
- src/model/quickadd/recurrence.ts
- src/model/quickadd/decisions.ts
- src/ui/QuickAdd.tsx
last_updated: 2026-09-16
---

# Offer ambiguous repeat adverbs

## Context
Both a genuine repeating task and a one-off cancellation of a monthly-paid service can end in the same adverb. Syntax alone does not identify what the adverb modifies.

## Decision
D-adverb (`d4a4376`) returns a suggestedRepeat span, leaves the word in the title and writes no recurrence until a chip is accepted. Explicit every/ogni phrases still apply normally.

## Reasoning
One extra click on ambiguous common cases prevents a silently invented schedule on uncommon ones. Preview and save must honour the same choice.

## Alternatives considered
Verb lists, determiner rules and leading-verb requirements have counter-examples. A billing-participle veto may be studied later but is not the current policy and cannot replace the offer.

## Consequences
Never treat the suggestion as a default value in a mutation. Reapply decisions after the submit-time reparse; dropping them would restore something the user deliberately rejected.

## Related
- [Quick-add pipeline](/architecture/quick-add.md) — spans, title composition and submit-time parsing
- [Amend quick-add](/playbooks/amend-quick-add.md) — suggestion and rejection tests
