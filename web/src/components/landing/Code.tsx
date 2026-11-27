import type { ReactNode } from "react";

// A tiny syntax highlighter for the landing page samples, in Xcode's default dark palette.
export type Lang = "python" | "js" | "shell" | "html";

const C = {
  keyword: "#ff7ab2",
  string: "#ff8170",
  comment: "#7f8c98",
  number: "#d9c97c",
  fn: "#67b7a4",
  type: "#5dd8ff",
  attr: "#d0a8ff",
  tag: "#5dd8ff",
  flag: "#acf2e4",
  plain: "rgba(255,255,255,0.86)",
};

const KEYWORDS: Record<Lang, string[]> = {
  python: ["import", "from", "def", "return", "if", "else", "for", "in", "as", "with", "None", "True", "False", "and", "or", "not"],
  js: ["import", "from", "export", "function", "const", "let", "return", "await", "async", "new", "if", "else", "true", "false", "null"],
  shell: ["curl"],
  html: [],
};

const RULES: Record<Lang, [RegExp, string][]> = {
  python: [
    [/#[^\n]*/y, "comment"],
    [/[fb]?"(?:\\.|[^"\\])*"|[fb]?'(?:\\.|[^'\\])*'/y, "string"],
    [/\b\d+(?:\.\d+)?\b/y, "number"],
    [/\b[A-Za-z_]\w*(?=\()/y, "fn"],
    [/\b[A-Za-z_]\w*\b/y, "word"],
  ],
  js: [
    [/\/\/[^\n]*/y, "comment"],
    [/`(?:\\.|[^`\\])*`|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'/y, "string"],
    [/\b\d+(?:\.\d+)?\b/y, "number"],
    [/\b[A-Za-z_$][\w$]*(?=\()/y, "fn"],
    [/\b[A-Za-z_$][\w$]*\b/y, "word"],
  ],
  shell: [
    [/#[^\n]*/y, "comment"],
    [/"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'/y, "string"],
    [/\s-{1,2}[A-Za-z][\w-]*/y, "flag"],
    [/\$[A-Z_]+/y, "type"],
    [/\b[A-Za-z_][\w-]*\b/y, "word"],
  ],
  html: [
    [/<!--[\s\S]*?-->/y, "comment"],
    [/<\/?[a-zA-Z][\w-]*/y, "tag"],
    [/\/?>/y, "tag"],
    [/"(?:\\.|[^"\\])*"/y, "string"],
    [/\b[a-z-]+(?==)/y, "attr"],
  ],
};

export function highlight(code: string, lang: Lang): ReactNode[] {
  const out: ReactNode[] = [];
  const rules = RULES[lang];
  let i = 0, plain = "", k = 0;
  const flush = () => {
    if (plain) out.push(<span key={k++} style={{ color: C.plain }}>{plain}</span>);
    plain = "";
  };
  while (i < code.length) {
    let matched = false;
    for (const [re, kind] of rules) {
      re.lastIndex = i;
      const m = re.exec(code);
      if (!m || !m[0]) continue;
      let color: string;
      if (kind === "word") {
        if (!KEYWORDS[lang].includes(m[0])) continue;
        color = C.keyword;
      } else color = C[kind as keyof typeof C];
      flush();
      out.push(<span key={k++} style={{ color }}>{m[0]}</span>);
      i += m[0].length;
      matched = true;
      break;
    }
    if (!matched) plain += code[i++];
  }
  flush();
  return out;
}

export function CodeView({ code, lang }: { code: string; lang: Lang }) {
  return (
    <pre className="p-5 sm:p-6 text-[12.5px] leading-[1.75] font-mono overflow-x-auto">
      <code>{highlight(code, lang)}</code>
    </pre>
  );
}
