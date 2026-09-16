---
type: Playbook
title: "Amend quick-add grammar"
description: "Change English or Italian task parsing with approved grammar, counter-examples and reviewed golden output rather than silently widening recognition."
tags:
- quickadd
- grammar
- parser
- golden
- corpus
- language
sources:
- resource: docs/data-model-mapping.md
- resource: docs/HANDOVER.md
- resource: src/model/quickadd/lang/it.ts
code_refs:
- src/model/quickadd/lang/pack.ts
- src/model/quickadd/lang/acceptance.test.ts
- src/model/quickadd/corpus.golden.test.ts
- scripts/quickadd-golden.mjs
- scripts/quickadd-corpus-diff.mjs
last_updated: 2026-09-16
---

# Amend quick-add grammar

## Context
Golden parity catches changed answers, not newly introduced false positives absent from the corpus. Parser fixes have previously eaten ordinary prose even while corpus comparisons passed.

## Steps
1. Read mapping §5/§5.1 and the closed-grammar decision; distinguish a defect repair from a new accepted form requiring a decision.
2. Add the intended case plus negativeCorpus and inertCorpus counter-examples. Change pack vocabulary/resolver or engine shape at its existing ownership boundary.
3. Run `pnpm test src/model/quickadd` and the caller tests affected by the change (QuickAdd, titleEdit or duePhrase).
4. Run `node scripts/quickadd-golden.mjs --check`. Explain every changed record before using `--write`, review the resulting fixture diff, then check again.
5. For a historical date-layer comparison, first verify a compatible existing ref with `git cat-file -e <ref>`, then run `pnpm quickadd:corpus-diff <ref>`. No timing or fresh application-test result was measured during this documentation setup.

## Gotchas
The corpus-diff default `d3d0a4a` is absent here; running it unchanged will fail at git show. Stale TODOs in pack.ts and old mapping defect paragraphs are not evidence that the current implementation still lacks Italian ordinal/start-clause handling. A pack fragment with a capturing group changes positional matches silently.

## Verify
Acceptance tests must prove both the desired parse and preservation of inert text. Keep rejected recurrence from leaking any date; verify decision overrides at preview and submit. Intentionally changed parser output must make golden --check fail before reviewing/regenerating the expectation.

## Debug
Word removed plus unexpected date → candidate admission or mask ordering. Warning on ordinary prose → inspect inert corpus, not just accepted cases. Preview differs from saved task → submit reparses with a new clock but lost user decisions.

## Related
- [Quick-add pipeline](/architecture/quick-add.md) — implementation boundaries
- [Closed date grammar](/decisions/closed-date-grammar.md) — why a wider resolver is not permission to accept more
