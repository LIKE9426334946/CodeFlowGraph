import { forwardRef, useEffect, useImperativeHandle, useRef } from "react";
import {
  EditorState,
  StateEffect,
  StateField,
  RangeSet,
  Compartment,
} from "@codemirror/state";
import {
  EditorView,
  Decoration,
  GutterMarker,
  gutter,
  lineNumbers,
  highlightActiveLine,
  highlightActiveLineGutter,
  keymap,
  drawSelection,
  dropCursor,
} from "@codemirror/view";
import {
  defaultKeymap,
  history,
  historyKeymap,
  indentWithTab,
} from "@codemirror/commands";
import {
  searchKeymap,
  highlightSelectionMatches,
  openSearchPanel,
} from "@codemirror/search";
import { python } from "@codemirror/lang-python";
import {
  bracketMatching,
  indentOnInput,
  syntaxHighlighting,
  HighlightStyle,
} from "@codemirror/language";
import { tags } from "@lezer/highlight";
import type { Binding, CodeSelection, SourceFile, UIState } from "../types";

type Marks = { bindings: Binding[]; selected: string | null };
const setMarks = StateEffect.define<Marks>();
const marks = StateField.define<Marks>({
  create: () => ({ bindings: [], selected: null }),
  update: (value, tr) => {
    for (const e of tr.effects) if (e.is(setMarks)) return e.value;
    if (tr.docChanged)
      return {
        ...value,
        bindings: mapBindingLines(
          value.bindings,
          tr.startState,
          tr.state,
          tr.changes,
        ),
      };
    return value;
  },
});
function mapBindingLines(
  bindings: Binding[],
  old: EditorState,
  next: EditorState,
  changes: { mapPos: (p: number, assoc: number) => number },
) {
  return bindings.map((b) => {
    const from = old.doc.line(Math.min(b.code.startLine, old.doc.lines)).from;
    const to = old.doc.line(Math.min(b.code.endLine, old.doc.lines)).to;
    const start = Math.min(next.doc.length, changes.mapPos(from, 1));
    const end = Math.max(
      start,
      Math.min(next.doc.length, changes.mapPos(to, -1)),
    );
    return {
      ...b,
      code: {
        ...b.code,
        startLine: next.doc.lineAt(start).number,
        endLine: next.doc.lineAt(end).number,
      },
    };
  });
}
const decorations = EditorView.decorations.compute([marks], (state) => {
  const m = state.field(marks);
  const lines = new Map<number, { color: string; active: boolean }>();
  for (const b of m.bindings)
    for (
      let n = b.code.startLine;
      n <= Math.min(b.code.endLine, state.doc.lines);
      n++
    ) {
      const active = b.id === m.selected;
      if (!lines.has(n) || active) lines.set(n, { color: b.color, active });
    }
  return Decoration.set(
    [...lines.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([n, value]) =>
        Decoration.line({
          class: value.active
            ? "cm-bound-line cm-bound-active"
            : "cm-bound-line",
          attributes: { style: `--binding-color:${value.color}` },
        }).range(state.doc.line(n).from),
      ),
  );
});
class Dot extends GutterMarker {
  constructor(
    readonly color: string,
    readonly label: string,
  ) {
    super();
  }
  eq(other: Dot) {
    return this.color === other.color && this.label === other.label;
  }
  toDOM() {
    const e = document.createElement("span");
    e.className = "binding-dot";
    e.style.backgroundColor = this.color;
    e.title = this.label;
    e.setAttribute("aria-label", this.label);
    return e;
  }
}
export type CodeEditorHandle = {
  reveal: (start: number, end: number) => void;
  search: () => void;
  view: () => EditorView | null;
};
type Props = {
  file: SourceFile;
  bindings: Binding[];
  selectedId: string | null;
  theme: "dark" | "light";
  savedView?: UIState["editorViews"][string];
  onChange: (
    content: string,
    bindings: Binding[],
    view: UIState["editorViews"][string],
  ) => void;
  onSelection: (range: CodeSelection) => void;
  onView: (view: UIState["editorViews"][string]) => void;
  onActivate: (id: string) => void;
};
export const CodeEditor = forwardRef<CodeEditorHandle, Props>(
  function CodeEditor(props, ref) {
    const host = useRef<HTMLDivElement>(null),
      editor = useRef<EditorView | null>(null),
      latest = useRef(props);
    latest.current = props;
    const themeConfig = useRef(new Compartment());
    const getTheme = (dark: boolean) => [
      EditorView.theme(
        {
          "&": {
            height: "100%",
            backgroundColor: "var(--editor-bg)",
            color: "var(--text)",
          },
          ".cm-scroller": {
            fontFamily:
              '"JetBrains Mono", "Cascadia Code", "SFMono-Regular", Consolas, monospace',
            fontSize: "14px",
            lineHeight: "1.85",
            overflow: "auto",
          },
          ".cm-content": { padding: "16px 0 80px" },
          ".cm-gutters": {
            background: "var(--editor-bg)",
            color: "var(--subtle)",
            border: "none",
            paddingLeft: "4px",
          },
          ".cm-lineNumbers .cm-gutterElement": { minWidth: "35px" },
          ".cm-cursor": { borderLeftColor: "var(--text)" },
          ".cm-activeLine, .cm-activeLineGutter": {
            backgroundColor: "var(--active-line)",
          },
          "&.cm-focused .cm-selectionBackground, .cm-selectionBackground, ::selection":
            { backgroundColor: "var(--selection) !important" },
          ".cm-panels": {
            backgroundColor: "var(--panel)",
            color: "var(--text)",
          },
          ".cm-searchMatch": { backgroundColor: "#c69c393f" },
          ".cm-searchMatch-selected": { backgroundColor: "#c69c397f" },
        },
        { dark },
      ),
      syntaxHighlighting(
        HighlightStyle.define([
          { tag: tags.keyword, color: dark ? "#c3a0eb" : "#8550b9" },
          { tag: tags.comment, color: dark ? "#7e8da6" : "#7a8595" },
          { tag: tags.string, color: dark ? "#c8b789" : "#876124" },
          {
            tag: [tags.number, tags.bool, tags.null],
            color: dark ? "#8acbb6" : "#15736a",
          },
          {
            tag: [
              tags.typeName,
              tags.className,
              tags.function(tags.variableName),
            ],
            color: dark ? "#88c7e5" : "#166c98",
          },
          { tag: tags.operator, color: dark ? "#bdc5e0" : "#576477" },
          {
            tag: tags.definition(tags.variableName),
            color: dark ? "#b7c9e6" : "#325c87",
          },
        ]),
      ),
    ];
    useImperativeHandle(
      ref,
      () => ({
        reveal(start, end) {
          const v = editor.current;
          if (!v) return;
          const a = v.state.doc.line(
            Math.max(1, Math.min(start, v.state.doc.lines)),
          ).from;
          const b = v.state.doc.line(
            Math.max(1, Math.min(end, v.state.doc.lines)),
          ).to;
          v.dispatch({
            selection: { anchor: a, head: b },
            effects: EditorView.scrollIntoView(a, { y: "center" }),
          });
        },
        search() {
          if (editor.current) openSearchPanel(editor.current);
        },
        view() {
          return editor.current;
        },
      }),
      [],
    );
    useEffect(() => {
      if (!host.current) return;
      const p = latest.current;
      let scrollTimer: ReturnType<typeof setTimeout>;
      const viewInfo = (v: EditorView) => ({
        anchor: v.state.selection.main.anchor,
        head: v.state.selection.main.head,
        scrollTop: v.scrollDOM.scrollTop,
        scrollLeft: v.scrollDOM.scrollLeft,
      });
      const reportSelection = (v: EditorView) => {
        const s = v.state.selection.main;
        latest.current.onSelection({
          file: latest.current.file.name,
          startLine: v.state.doc.lineAt(s.from).number,
          endLine: v.state.doc.lineAt(
            s.empty ? s.to : Math.max(s.from, s.to - 1),
          ).number,
        });
      };
      const activateAt = (v: EditorView, pos: number) => {
        const line = v.state.doc.lineAt(pos).number;
        const candidates = v.state
          .field(marks)
          .bindings.filter(
            (b) => b.code.startLine <= line && b.code.endLine >= line,
          );
        if (!candidates.length) return false;
        const index = candidates.findIndex(
          (b) => b.id === latest.current.selectedId,
        );
        latest.current.onActivate(
          candidates[(index + 1) % candidates.length].id,
        );
        return true;
      };
      const v = new EditorView({
        parent: host.current,
        state: EditorState.create({
          doc: p.file.content,
          selection: {
            anchor: Math.min(p.savedView?.anchor || 0, p.file.content.length),
            head: Math.min(p.savedView?.head || 0, p.file.content.length),
          },
          extensions: [
            lineNumbers(),
            highlightActiveLineGutter(),
            history(),
            drawSelection(),
            dropCursor(),
            indentOnInput(),
            bracketMatching(),
            highlightActiveLine(),
            highlightSelectionMatches(),
            python(),
            keymap.of([
              ...defaultKeymap,
              ...historyKeymap,
              ...searchKeymap,
              indentWithTab,
            ]),
            themeConfig.current.of(getTheme(p.theme === "dark")),
            marks,
            decorations,
            EditorView.contentAttributes.of({
              "aria-label": "Python 代码编辑器",
              spellcheck: "false",
              autocapitalize: "off",
            }),
            gutter({
              class: "cm-binding-gutter",
              markers: (view) => {
                const byLine = new Map<number, Binding[]>();
                for (const b of view.state.field(marks).bindings)
                  for (
                    let n = b.code.startLine;
                    n <= Math.min(b.code.endLine, view.state.doc.lines);
                    n++
                  )
                    byLine.set(n, [...(byLine.get(n) || []), b]);
                return RangeSet.of(
                  [...byLine]
                    .sort((a, b) => a[0] - b[0])
                    .map(([n, b]) =>
                      new Dot(
                        b[0].color,
                        b.map((x) => x.name).join(" / "),
                      ).range(view.state.doc.line(n).from),
                    ),
                );
              },
              initialSpacer: () => new Dot("transparent", ""),
              domEventHandlers: {
                click: (v, line) => activateAt(v, line.from),
              },
            }),
            EditorView.updateListener.of((update) => {
              if (update.docChanged)
                latest.current.onChange(
                  update.state.doc.toString(),
                  update.state.field(marks).bindings,
                  viewInfo(update.view),
                );
              if (update.selectionSet || update.docChanged) {
                reportSelection(update.view);
                if (!update.docChanged)
                  latest.current.onView(viewInfo(update.view));
              }
            }),
            EditorView.domEventHandlers({
              click: (event, view) => {
                if (view.state.selection.main.empty && event.detail === 1) {
                  const pos = view.posAtCoords({
                    x: event.clientX,
                    y: event.clientY,
                  });
                  if (pos !== null) activateAt(view, pos);
                }
                return false;
              },
              scroll: () => {
                clearTimeout(scrollTimer);
                scrollTimer = setTimeout(
                  () => latest.current.onView(viewInfo(v)),
                  180,
                );
                return false;
              },
            }),
          ],
        }),
      });
      editor.current = v;
      v.dispatch({
        effects: setMarks.of({
          bindings: p.bindings.filter((b) => b.code.file === p.file.name),
          selected: p.selectedId,
        }),
      });
      const frame = requestAnimationFrame(() => {
        v.scrollDOM.scrollTop = p.savedView?.scrollTop || 0;
        v.scrollDOM.scrollLeft = p.savedView?.scrollLeft || 0;
        reportSelection(v);
      });
      return () => {
        clearTimeout(scrollTimer);
        cancelAnimationFrame(frame);
        v.destroy();
        editor.current = null;
      };
    }, [props.file.id]);
    useEffect(() => {
      const v = editor.current;
      if (!v) return;
      v.dispatch({
        effects: setMarks.of({
          bindings: props.bindings.filter(
            (b) => b.code.file === props.file.name,
          ),
          selected: props.selectedId,
        }),
      });
    }, [props.bindings, props.selectedId, props.file.name]);
    useEffect(() => {
      editor.current?.dispatch({
        effects: themeConfig.current.reconfigure(
          getTheme(props.theme === "dark"),
        ),
      });
    }, [props.theme]);
    return <div className="code-editor" ref={host} />;
  },
);
