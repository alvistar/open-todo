import { en } from "./en";
import { it } from "./it";
import type { LanguagePack } from "./pack";

/*
 * The languages the quick-add grammar is built from. All of them are active on
 * every line at once: the owner types both in one sentence, and §5's shapes are
 * bilingual, so "next venerdì" resolves.
 *
 * ARRAY ORDER IS ALTERNATION ORDER, and nothing else. It decides where each
 * language's words land inside the composed patterns, which is invisible as long
 * as the alternatives are disjoint - and it is English-first only because that
 * is the order the hand-written lists had, which keeps the composed strings
 * byte-identical to the ones this replaced.
 *
 * It is NOT a preference. When two locales both match a span, the tie-break is a
 * separate, explicit thing that lives with the parser registry; do not infer it
 * from this array.
 *
 * Adding a pack is not free. Every language widens a gate that is
 * language-blind: its words are admitted for ALL text, in every language.
 * French "mai" is the Italian for "never", so an fr pack would put a due date on
 * "non lo faccio mai". A new pack needs its own counter-examples, run through
 * the whole registry rather than its own.
 */
export const ACTIVE_PACKS: readonly LanguagePack[] = [en, it];

export type { LanguagePack };
