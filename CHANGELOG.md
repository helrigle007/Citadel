# Changelog

## [1.1.0] - 2026-06-08

### Added
- Never work on main: a branch guard enforced at three layers — `/do` Step -1, the orchestrators (`/marshal`, `/archon`, `/fleet`), and a `branch-guard.js` PreToolUse hook that blocks edits on `main`/`master`. Code work now branches to `work/<task-slug>` first. Bypass via `branchGuard.allowMainEdits` in `harness.json` or `CITADEL_DEV=true`. (#1)

### Fixed
- Codex plugin build no longer clobbers the committed Claude-format `hooks/hooks.json` during in-place builds, and `codex-install.js` no longer truncates its JSON report on a pipe (was failing callers with a parse error at 8 KB). (#1)
