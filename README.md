# pi-default-setup

A small pi package that appends default behavioral instructions to pi's system prompt on every turn and bundles reusable skills.

## How it works

- `system-instructions.md` stores the behavioral instructions.
- `extensions/default-setup.ts` registers `/default-setup` commands and listens to `before_agent_start`.
- `extensions/questionnaire.ts` registers an interactive `questionnaire` tool for structured decisions and missing information.
- `extensions/lib/subagent-runner.ts` provides the private pi subprocess runtime used by extension-owned multi-agent workflows.
- On each turn, `default-setup.ts` appends the instructions to `event.systemPrompt` and returns the modified prompt.
- The extension reads `system-instructions.md` from disk on each turn, so content changes apply without editing the extension code.

This keeps the instructions versioned in git and makes them distributable as a pi package.

## Install globally

```bash
pi install /absolute/path/to/pi-default-setup
```

Or from git:

```bash
pi install git:github.com/<you>/pi-default-setup
```

After installation, restart pi or run `/reload`.

## Commands

```text
/default-setup         # show command help and available subcommands
/default-setup help    # show command help and available subcommands
/default-setup show    # display the current appended instructions
/default-setup edit    # open a multi-line editor and save changes
/default-setup path    # show the instructions file path
/default-setup reload  # reload extensions, skills, prompts, and themes
/markov-design <topic> # start the Markov Design workflow
```

`/default-setup edit` updates `system-instructions.md` directly. Because the extension reads that file on each turn, changes apply on the next prompt.

## Bundled skills

The package now bundles these skills:

- `engineering-discipline` — default implementation discipline, adapted from `forrestchang/andrej-karpathy-skills` plus your OpenCode standards
- `code-mentor` — senior engineer mentoring and review mode, adapted from your OpenCode `code-mentor` agent

After reloading pi, they are available globally as:

```text
/skill:engineering-discipline
/skill:code-mentor
```

## Markov Design workflow

The package also bundles a first pi adaptation of your Markov Design workflow.

Start it with:

```text
/markov-design <topic>
```

This runs the bundled Markov agents inside isolated `pi` subprocesses and drives the workflow through an interactive slash-command flow in pi.

Bundled Markov agents:

- `markov-clarifier`
- `markov-adversary`
- `markov-constraint-reviewer`
- `markov-synthesis`
- `markov-rfc-writer`
- `markov-hld-writer`
- `markov-topology-writer`
- `markov-final-summary-writer`

### Current Markov limitations

- workflow state is interactive and in-memory, not yet resumable as a first-class Markov session state
- artifacts are rendered in-session, not yet automatically exported to dedicated files
- node lifecycle controls are approximated in the extension rather than fully modeled as a persisted workflow engine
- convergence and transition behavior still need hardening

### Markov TODO

- persist canonical Markov state across reloads and restarts
- make Markov runs resumable and inspectable as a workflow
- export generated artifacts directly to files
- tighten node lifecycle rules and convergence controls
- add better auditing of user decisions, state transitions, and generated artifacts
- extract Markov Design into its own discrete pi extension

## Interactive questionnaire tool

In interactive sessions, the package also registers a `questionnaire` tool that the model can call to ask one or more structured questions with selectable answers and a freeform fallback.

Use cases include:

- design choices
- trade-offs
- branching paths
- preferences
- any missing information the model needs to proceed

The tool is intended to be broad, not just for software architecture or coding tasks.

## Package layout

```text
pi-default-setup/
  package.json
  system-instructions.md
  extensions/
    default-setup.ts
    evaluation-workflow.ts      # retained in repo, not exposed by package manifest
    markov-design.ts
    questionnaire.ts
    lib/
      pi-subprocess.ts
      subagent-output.ts
      subagent-runner.ts
    markov-design-agents/
      markov-adversary.md
      markov-clarifier.md
      markov-constraint-reviewer.md
      markov-final-summary-writer.md
      markov-hld-writer.md
      markov-rfc-writer.md
      markov-synthesis.md
      markov-topology-writer.md
  skills/
    code-mentor/
      SKILL.md
    engineering-discipline/
      SKILL.md
    evaluation-workflow/
      SKILL.md                   # retained in repo, not exposed by package manifest
```

## TODO

- Add a dedicated `/code-mentor` pi command or extension to make mentor mode more explicit.
- Consider a lightweight read-only mentor mode that discourages or blocks `edit`/`write` during review sessions.
- Decide whether `engineering-discipline` should also have a condensed always-on version in `system-instructions.md`.
- Add more portable, non-OpenCode-specific mentoring workflows if `code-mentor` grows beyond the current review pattern.
- Improve the evaluation workflow with automatic screenshot/video discovery and capture conventions once it is ready to be re-exposed.
- Add richer HTML deck layouts, artifact templates, and export targets.
- extract the evaluation workflow into its own discrete pi extension
- port interface-design and architecture exploration workflows onto the private subagent runner

## Notes

- Edit `system-instructions.md` or use `/default-setup edit` to change the appended behavior.
- Because this is a pi package, other users can install it from a local path, npm, or git.
- The package name uses hyphens because package names cannot contain spaces.
- Evaluation workflow prototype code is still in this repo, but the package manifest no longer exposes it to pi.
- If you want repo-specific behavior later, add a separate `.pi/APPEND_SYSTEM.md` or project-local extension in that repo.
