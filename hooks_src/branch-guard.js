#!/usr/bin/env node

/**
 * branch-guard.js — PreToolUse hook (Edit/Write)
 *
 * Enforces the "never work on main/master" rule. Blocks file mutations while
 * the working tree is on a protected branch, forcing work onto a dedicated
 * branch first. This is the deterministic backstop to /do's Step -1 work-branch
 * guard: even a direct edit, or a skill invoked outside /do, can't touch a
 * protected branch.
 *
 * Config (harness.json "branchGuard" object, all optional):
 *   enabled            — false disables the guard entirely (default: true)
 *   allowMainEdits     — true bypasses the guard (intentional main work)
 *   protectedBranches  — array of branch names to block (default: main, master)
 *
 * Bypass for harness development: set CITADEL_DEV=true in .claude/settings.json
 * env (same switch protect-files honors).
 *
 * Fail OPEN: if the branch can't be determined (not a git repo, git missing,
 * detached HEAD, parse error), the edit is allowed. This guard only blocks when
 * it positively confirms a protected branch — it never bricks editing on error.
 */

const { execFileSync } = require('child_process');
const health = require('./harness-health-util');

const PROJECT_ROOT = health.PROJECT_ROOT;
const CITADEL_UI = process.env.CITADEL_UI === 'true';
const CITADEL_DEV = process.env.CITADEL_DEV === 'true';

const DEFAULT_PROTECTED = ['main', 'master'];

function hookOutput(action, message, data = {}) {
  if (CITADEL_UI) {
    process.stdout.write(JSON.stringify({
      hook: 'branch-guard',
      action,
      message,
      timestamp: new Date().toISOString(),
      data,
    }));
  } else {
    process.stdout.write(message);
  }
}

/**
 * Resolve the current git branch for PROJECT_ROOT.
 * Returns the branch name, or null when it can't be determined
 * (not a repo, git unavailable, or detached HEAD → "HEAD").
 */
function currentBranch() {
  try {
    const out = execFileSync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], {
      cwd: PROJECT_ROOT,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: 2000,
    }).trim();
    if (!out || out === 'HEAD') return null; // detached HEAD — not a protected branch
    return out;
  } catch {
    return null; // not a git repo / git missing — fail open
  }
}

function main() {
  let input = '';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', (chunk) => { input += chunk; });
  process.stdin.on('end', () => {
    try {
      run(input);
    } catch (err) {
      // Fail open: this is an additive backstop, never block on internal error.
      try { health.logBlock('branch-guard', 'error', err.message || 'unknown error'); } catch {}
      process.exit(0);
    }
  });
}

function run(input) {
  let event;
  try {
    event = JSON.parse(input);
  } catch {
    process.exit(0); // fail open — protect-files already fails closed on parse
  }

  const toolName = event.tool_name || '';
  if (toolName !== 'Edit' && toolName !== 'Write') {
    process.exit(0);
  }

  // Bypass switches
  if (CITADEL_DEV) process.exit(0);

  let config = {};
  try { config = health.readConfig() || {}; } catch { config = {}; }
  const guard = config.branchGuard || {};

  if (guard.enabled === false) process.exit(0);
  if (guard.allowMainEdits === true) process.exit(0);

  const protectedBranches = Array.isArray(guard.protectedBranches) && guard.protectedBranches.length
    ? guard.protectedBranches
    : DEFAULT_PROTECTED;

  const branch = currentBranch();
  if (!branch) process.exit(0); // can't confirm — fail open

  if (protectedBranches.includes(branch)) {
    const filePath = event.tool_input?.file_path || event.tool_input?.path || 'file';
    try { health.logBlock('branch-guard', 'blocked', `${toolName} on protected branch '${branch}'`); } catch {}
    try { health.increment('branch-guard', 'blocked'); } catch {}
    hookOutput('blocked',
      `[branch-guard] Blocked: you're on protected branch '${branch}'. ` +
      `Citadel never edits ${branch} directly. Create a work branch first, then retry:\n` +
      `    git checkout -b work/<task-slug>\n` +
      `(Or run /do, which branches automatically.) ` +
      `To allow this edit anyway: set "branchGuard": { "allowMainEdits": true } in .claude/harness.json, ` +
      `or CITADEL_DEV=true in .claude/settings.json env.`,
      { branch, file: filePath, tool: toolName, protectedBranches }
    );
    process.exit(2); // block the edit
  }

  process.exit(0);
}

main();
