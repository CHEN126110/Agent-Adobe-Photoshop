# Long-Horizon Codex Adoption

Source:

- [Run long horizon tasks with Codex](https://developers.openai.com/blog/run-long-horizon-tasks-with-codex?utm_source=chatgpt.com)

## What matters

The article's core claim is simple:

- long-running work succeeds because of the agent loop
- durable project memory
- milestone-based validation
- inspectable status

Not because of one giant prompt.

## Direct mapping to DesignEcho-Agent

### Spec

Mapped to:

- `project-memory/Prompt.md`

### Milestone plan

Mapped to:

- `project-memory/Plan.md`

### Runbook

Mapped to:

- `project-memory/Implement.md`

### Shared memory / audit log

Mapped to:

- `project-memory/Status.md`

## Why this is needed here

DesignEcho-Agent has already grown into a system with:

- scene core
- design skills
- executors
- MCP tools
- multi-agent teammates

This is too large to keep coherent through chat history alone.

## Operational rule

For any medium or large task:

1. read `Prompt.md`
2. read `Plan.md`
3. follow `Implement.md`
4. update `Status.md`

If a task changes scope, constraints, or current milestone, update the memory files first.
