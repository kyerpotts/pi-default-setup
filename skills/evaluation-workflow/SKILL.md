---
name: evaluation-workflow
description: Post-implementation evaluation workflow. Use after substantive work to generate an HTML deck of changes, verification evidence, and screenshots/videos, and to loop back into design or implementation when checks fail.
license: MIT
---

# Evaluation Workflow

Use this skill after completing a substantive piece of work.

The goal is not just to say the work is done. The goal is to produce evidence:
- what changed
- how it was verified
- what screenshots or video demonstrate the result
- whether any failures require returning to design or implementation

## Required Behavior

1. Do not declare success immediately after coding.
2. Gather verification evidence first.
3. If the work affects UI, behavior, or workflows, gather screenshots or video evidence when practical.
4. Generate an HTML evaluation deck with the `evaluation_deck` tool.
5. If the tool reports a failure, return to design or implementation, fix the issue, and rerun evaluation.

## Recommended Flow

### 1. Define evaluation evidence
Before calling the tool, decide:
- what changed
- what commands should verify the change
- what screenshots or videos should demonstrate it
- what the user should learn from the evaluation deck

### 2. Gather media evidence
If the project has a deterministic capture workflow, run it first or supply it via `captureCommands`.
If screenshots or videos already exist, pass them as media items.

### 3. Run the evaluation deck tool
Call `evaluation_deck` with:
- a clear title
- a concise summary
- verification commands
- optional capture commands
- screenshots/videos to embed

### 4. Interpret the result
- If the tool succeeds, report the deck path and summarize the evidence.
- If the tool fails, do not stop at reporting the failure.
  - inspect the failing verification or capture step
  - fix the issue
  - rerun evaluation

## Guidance

- Prefer deterministic verification commands over vague assertions.
- Prefer screenshots/video for user-visible behavior.
- The evaluation deck should be a deliverable, not an afterthought.
- Use loopback behavior: failed evaluation means the work is not complete yet.
