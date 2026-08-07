---
name: fowler-refactoring
description: Refactors existing code through small, behavior-preserving transformations following Martin Fowler's method. Use when the user asks to refactor, remove code smells, improve internal design without changing behavior, or reshape code before adding a feature.
license: MIT
metadata:
  methodology: Martin Fowler's Refactoring
  reference: https://refactoring.com/
---

# Fowler Refactoring

Improve the internal structure of existing code without changing its observable behavior.

## Guardrails

- Refactoring and behavior changes are different work. Wear one hat at a time.
- Preserve outputs, side effects, errors, public contracts, and other observable behavior.
- Work in small transformations that leave the code running.
- Refactor for a present need: comprehension, preparation for a change, or removal of observed friction. Do not perform speculative cleanup.
- Prefer automated IDE or language tooling when it implements the intended refactoring safely.
- Keep unrelated cleanup out of the diff.

If behavior must change, finish or revert the refactoring first. Then add a failing test and make the behavior change separately.

## Workflow

1. **Name the purpose**
   - State what is hard to understand or change.
   - Define the improved structure and the behavior that must remain stable.
   - Read every caller and test affected by the proposed change.

2. **Establish safety**
   - Run the relevant tests before editing.
   - If important behavior is untested, add the smallest characterization test that captures it.
   - Stop if there is no practical way to detect behavior changes; propose a seam or test strategy first.

3. **Choose small transformations**
   - Express the refactoring as a short sequence of named operations when possible: Rename, Extract Function, Inline Function, Move Function, Encapsulate Variable, Change Function Declaration, or another entry from Fowler's catalog.
   - Use the catalog at https://refactoring.com/catalog/ when a transformation's mechanics or preconditions are unclear.
   - Prefer the shortest sequence that reaches the stated structure.

4. **Transform and verify**
   - Apply one transformation at a time.
   - Run the narrowest relevant test or compiler check after each step.
   - If a check fails, undo the last step or reduce its size; do not stack another edit on top.
   - Keep the code working throughout.

5. **Validate the result**
   - Run the complete relevant test, type-check, and lint commands.
   - Inspect the diff for accidental behavior changes and unrelated edits.
   - Confirm the original friction is reduced. Stop when the stated purpose is met.

## Example

For "make pricing logic easier to extend":

1. Baseline the pricing tests.
2. Rename ambiguous variables; run the focused tests.
3. Extract the pricing calculation; run the focused tests.
4. Move the extracted function only if that directly enables the pending extension; test again.
5. Run the broader suite and inspect the diff.
6. Add the new pricing behavior only after the refactoring is complete.

## Report

Summarize:
- the structural changes made
- the observable behavior preserved
- the checks run after the transformations
- any behavior change deliberately left for separate work
