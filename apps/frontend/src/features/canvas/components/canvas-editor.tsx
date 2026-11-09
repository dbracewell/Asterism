"use client";
import { useTheme } from "@/features/theme/components/theme-context";
import { markdown } from "@codemirror/lang-markdown";
import { LanguageDescription } from "@codemirror/language";
import { languages } from "@codemirror/language-data";
import { useQuery } from "@tanstack/react-query";
import CodeMirror, { EditorView, type Extension } from "@uiw/react-codemirror";
import { MAX_SELECTION_LENGTH } from "../lib/canvas";

// Follow the app's surface and type; token colors come from the light/dark theme.
const surface = EditorView.theme({
  "&": {
    height: "100%",
    fontSize: "var(--text-sm, 0.875rem)",
    backgroundColor: "var(--background)",
  },
  ".cm-scroller": { fontFamily: "var(--font-mono, ui-monospace, monospace)" },
  ".cm-gutters": {
    backgroundColor: "var(--muted)",
    color: "var(--muted-foreground)",
    border: "none",
  },
  "&.cm-focused": { outline: "2px solid var(--ring)", outlineOffset: "-2px" },
});

function useLanguage(mode: "markdown" | "code", language: string) {
  return useQuery({
    queryKey: ["codemirror-language", mode, language],
    queryFn: async (): Promise<Extension[]> => {
      if (mode === "markdown") return [markdown({ codeLanguages: languages })];
      const found = LanguageDescription.matchLanguageName(
        languages,
        language,
        true,
      );
      return found ? [await found.load()] : [];
    },
    staleTime: Infinity,
    gcTime: Infinity,
  });
}

/**
 * CodeMirror for canvas text: Markdown for documents, the item's language for
 * code. Reports the selected text so the user can ask about it.
 */
export default function CanvasEditor({
  value,
  onChange,
  mode,
  language,
  label,
  readOnly,
  onSelection,
}: {
  value: string;
  onChange: (value: string) => void;
  mode: "markdown" | "code";
  language: string;
  label: string;
  readOnly: boolean;
  onSelection: (text: string) => void;
}) {
  const theme = useTheme();
  const loaded = useLanguage(mode, language);
  return (
    <CodeMirror
      value={value}
      onChange={onChange}
      readOnly={readOnly}
      editable={!readOnly}
      theme={theme.currentThemeType === "dark" ? "dark" : "light"}
      height="100%"
      className="h-full min-h-0"
      basicSetup={{ foldGutter: false, highlightActiveLine: !readOnly }}
      extensions={[
        surface,
        EditorView.lineWrapping,
        EditorView.contentAttributes.of({
          "aria-label": label,
          "aria-multiline": "true",
        }),
        ...(loaded.data ?? []),
      ]}
      onUpdate={(update) => {
        if (!update.selectionSet) return;
        const { from, to } = update.state.selection.main;
        onSelection(
          update.state.sliceDoc(
            from,
            Math.min(to, from + MAX_SELECTION_LENGTH),
          ),
        );
      }}
    />
  );
}
