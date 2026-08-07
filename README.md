# pi-default-setup

A small pi package that appends default behavioral instructions to pi's system prompt on every turn and bundles reusable skills.

## How it works

- `system-instructions.md` stores the behavioral instructions.
- `extensions/default-setup.ts` registers `/default-setup` commands and listens to `before_agent_start`.
- On each turn, `default-setup.ts` appends the instructions to `event.systemPrompt` and returns the modified prompt.
- The extension reads `system-instructions.md` from disk on each turn, so content changes apply without editing the extension code.

This keeps the instructions versioned in git and makes them distributable as a pi package.

## Install globally

```bash
pi install /absolute/path/to/pi-default-setup
```

Or from git:

```bash
pi install git:github.com/kyerpotts/pi-default-setup
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
```

`/default-setup edit` updates `system-instructions.md` directly. Because the extension reads that file on each turn, changes apply on the next prompt.

## Bundled skills

The package bundles these skills:

- `code-mentor` — senior engineer mentoring and review mode, adapted from your OpenCode `code-mentor` agent
- `fowler-refactoring` — behavior-preserving refactoring through small, continuously verified transformations

After reloading pi, they are available globally as:

```text
/skill:code-mentor
/skill:fowler-refactoring
```

## Inactive prototypes

The Markov Design and evaluation workflow sources remain in the repository for reference, but `package.json` does not expose them to pi. Installing this package does not register `/markov-design`, `/evaluate-work`, or `evaluation_deck`.

## Package layout

```text
pi-default-setup/
  package.json
  system-instructions.md
  extensions/
    default-setup.ts
    evaluation-workflow.ts      # inactive prototype
    markov-design.ts            # inactive prototype
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
    fowler-refactoring/
      SKILL.md
```

## TODO

- Add a dedicated `/code-mentor` pi command or extension to make mentor mode more explicit.
- Consider a lightweight read-only mentor mode that discourages or blocks `edit`/`write` during review sessions.
- Add more portable, non-OpenCode-specific mentoring workflows if `code-mentor` grows beyond the current review pattern.
- If either inactive workflow becomes useful again, extract it into a separate package before expanding it.

## Notes

- Edit `system-instructions.md` or use `/default-setup edit` to change the appended behavior.
- Because this is a pi package, other users can install it from a local path, npm, or git.
- The package name uses hyphens because package names cannot contain spaces.
- If you want repo-specific behavior later, add a separate `.pi/APPEND_SYSTEM.md` or project-local extension in that repo.
