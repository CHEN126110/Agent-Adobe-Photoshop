#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const VALID_INTAKE_STATUSES = new Set([
  'new',
  'triaged',
  'planned',
  'in_progress',
  'done',
  'paused',
  'rejected'
]);

function runGit(args, cwd) {
  return execFileSync('git', args, {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe']
  }).trim();
}

function repoRoot() {
  return runGit(['rev-parse', '--show-toplevel'], process.cwd()).replace(/\\/g, '/');
}

function readText(root, relativePath) {
  const absolutePath = path.join(root, relativePath);
  if (!fs.existsSync(absolutePath)) {
    throw new Error(`Missing required planning file: ${relativePath}`);
  }
  return fs.readFileSync(absolutePath, 'utf8');
}

function readJson(root, relativePath) {
  return JSON.parse(readText(root, relativePath));
}

function assertIncludes(text, expected, label) {
  if (!text.includes(expected)) {
    throw new Error(`${label} must include "${expected}"`);
  }
}

function assertIncludesAny(text, expectedValues, label) {
  if (!expectedValues.some((expected) => text.includes(expected))) {
    throw new Error(`${label} must include one of: ${expectedValues.join(', ')}`);
  }
}

function assertNonEmptyString(value, label) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`${label} must be a non-empty string`);
  }
}

function assertNonEmptyStringArray(value, label) {
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error(`${label} must be a non-empty array`);
  }
  value.forEach((item, index) => assertNonEmptyString(item, `${label}[${index}]`));
}

function extractMarkdownSections(text) {
  const sections = new Set();
  const pattern = /^###\s+(.+)$/gm;
  let match;
  while ((match = pattern.exec(text)) !== null) {
    sections.add(match[1].trim());
  }
  return sections;
}

function extractFirstH2Card(text) {
  const matches = [...text.matchAll(/^##\s+(.+)$/gm)];
  if (matches.length === 0) {
    throw new Error('CurrentTask.md must contain one current H2 task card');
  }

  const first = matches[0];
  const start = first.index || 0;
  const end = matches.length > 1 ? matches[1].index || text.length : text.length;
  return {
    title: first[1].trim(),
    body: text.slice(start, end)
  };
}

function extractTaskId(title) {
  const match = title.match(/\b[A-Z][A-Z0-9]*(?:-[A-Z0-9]+)+-\d{3}\b/);
  return match ? match[0] : '';
}

function collectPlanningWarnings(currentCard, projectState) {
  const warnings = [];
  const currentTaskId = extractTaskId(currentCard.title);

  if (!currentTaskId) {
    warnings.push('CurrentTask first H2 title has no machine-readable task ID');
    return warnings;
  }

  if (currentTaskId !== projectState.activeRequest.id) {
    warnings.push(
      `CurrentTask ${currentTaskId} differs from project-state activeRequest ${projectState.activeRequest.id}`
    );
  }
  if (currentTaskId !== projectState.activePlan.id) {
    warnings.push(
      `CurrentTask ${currentTaskId} differs from project-state activePlan ${projectState.activePlan.id}`
    );
  }

  return warnings;
}

function assertCurrentTask(text) {
  const currentCard = extractFirstH2Card(text);
  [
    '目标',
    '当前事实',
    '实施边界',
    '下一步',
    '验证与未知',
    '状态'
  ].forEach((section) => {
    if (!extractMarkdownSections(currentCard.body).has(section)) {
      throw new Error(`CurrentTask.md first H2 card missing section: ${section}`);
    }
  });

  assertIncludesAny(
    currentCard.body,
    ['in_progress', 'validated', 'done', 'paused'],
    'CurrentTask.md first H2 card'
  );
  return currentCard;
}

function parseIntakeEntries(text) {
  const pattern = /^###\s+(INTAKE-\d+)\s+(.+)$/gm;
  const matches = [...text.matchAll(pattern)];
  return matches.map((match, index) => {
    const start = match.index || 0;
    const end = index + 1 < matches.length ? matches[index + 1].index || text.length : text.length;
    return {
      id: match[1],
      title: match[2].trim(),
      body: text.slice(start, end)
    };
  });
}

function readListValue(body, label) {
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = body.match(new RegExp(`^- ${escaped}：(.+)$`, 'm'));
  return match ? match[1].trim() : '';
}

function assertIntake(text) {
  const entries = parseIntakeEntries(text);
  if (entries.length === 0) {
    throw new Error('Intake.md must contain at least one INTAKE entry');
  }

  let activeCount = 0;
  for (const entry of entries) {
    ['来源', '归属层级', '状态'].forEach((field) => {
      if (!readListValue(entry.body, field)) {
        throw new Error(`${entry.id} missing required field: ${field}`);
      }
    });
    const status = readListValue(entry.body, '状态');
    if (!VALID_INTAKE_STATUSES.has(status)) {
      throw new Error(`${entry.id} has invalid status: ${status}`);
    }
    if (status === 'planned' || status === 'in_progress' || status === 'new' || status === 'triaged') {
      activeCount += 1;
    }
    const hasNextStep = Boolean(readListValue(entry.body, '下一步'));
    const hasBoundary = Boolean(readListValue(entry.body, '边界'));
    const hasEntered = Boolean(readListValue(entry.body, '已进入'));
    if (!hasNextStep && !hasBoundary && !hasEntered) {
      throw new Error(`${entry.id} must include 下一步, 边界, or 已进入`);
    }
  }

  if (activeCount === 0) {
    throw new Error('Intake.md must keep at least one active planning item');
  }
}

function assertProjectState(projectState) {
  if (!projectState.activeRequest || typeof projectState.activeRequest !== 'object') {
    throw new Error('project-state.activeRequest is required for planning alignment');
  }
  if (!projectState.activePlan || typeof projectState.activePlan !== 'object') {
    throw new Error('project-state.activePlan is required for planning alignment');
  }

  assertNonEmptyString(projectState.activeRequest.id, 'project-state.activeRequest.id');
  assertNonEmptyString(projectState.activeRequest.summary, 'project-state.activeRequest.summary');
  assertNonEmptyString(projectState.activeRequest.status, 'project-state.activeRequest.status');
  assertNonEmptyStringArray(projectState.activeRequest.mustDo, 'project-state.activeRequest.mustDo');
  assertNonEmptyStringArray(projectState.activeRequest.mustNotDo, 'project-state.activeRequest.mustNotDo');
  assertNonEmptyString(projectState.activePlan.id, 'project-state.activePlan.id');
  assertNonEmptyString(projectState.activePlan.source, 'project-state.activePlan.source');
  assertNonEmptyStringArray(projectState.activePlan.steps, 'project-state.activePlan.steps');
}

function assertMethodologyReferences(agentRoot) {
  const agents = readText(agentRoot, 'AGENTS.md');
  const readme = readText(agentRoot, 'project-memory/README.md');
  const implement = readText(agentRoot, 'project-memory/Implement.md');
  const methodology = readText(agentRoot, 'docs/agent-development-methodology.md');
  const capabilityMap = readText(agentRoot, 'docs/agent-capability-map.md');

  for (const [label, text] of [
    ['AGENTS.md', agents],
    ['project-memory/README.md', readme]
  ]) {
    assertIncludes(text, 'CurrentTask.md', label);
    assertIncludes(text, 'Intake.md', label);
  }

  assertIncludes(implement, '条件性执行参考', 'project-memory/Implement.md');
  assertIncludes(implement, '不得覆盖', 'project-memory/Implement.md');

  [
    'Intake',
    'Orient',
    'Classify',
    '事实与未知',
    '方案判断',
    'Implement',
    'Verify',
    'Write Back'
  ].forEach((keyword) => assertIncludes(methodology, keyword, 'agent-development-methodology.md'));

  [
    'Agent 基础设施',
    'Photoshop 操作能力',
    '设计理解能力',
    '设计执行能力',
    '业务场景',
    'Benchmark'
  ].forEach((keyword) => assertIncludes(capabilityMap, keyword, 'agent-capability-map.md'));
}

function main() {
  const root = repoRoot();
  const agentRoot = path.join(root, 'DesignEcho-Agent');

  const currentTask = readText(agentRoot, 'project-memory/CurrentTask.md');
  const intake = readText(agentRoot, 'project-memory/Intake.md');
  const projectState = readJson(agentRoot, 'project-memory/project-state.json');

  const currentCard = assertCurrentTask(currentTask);
  assertIntake(intake);
  assertProjectState(projectState);
  assertMethodologyReferences(agentRoot);
  const warnings = collectPlanningWarnings(currentCard, projectState);

  console.log(JSON.stringify({
    success: true,
    checks: [
      'CurrentTask first H2 card has the compact required sections',
      'Intake planning pool has valid entries and statuses',
      'project-state activeRequest and activePlan are present; semantic drift is reported as a warning',
      'AGENTS and README references are aligned; Implement is explicitly conditional',
      'methodology and capability-map references are present'
    ],
    warnings,
    currentTask: currentCard.title,
    activeRequest: projectState.activeRequest.id,
    activePlan: projectState.activePlan.id,
    intakeCount: parseIntakeEntries(intake).length
  }, null, 2));
}

try {
  main();
} catch (error) {
  console.error(error.message || error);
  process.exit(1);
}
