import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Editor, type EditorTheme, Key, Text, matchesKey, truncateToWidth, wrapTextWithAnsi } from "@earendil-works/pi-tui";
import { Type } from "@sinclair/typebox";

interface QuestionOption {
  value: string;
  label: string;
  description?: string;
}

type RenderOption = QuestionOption & { isOther?: boolean };

interface Question {
  id: string;
  label: string;
  prompt: string;
  options: QuestionOption[];
  allowOther: boolean;
}

interface Answer {
  id: string;
  value: string;
  label: string;
  wasCustom: boolean;
  index?: number;
}

interface QuestionnaireResult {
  questions: Question[];
  answers: Answer[];
  cancelled: boolean;
}

const QuestionOptionSchema = Type.Object({
  value: Type.String({ description: "The value returned when selected" }),
  label: Type.String({ description: "The display label for the option" }),
  description: Type.Optional(Type.String({ description: "Optional detail shown below the option" })),
});

const QuestionSchema = Type.Object({
  id: Type.String({ description: "Unique identifier for this question" }),
  label: Type.Optional(Type.String({ description: "Short label for the question, e.g. Scope or Tone" })),
  prompt: Type.String({ description: "The full question shown to the user" }),
  options: Type.Array(QuestionOptionSchema, { description: "Options the user can choose from" }),
  allowOther: Type.Optional(Type.Boolean({ description: "Allow a freeform answer option. Defaults to true." })),
});

const QuestionnaireParams = Type.Object({
  questions: Type.Array(QuestionSchema, {
    description: "One or more questions to ask the user. Use one question for a single decision point or multiple questions for related decisions.",
  }),
});

function errorResult(
  message: string,
  questions: Question[] = [],
): { content: { type: "text"; text: string }[]; details: QuestionnaireResult } {
  return {
    content: [{ type: "text", text: message }],
    details: { questions, answers: [], cancelled: true },
  };
}

export default function questionnaireExtension(pi: ExtensionAPI) {
  let registered = false;

  const registerQuestionnaireTool = () => {
    if (registered) {
      return;
    }
    registered = true;

    pi.registerTool({
      name: "questionnaire",
      label: "Questionnaire",
      description:
        "Ask the user one or more structured questions with selectable options and an optional freeform answer. Use this whenever progress depends on a decision, trade-off, branching path, preference, or missing information.",
      promptSnippet: "Ask structured questions with selectable options and an optional freeform answer",
      promptGuidelines: [
        "Use this tool any time progress depends on a user decision, trade-off, branching path, preference, or missing information.",
        "Prefer it over long freeform clarification messages when you can offer concrete options plus an 'other' answer.",
        "Use it broadly across design, planning, writing, research, operations, and software work, not just coding tasks.",
      ],
      parameters: QuestionnaireParams,

      async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
        if (!ctx.hasUI) {
          return errorResult("Error: UI not available (running in non-interactive mode)");
        }
        if (params.questions.length === 0) {
          return errorResult("Error: No questions provided");
        }

        const questions: Question[] = params.questions.map((q, i) => ({
          ...q,
          label: q.label || `Q${i + 1}`,
          allowOther: q.allowOther !== false,
        }));

        const isMulti = questions.length > 1;
        const totalTabs = questions.length + 1;

        const result = await ctx.ui.custom<QuestionnaireResult>((tui, theme, _kb, done) => {
          let currentTab = 0;
          let optionIndex = 0;
          let inputMode = false;
          let inputQuestionId: string | null = null;
          let cachedLines: string[] | undefined;
          const answers = new Map<string, Answer>();

          const editorTheme: EditorTheme = {
            borderColor: (s) => theme.fg("accent", s),
            selectList: {
              selectedPrefix: (t) => theme.fg("accent", t),
              selectedText: (t) => theme.fg("accent", t),
              description: (t) => theme.fg("muted", t),
              scrollInfo: (t) => theme.fg("dim", t),
              noMatch: (t) => theme.fg("warning", t),
            },
          };
          const editor = new Editor(tui, editorTheme);

          function refresh() {
            cachedLines = undefined;
            tui.requestRender();
          }

          function submit(cancelled: boolean) {
            done({ questions, answers: Array.from(answers.values()), cancelled });
          }

          function currentQuestion(): Question | undefined {
            return questions[currentTab];
          }

          function currentOptions(): RenderOption[] {
            const question = currentQuestion();
            if (!question) {
              return [];
            }
            const options: RenderOption[] = [...question.options];
            if (question.allowOther) {
              options.push({ value: "__other__", label: "Type something.", isOther: true });
            }
            return options;
          }

          function allAnswered(): boolean {
            return questions.every((question) => answers.has(question.id));
          }

          function advanceAfterAnswer() {
            if (!isMulti) {
              submit(false);
              return;
            }
            if (currentTab < questions.length - 1) {
              currentTab++;
            } else {
              currentTab = questions.length;
            }
            optionIndex = 0;
            refresh();
          }

          function saveAnswer(questionId: string, value: string, label: string, wasCustom: boolean, index?: number) {
            answers.set(questionId, { id: questionId, value, label, wasCustom, index });
          }

          editor.onSubmit = (value) => {
            if (!inputQuestionId) {
              return;
            }
            const trimmed = value.trim() || "(no response)";
            saveAnswer(inputQuestionId, trimmed, trimmed, true);
            inputMode = false;
            inputQuestionId = null;
            editor.setText("");
            advanceAfterAnswer();
          };

          function handleInput(data: string) {
            if (inputMode) {
              if (matchesKey(data, Key.escape)) {
                inputMode = false;
                inputQuestionId = null;
                editor.setText("");
                refresh();
                return;
              }
              editor.handleInput(data);
              refresh();
              return;
            }

            const question = currentQuestion();
            const options = currentOptions();

            if (isMulti) {
              if (matchesKey(data, Key.tab) || matchesKey(data, Key.right)) {
                currentTab = (currentTab + 1) % totalTabs;
                optionIndex = 0;
                refresh();
                return;
              }
              if (matchesKey(data, Key.shift("tab")) || matchesKey(data, Key.left)) {
                currentTab = (currentTab - 1 + totalTabs) % totalTabs;
                optionIndex = 0;
                refresh();
                return;
              }
            }

            if (currentTab === questions.length) {
              if (matchesKey(data, Key.enter) && allAnswered()) {
                submit(false);
              } else if (matchesKey(data, Key.escape)) {
                submit(true);
              }
              return;
            }

            if (matchesKey(data, Key.up)) {
              optionIndex = Math.max(0, optionIndex - 1);
              refresh();
              return;
            }
            if (matchesKey(data, Key.down)) {
              optionIndex = Math.min(options.length - 1, optionIndex + 1);
              refresh();
              return;
            }

            if (matchesKey(data, Key.enter) && question) {
              const option = options[optionIndex];
              if (option.isOther) {
                inputMode = true;
                inputQuestionId = question.id;
                editor.setText("");
                refresh();
                return;
              }
              saveAnswer(question.id, option.value, option.label, false, optionIndex + 1);
              advanceAfterAnswer();
              return;
            }

            if (matchesKey(data, Key.escape)) {
              submit(true);
            }
          }

          function render(width: number): string[] {
            if (cachedLines) {
              return cachedLines;
            }

            const lines: string[] = [];
            const question = currentQuestion();
            const options = currentOptions();
            const add = (text: string) => lines.push(truncateToWidth(text, width));
            const addWrapped = (text: string, indent = "") => {
              const wrapWidth = Math.max(1, width - indent.length);
              for (const line of wrapTextWithAnsi(text, wrapWidth)) {
                add(`${indent}${line}`);
              }
            };

            add(theme.fg("accent", "─".repeat(width)));

            if (isMulti) {
              const tabs: string[] = ["← "];
              for (let i = 0; i < questions.length; i++) {
                const isActive = i === currentTab;
                const isAnswered = answers.has(questions[i].id);
                const label = questions[i].label;
                const box = isAnswered ? "■" : "□";
                const color = isAnswered ? "success" : "muted";
                const text = ` ${box} ${label} `;
                const styled = isActive ? theme.bg("selectedBg", theme.fg("text", text)) : theme.fg(color, text);
                tabs.push(`${styled} `);
              }
              const canSubmit = allAnswered();
              const isSubmitTab = currentTab === questions.length;
              const submitText = " ✓ Submit ";
              const submitStyled = isSubmitTab
                ? theme.bg("selectedBg", theme.fg("text", submitText))
                : theme.fg(canSubmit ? "success" : "dim", submitText);
              tabs.push(`${submitStyled} →`);
              add(` ${tabs.join("")}`);
              lines.push("");
            }

            function renderOptions() {
              for (let i = 0; i < options.length; i++) {
                const option = options[i];
                const selected = i === optionIndex;
                const prefix = selected ? theme.fg("accent", "> ") : "  ";
                const color = selected ? "accent" : "text";
                if (option.isOther && inputMode) {
                  add(prefix + theme.fg("accent", `${i + 1}. ${option.label} ✎`));
                } else {
                  add(prefix + theme.fg(color, `${i + 1}. ${option.label}`));
                }
                if (option.description) {
                  add(`     ${theme.fg("muted", option.description)}`);
                }
              }
            }

            if (inputMode && question) {
              addWrapped(theme.fg("text", question.prompt), " ");
              lines.push("");
              renderOptions();
              lines.push("");
              add(theme.fg("muted", " Your answer:"));
              for (const line of editor.render(width - 2)) {
                add(` ${line}`);
              }
              lines.push("");
              add(theme.fg("dim", " Enter to submit • Esc to cancel"));
            } else if (currentTab === questions.length) {
              add(theme.fg("accent", theme.bold(" Ready to submit")));
              lines.push("");
              for (const item of questions) {
                const answer = answers.get(item.id);
                if (answer) {
                  const prefix = answer.wasCustom ? "(wrote) " : "";
                  add(`${theme.fg("muted", ` ${item.label}: `)}${theme.fg("text", prefix + answer.label)}`);
                }
              }
              lines.push("");
              if (allAnswered()) {
                add(theme.fg("success", " Press Enter to submit"));
              } else {
                const missing = questions
                  .filter((item) => !answers.has(item.id))
                  .map((item) => item.label)
                  .join(", ");
                add(theme.fg("warning", ` Unanswered: ${missing}`));
              }
            } else if (question) {
              addWrapped(theme.fg("text", question.prompt), " ");
              lines.push("");
              renderOptions();
            }

            lines.push("");
            if (!inputMode) {
              const help = isMulti
                ? " Tab/←→ navigate • ↑↓ select • Enter confirm • Esc cancel"
                : " ↑↓ navigate • Enter select • Esc cancel";
              add(theme.fg("dim", help));
            }
            add(theme.fg("accent", "─".repeat(width)));

            cachedLines = lines;
            return lines;
          }

          return {
            render,
            invalidate: () => {
              cachedLines = undefined;
            },
            handleInput,
          };
        });

        if (result.cancelled) {
          return {
            content: [{ type: "text", text: "User cancelled the questionnaire" }],
            details: result,
          };
        }

        const answerLines = result.answers.map((answer) => {
          const label = questions.find((question) => question.id === answer.id)?.label || answer.id;
          if (answer.wasCustom) {
            return `${label}: user wrote: ${answer.label}`;
          }
          return `${label}: user selected: ${answer.index}. ${answer.label}`;
        });

        return {
          content: [{ type: "text", text: answerLines.join("\n") }],
          details: result,
        };
      },

      renderCall(args, theme) {
        const questions = (args.questions as Question[]) || [];
        const count = questions.length;
        const labels = questions.map((question) => question.label || question.id).join(", ");
        let text = theme.fg("toolTitle", theme.bold("questionnaire "));
        text += theme.fg("muted", `${count} question${count !== 1 ? "s" : ""}`);
        if (labels) {
          text += theme.fg("dim", ` (${truncateToWidth(labels, 40)})`);
        }
        return new Text(text, 0, 0);
      },

      renderResult(result, _options, theme) {
        const details = result.details as QuestionnaireResult | undefined;
        if (!details) {
          const text = result.content[0];
          return new Text(text?.type === "text" ? text.text : "", 0, 0);
        }
        if (details.cancelled) {
          return new Text(theme.fg("warning", "Cancelled"), 0, 0);
        }
        const lines = details.answers.map((answer) => {
          if (answer.wasCustom) {
            return `${theme.fg("success", "✓ ")}${theme.fg("accent", answer.id)}: ${theme.fg("muted", "(wrote) ")}${answer.label}`;
          }
          const display = answer.index ? `${answer.index}. ${answer.label}` : answer.label;
          return `${theme.fg("success", "✓ ")}${theme.fg("accent", answer.id)}: ${display}`;
        });
        return new Text(lines.join("\n"), 0, 0);
      },
    });
  };

  pi.on("session_start", (_event, ctx) => {
    if (ctx.hasUI) {
      registerQuestionnaireTool();
    }
  });
}
