# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- Handover document (`docs/HANDOVER.md`) stating the project's purpose, the
  findings of the Todoist reconnaissance pass, the open decisions, and the legal
  boundaries on reuse.
- `CLAUDE.md` and a "read this first" section in the handover, so a session
  started cold from this repo knows what is decided, what is open, and how the
  owner wants decisions presented.
- `research/todoist-tokens-light.json` — 712 CSS custom properties captured from
  the live Todoist web app in light theme, as reference material for deriving an
  original palette.

### Decided
- D1 (platform): open-todo is a **web app** in this repository, targeting
  self-hosted Vikunja. Apple platforms stay with Veyrn (`Vikunja-Tasks`).

### Known gaps
- Web stack undecided (handover D5): framework, rendering model, and the
  auth/CORS approach against a self-hosted Vikunja.
- Dark-theme token set not captured.
- Vikunja↔Todoist data-model mapping not written.
