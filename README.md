# pi-default-setup

A small pi package that appends default behavioral instructions to pi's system prompt on every turn.

## How it works

- `system-instructions.md` stores the behavioral instructions.
- `extensions/default-setup.ts` listens to `before_agent_start`.
- On each turn, the extension reads `system-instructions.md` and appends it to `event.systemPrompt`.

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
```

## TODO

- If either inactive workflow becomes useful again, extract it into a separate package before expanding it.

## Notes

- Edit the version-controlled `system-instructions.md` to change the appended behavior.
- Because this is a pi package, other users can install it from a local path, npm, or git.
- The package name uses hyphens because package names cannot contain spaces.
- If you want repo-specific behavior later, add a separate `.pi/APPEND_SYSTEM.md` or project-local extension in that repo.
