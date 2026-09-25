import { useEffect, useRef } from "react";
import { EditorState } from "@codemirror/state";
import {
  EditorView,
  lineNumbers,
  keymap,
  drawSelection,
  highlightActiveLine,
  highlightActiveLineGutter,
  placeholder,
} from "@codemirror/view";
import {
  defaultKeymap,
  history,
  historyKeymap,
  indentWithTab,
} from "@codemirror/commands";
import { python } from "@codemirror/lang-python";
import {
  bracketMatching,
  indentOnInput,
  syntaxHighlighting,
  HighlightStyle,
} from "@codemirror/language";
import { tags } from "@lezer/highlight";

type Props = {
  value: string;
  readOnly: boolean;
  onChange?: (value: string) => void;
};
export function CodeEditor({ value, readOnly, onChange }: Props) {
  const host = useRef<HTMLDivElement>(null),
    editor = useRef<EditorView | null>(null);
  const latest = useRef({ value, onChange });
  latest.current = { value, onChange };
  const replacing = useRef(false);
  useEffect(() => {
    const v = new EditorView({
      parent: host.current!,
      state: EditorState.create({
        doc: latest.current.value,
        extensions: [
          lineNumbers(),
          drawSelection(),
          python(),
          bracketMatching(),
          EditorState.readOnly.of(readOnly),
          EditorView.editable.of(!readOnly),
          EditorView.contentAttributes.of({
            "aria-label": readOnly ? "代码显示区" : "代码编辑区",
            spellcheck: "false",
            autocapitalize: "off",
            tabindex: "0",
          }),
          placeholder(
            readOnly
              ? "请在管理页添加代码"
              : "在这里编写或粘贴 Python 代码，也可以上传文件",
          ),
          ...(!readOnly
            ? [
                history(),
                indentOnInput(),
                highlightActiveLine(),
                highlightActiveLineGutter(),
                keymap.of([...defaultKeymap, ...historyKeymap, indentWithTab]),
              ]
            : []),
          EditorView.theme(
            {
              "&": {
                height: "100%",
                color: "#e3e8f2",
                backgroundColor: "#151922",
              },
              ".cm-scroller": {
                fontFamily:
                  '"Cascadia Code", "SFMono-Regular", Consolas, monospace',
                fontSize: "16px",
                lineHeight: "1.8",
                overflow: "auto",
              },
              ".cm-content": { padding: "20px 0 80px" },
              ".cm-line": { paddingLeft: "12px" },
              ".cm-gutters": {
                backgroundColor: "#151922",
                color: "#69768a",
                border: "none",
                paddingLeft: "10px",
              },
              ".cm-lineNumbers .cm-gutterElement": { minWidth: "34px" },
              ".cm-cursor": { borderLeftColor: "#dce5f5" },
              ".cm-activeLine, .cm-activeLineGutter": {
                backgroundColor: "#ffffff05",
              },
              "&.cm-focused .cm-selectionBackground, .cm-selectionBackground": {
                backgroundColor: "#617daf55",
              },
              ".cm-placeholder": { color: "#7e8da3" },
            },
            { dark: true },
          ),
          syntaxHighlighting(
            HighlightStyle.define([
              { tag: tags.keyword, color: "#c9a9ef" },
              { tag: tags.comment, color: "#8191a9" },
              { tag: tags.string, color: "#d1be8c" },
              { tag: [tags.number, tags.bool, tags.null], color: "#8dcdb4" },
              {
                tag: [
                  tags.typeName,
                  tags.className,
                  tags.function(tags.variableName),
                ],
                color: "#8fcee6",
              },
              { tag: tags.operator, color: "#c5d0e8" },
            ]),
          ),
          EditorView.updateListener.of((update) => {
            if (update.docChanged && !replacing.current)
              latest.current.onChange?.(update.state.doc.toString());
          }),
        ],
      }),
    });
    editor.current = v;
    return () => {
      v.destroy();
      editor.current = null;
    };
  }, [readOnly]);
  useEffect(() => {
    const v = editor.current;
    if (v && v.state.doc.toString() !== value) {
      const scroll = v.scrollDOM.scrollTop;
      replacing.current = true;
      v.dispatch({
        changes: { from: 0, to: v.state.doc.length, insert: value },
      });
      replacing.current = false;
      v.scrollDOM.scrollTop = scroll;
    }
  }, [value]);
  return <div className="code-editor" ref={host} />;
}
