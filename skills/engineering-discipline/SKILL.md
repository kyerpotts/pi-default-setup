---
name: engineering-discipline
description: Default coding discipline for implementation, review, and refactoring. Use to surface assumptions, design changes before coding, keep designs simple, make surgical changes, preserve project conventions, write high-signal comments, and verify outcomes with explicit success criteria.
license: MIT
metadata:
  upstream: https://github.com/forrestchang/andrej-karpathy-skills
  adapted_from:
    - OpenCode global comments standard
    - OpenCode global software design standard
---

# Engineering Discipline

Default coding discipline for implementation, review, and refactoring.

This skill started from [`forrestchang/andrej-karpathy-skills`](https://github.com/forrestchang/andrej-karpathy-skills) and was adapted with practices from your OpenCode agents and standards.

**Tradeoff:** These guidelines bias toward caution, simplicity, and verification over raw speed. For trivial edits, use judgment.

## 1. Clarify Before Coding

**Do not silently choose an interpretation.**

Before implementing:
- State assumptions explicitly.
- If multiple interpretations exist, present them instead of picking one silently.
- Ask concise clarifying questions when ambiguity materially affects the design or the diff.
- Surface hard constraints, soft constraints, and tradeoffs.
- Push back when the requested approach is more complex than necessary.
- Stop when confused; name what is unclear.

## 2. Design Before Coding

**Do the design work before touching code.**

Before implementation, produce a brief design for the change:
- describe the intended solution in a few concrete bullets
- identify the files, modules, interfaces, and data flows that will change
- state the invariants and constraints the design must preserve
- name plausible alternatives and why they are not the chosen approach
- call out the main risks, failure modes, or uncertainty in the design
- define how the design will be validated after implementation

For non-trivial work, implementation should follow an explicit design, not exploratory patching.
If you cannot explain the design simply, keep designing.

## 3. Prefer Simple, Deep Designs

**Solve the problem with the smallest design that holds up.**

- No speculative features, abstractions, or configurability.
- Prefer deep modules with simple interfaces.
- Hide implementation details and internal data structures unless callers truly need them.
- Pull complexity downward; do not push it onto every caller.
- Keep call chains short and reduce cross-module coupling.
- Before adding an abstraction, verify that it lowers overall cognitive load.
- Prefer designing invalid states out of existence over layering on defensive checks.

Ask yourself: would a senior engineer call this overbuilt? If yes, simplify.

## 4. Make Surgical Changes

**Touch only what the task requires.**

When editing existing code:
- Preserve project conventions and local patterns.
- Avoid unrelated refactors, cleanup, formatting churn, or comment rewrites.
- Match the surrounding style unless changing it is part of the task.
- Every changed line should trace directly to the user's request.
- If you notice unrelated dead code or design issues, mention them separately instead of fixing them opportunistically.

When your change creates fallout:
- Remove imports, variables, or helpers that your change made obsolete.
- Do not remove pre-existing dead code unless asked.

Before substantial implementation:
- Read the relevant specs, standards, product context, or neighboring code.

## 5. Write Comments That Add Information

**Comments should explain what the code cannot.**

- Use comments for intent, invariants, assumptions, constraints, and non-obvious edge cases.
- For public APIs, document behavior and usage expectations.
- Avoid line-by-line narration of what the code already says.
- Keep comments synchronized with behavior changes.
- If a comment is redundant, misleading, or something you do not understand, do not casually rewrite it.

## 6. Drive Work With Verification

**Define success criteria and verify them explicitly.**

Transform vague tasks into checks you can run:
- "Fix the bug" → reproduce it, change the code, verify the reproduction passes.
- "Add validation" → encode invalid cases, then make them pass.
- "Refactor X" → preserve behavior and verify before and after.

For multi-step work, use a short plan with checks:
```
1. [Step] → verify: [check]
2. [Step] → verify: [check]
3. [Step] → verify: [check]
```

At the end:
- Summarize what changed.
- State what you verified.
- Call out any remaining assumptions, risks, or unverified paths.
