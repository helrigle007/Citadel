#!/usr/bin/env node
'use strict';

/**
 * ensure-work-branch.js — /do Step -1 work-branch guard.
 *
 * Citadel never works directly on a protected branch (main/master). Before any
 * code-mutating route, /do runs this. If the working tree is on a protected
 * branch, it derives a slug from the task and creates+switches to work/<slug>,
 * carrying any uncommitted changes along. Otherwise it's a no-op.
 *
 * This is the proactive half of the rule; hooks_src/branch-guard.js is the
 * deterministic backstop that blocks edits if we somehow land on main anyway.
 *
 * Usage:
 *   node scripts/ensure-work-branch.js --task "add auth flow" [--json] [--project-root <path>]
 *   node scripts/ensure-work-branch.js --slug add-auth-flow
 *
 * Output (text mode): a single announce line for the user.
 * Output (--json): { action, branch?, from?, reason? }
 *   action: 'branched' | 'skip' | 'error'
 *
 * Exit codes: 0 on branched/skip, 1 on error (agent falls back to manual branch).
 */

const path = require('path');
const { execFileSync } = require('child_process');

function parseArgs(argv) {
  const args = { projectRoot: process.cwd(), task: '', slug: '', json: false, help: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--project-root') args.projectRoot = path.resolve(argv[++i] || '.');
    else if (a === '--task') args.task = argv[++i] || '';
    else if (a === '--slug') args.slug = argv[++i] || '';
    else if (a === '--json') args.json = true;
    else if (a === '--help' || a === '-h') args.help = true;
  }
  return args;
}

function usage() {
  return [
    'Usage:',
    '  node scripts/ensure-work-branch.js --task "<task text>" [--slug <slug>] [--json] [--project-root <path>]',
    '',
    'Branches off a protected branch (main/master) onto work/<slug> before code work.',
    'No-op when already on a work branch or outside a git repo.',
  ].join('\n');
}

function git(args, cwd) {
  return execFileSync('git', args, {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
    timeout: 5000,
  }).trim();
}

function slugify(text) {
  const slug = String(text || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .split('-')
    .slice(0, 6)          // keep it short and readable
    .join('-')
    .slice(0, 40)
    .replace(/-+$/g, '');
  return slug || 'task';
}

function readProtectedBranches(projectRoot) {
  try {
    const fs = require('fs');
    const cfgPath = path.join(projectRoot, '.claude', 'harness.json');
    const cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
    const list = cfg.branchGuard && cfg.branchGuard.protectedBranches;
    if (Array.isArray(list) && list.length) return list;
  } catch { /* fall through to default */ }
  return ['main', 'master'];
}

function branchExists(name, cwd) {
  try {
    git(['rev-parse', '--verify', '--quiet', `refs/heads/${name}`], cwd);
    return true;
  } catch {
    return false;
  }
}

function uniqueBranchName(base, cwd) {
  let name = `work/${base}`;
  if (!branchExists(name, cwd)) return name;
  for (let n = 2; n < 100; n++) {
    const candidate = `work/${base}-${n}`;
    if (!branchExists(candidate, cwd)) return candidate;
  }
  return `work/${base}-${Date.now()}`;
}

function emit(result, json) {
  if (json) {
    process.stdout.write(JSON.stringify(result));
    return;
  }
  if (result.action === 'branched') {
    process.stdout.write(`[do] On ${result.from} -> branched to ${result.branch}. Proceeding.`);
  } else if (result.action === 'skip') {
    process.stdout.write(`[do] On ${result.branch || 'work branch'} (${result.reason}). No branch needed.`);
  } else {
    process.stdout.write(`[do] Could not create work branch: ${result.reason}. Branch manually before editing.`);
  }
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    process.stdout.write(usage());
    process.exit(0);
  }

  const cwd = args.projectRoot;

  let branch;
  try {
    branch = git(['rev-parse', '--abbrev-ref', 'HEAD'], cwd);
  } catch {
    emit({ action: 'skip', reason: 'not-a-git-repo' }, args.json);
    process.exit(0);
  }

  if (!branch || branch === 'HEAD') {
    emit({ action: 'skip', reason: 'detached-head', branch: branch || null }, args.json);
    process.exit(0);
  }

  const protectedBranches = readProtectedBranches(cwd);
  if (!protectedBranches.includes(branch)) {
    emit({ action: 'skip', reason: 'already-on-work-branch', branch }, args.json);
    process.exit(0);
  }

  const base = slugify(args.slug || args.task);
  const target = uniqueBranchName(base, cwd);

  try {
    git(['checkout', '-b', target], cwd);
  } catch (err) {
    emit({ action: 'error', reason: (err && err.message) || 'git checkout failed', branch }, args.json);
    process.exit(1);
  }

  emit({ action: 'branched', from: branch, branch: target }, args.json);
  process.exit(0);
}

main();
