/**
 * Format delivery / artifact content for preview:
 * Markdown, code, JSON, YAML, Diff, CSV, HTML, plain text.
 * Uses marked + DOMPurify + highlight.js.
 */
import { marked } from "marked";
import purify from "dompurify";
import hljs from "highlight.js/lib/core";

// Vite / CJS interop: default export may be nested under `.default`.
const DOMPurify =
  typeof (purify as { sanitize?: unknown }).sanitize === "function"
    ? purify
    : ((purify as { default?: typeof purify }).default ?? purify);

import bash from "highlight.js/lib/languages/bash";
import c from "highlight.js/lib/languages/c";
import cpp from "highlight.js/lib/languages/cpp";
import csharp from "highlight.js/lib/languages/csharp";
import css from "highlight.js/lib/languages/css";
import diff from "highlight.js/lib/languages/diff";
import dockerfile from "highlight.js/lib/languages/dockerfile";
import go from "highlight.js/lib/languages/go";
import ini from "highlight.js/lib/languages/ini";
import java from "highlight.js/lib/languages/java";
import javascript from "highlight.js/lib/languages/javascript";
import json from "highlight.js/lib/languages/json";
import kotlin from "highlight.js/lib/languages/kotlin";
import less from "highlight.js/lib/languages/less";
import markdown from "highlight.js/lib/languages/markdown";
import objectivec from "highlight.js/lib/languages/objectivec";
import php from "highlight.js/lib/languages/php";
import plaintext from "highlight.js/lib/languages/plaintext";
import python from "highlight.js/lib/languages/python";
import ruby from "highlight.js/lib/languages/ruby";
import rust from "highlight.js/lib/languages/rust";
import scss from "highlight.js/lib/languages/scss";
import shell from "highlight.js/lib/languages/shell";
import sql from "highlight.js/lib/languages/sql";
import swift from "highlight.js/lib/languages/swift";
import typescript from "highlight.js/lib/languages/typescript";
import xml from "highlight.js/lib/languages/xml";
import yaml from "highlight.js/lib/languages/yaml";

hljs.registerLanguage("bash", bash);
hljs.registerLanguage("c", c);
hljs.registerLanguage("cpp", cpp);
hljs.registerLanguage("csharp", csharp);
hljs.registerLanguage("css", css);
hljs.registerLanguage("diff", diff);
hljs.registerLanguage("dockerfile", dockerfile);
hljs.registerLanguage("go", go);
hljs.registerLanguage("ini", ini);
hljs.registerLanguage("java", java);
hljs.registerLanguage("javascript", javascript);
hljs.registerLanguage("json", json);
hljs.registerLanguage("kotlin", kotlin);
hljs.registerLanguage("less", less);
hljs.registerLanguage("markdown", markdown);
hljs.registerLanguage("objectivec", objectivec);
hljs.registerLanguage("php", php);
hljs.registerLanguage("plaintext", plaintext);
hljs.registerLanguage("python", python);
hljs.registerLanguage("ruby", ruby);
hljs.registerLanguage("rust", rust);
hljs.registerLanguage("scss", scss);
hljs.registerLanguage("shell", shell);
hljs.registerLanguage("sql", sql);
hljs.registerLanguage("swift", swift);
hljs.registerLanguage("typescript", typescript);
hljs.registerLanguage("xml", xml);
hljs.registerLanguage("yaml", yaml);
// aliases
hljs.registerLanguage("js", javascript);
hljs.registerLanguage("ts", typescript);
hljs.registerLanguage("tsx", typescript);
hljs.registerLanguage("jsx", javascript);
hljs.registerLanguage("py", python);
hljs.registerLanguage("rs", rust);
hljs.registerLanguage("yml", yaml);
hljs.registerLanguage("html", xml);
hljs.registerLanguage("htm", xml);
hljs.registerLanguage("svg", xml);
hljs.registerLanguage("sh", bash);
hljs.registerLanguage("zsh", bash);
hljs.registerLanguage("toml", ini);
hljs.registerLanguage("patch", diff);

marked.setOptions({
  gfm: true,
  breaks: true,
});

// Highlight fenced code blocks inside Markdown.
// Links open externally (target=_blank) so the app webview never navigates away.
marked.use({
  renderer: {
    code({ text, lang }: { text: string; lang?: string }) {
      const language = (lang || "").trim().split(/\s+/)[0] || "";
      const valid =
        language && hljs.getLanguage(language) ? language : "";
      const highlighted = valid
        ? hljs.highlight(text, { language: valid, ignoreIllegals: true }).value
        : escapeHtml(text);
      const cls = valid
        ? `hljs language-${escapeHtml(valid)}`
        : "hljs";
      return `<pre class="fmt-code"><code class="${cls}">${highlighted}</code></pre>\n`;
    },
    link({ href, title, tokens }: { href: string; title?: string | null; tokens: unknown[] }) {
      // marked injects `this.parser` on the renderer at call time.
      const self = this as unknown as {
        parser?: { parseInline: (t: unknown[]) => string };
      };
      const text = self.parser?.parseInline(tokens) ?? "";
      if (!href) return text;
      const safeHref = escapeHtml(href);
      const titleAttr = title ? ` title="${escapeHtml(title)}"` : "";
      return `<a href="${safeHref}"${titleAttr} target="_blank" rel="noopener noreferrer">${text}</a>`;
    },
  },
});

export type ContentKind =
  | "markdown"
  | "code"
  | "json"
  | "csv"
  | "tsv"
  | "diff"
  | "html"
  | "text";

export type FormattedContent = {
  kind: ContentKind;
  language?: string;
  /** Safe HTML ready for innerHTML. */
  html: string;
};

const EXT_LANG: Record<string, string> = {
  md: "markdown",
  mdx: "markdown",
  markdown: "markdown",
  json: "json",
  jsonc: "json",
  jsonl: "json",
  ndjson: "json",
  yml: "yaml",
  yaml: "yaml",
  toml: "ini",
  ini: "ini",
  conf: "ini",
  cfg: "ini",
  env: "ini",
  js: "javascript",
  mjs: "javascript",
  cjs: "javascript",
  jsx: "javascript",
  ts: "typescript",
  mts: "typescript",
  cts: "typescript",
  tsx: "typescript",
  py: "python",
  pyi: "python",
  rs: "rust",
  go: "go",
  java: "java",
  kt: "kotlin",
  kts: "kotlin",
  swift: "swift",
  rb: "ruby",
  php: "php",
  c: "c",
  h: "c",
  cpp: "cpp",
  cc: "cpp",
  cxx: "cpp",
  hpp: "cpp",
  cs: "csharp",
  m: "objectivec",
  mm: "objectivec",
  sh: "bash",
  bash: "bash",
  zsh: "bash",
  fish: "bash",
  ps1: "bash",
  sql: "sql",
  css: "css",
  scss: "scss",
  less: "less",
  html: "html",
  htm: "html",
  xhtml: "html",
  xml: "xml",
  svg: "xml",
  vue: "xml",
  svelte: "xml",
  diff: "diff",
  patch: "diff",
  dockerfile: "dockerfile",
  docker: "dockerfile",
  csv: "csv",
  tsv: "tsv",
  txt: "plaintext",
  log: "plaintext",
  text: "plaintext",
};

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function fileExt(path: string): string {
  const base = path.split(/[/\\]/).pop() || path;
  if (/^Dockerfile$/i.test(base)) return "dockerfile";
  if (/^\.env(\.|$)/i.test(base)) return "env";
  const m = base.match(/\.([a-z0-9]+)$/i);
  return m ? m[1].toLowerCase() : "";
}

function highlightCode(code: string, language?: string): string {
  const lang = language && hljs.getLanguage(language) ? language : "";
  try {
    if (lang) {
      return hljs.highlight(code, { language: lang, ignoreIllegals: true }).value;
    }
    return hljs.highlightAuto(code).value;
  } catch {
    return escapeHtml(code);
  }
}

function codeBlockHtml(code: string, language?: string): string {
  const langClass = language ? ` language-${escapeHtml(language)}` : "";
  const highlighted = highlightCode(code, language);
  return `<pre class="fmt-code hljs${langClass}"><code class="hljs${langClass}">${highlighted}</code></pre>`;
}

/** Sanitize HTML from marked; allow common markdown tags + code classes. */
function sanitizeHtml(dirty: string): string {
  return DOMPurify.sanitize(dirty, {
    USE_PROFILES: { html: true },
    ADD_ATTR: ["class", "target", "rel"],
  });
}

/**
 * CommonMark emphasis flanking fails for CJK punctuation, e.g.
 * `是**「标题」**混合` leaves literal asterisks. Insert spaces around
 * `**` / `__` pairs only when opener/closer would otherwise not flank.
 * Leaves fenced code blocks untouched.
 */
function preprocessCjkEmphasis(source: string): string {
  const parts = source.split(/(```[\s\S]*?```)/g);
  return parts
    .map((part) => {
      if (part.startsWith("```")) return part;
      return part.replace(
        /(\*\*|__)([^\n]+?)\1/g,
        (full, delim: string, inner: string, offset: number, str: string) => {
          const before = offset > 0 ? str[offset - 1] : "";
          const afterIdx = offset + full.length;
          const after = afterIdx < str.length ? str[afterIdx] : "";
          const first = inner[0];
          const last = inner[inner.length - 1];

          const openerNeedsSpace =
            Boolean(before) &&
            !/\s/.test(before) &&
            Boolean(first) &&
            /\p{P}/u.test(first) &&
            first !== "*" &&
            first !== "_";

          const closerNeedsSpace =
            Boolean(after) &&
            !/\s/.test(after) &&
            !/\p{P}/u.test(after) &&
            Boolean(last) &&
            /\p{P}/u.test(last) &&
            last !== "*" &&
            last !== "_";

          if (!openerNeedsSpace && !closerNeedsSpace) return full;
          return `${openerNeedsSpace ? " " : ""}${delim}${inner}${delim}${
            closerNeedsSpace ? " " : ""
          }`;
        },
      );
    })
    .join("");
}

export function renderMarkdown(source: string): string {
  const prepared = preprocessCjkEmphasis(source || "");
  const raw = marked.parse(prepared, { async: false }) as string;
  return `<div class="fmt-md">${sanitizeHtml(raw)}</div>`;
}

/** Lightweight markdown for short summary / detail lines. */
export function renderMarkdownInlineBlock(source: string): string {
  const text = (source || "").trim();
  if (!text) return "";
  // Multi-line or clearly markdown → full renderer
  if (
    text.includes("\n") ||
    /^#{1,6}\s/m.test(text) ||
    /^[-*+]\s/m.test(text) ||
    /^\d+\.\s/m.test(text) ||
    /```/.test(text) ||
    /\|.+\|/.test(text) ||
    /\*\*[^*\n]+\*\*/.test(text) ||
    /__[^_\n]+__/.test(text)
  ) {
    return renderMarkdown(text);
  }
  // Short single-line: still allow **bold**, `code`, links
  const prepared = preprocessCjkEmphasis(text);
  const raw = marked.parseInline(prepared, { async: false }) as string;
  return `<div class="fmt-md fmt-md-inline">${sanitizeHtml(raw)}</div>`;
}

function tryPrettyJson(content: string): string | null {
  const t = content.trim();
  if (!t) return null;
  try {
    if (t.startsWith("{") || t.startsWith("[")) {
      return JSON.stringify(JSON.parse(t), null, 2);
    }
  } catch {
    /* not json */
  }
  // JSON Lines
  if (t.includes("\n") && (t.startsWith("{") || t.includes("\n{"))) {
    const lines = t.split("\n").filter((l) => l.trim());
    if (lines.length < 2) return null;
    try {
      const objs = lines.map((l) => JSON.parse(l));
      return objs.map((o) => JSON.stringify(o)).join("\n");
    } catch {
      return null;
    }
  }
  return null;
}

function looksLikeDiff(content: string): boolean {
  const lines = content.split("\n").slice(0, 40);
  let hits = 0;
  for (const line of lines) {
    if (
      /^(diff --git |index [0-9a-f]+\.\.|--- |\+\+\+ |@@ |new file mode |deleted file mode )/i.test(
        line,
      )
    ) {
      hits += 1;
    }
  }
  return hits >= 2;
}

function looksLikeMarkdown(content: string): boolean {
  const t = content.trim();
  if (!t) return false;
  const signals = [
    /^#{1,6}\s.+/m,
    /^\s*[-*+]\s.+/m,
    /^\s*\d+\.\s.+/m,
    /```[\s\S]+```/,
    /\[[^\]]+\]\([^)]+\)/,
    /^\|.+\|$/m,
    /^\s*>\s.+/m,
  ];
  let hits = 0;
  for (const re of signals) {
    if (re.test(t)) hits += 1;
  }
  // Research-style .txt reports often only use **bold** / __bold__.
  const hasEmphasis =
    /\*\*[^*\n]{1,800}\*\*/.test(t) || /__[^_\n]{1,800}__/.test(t);
  if (hasEmphasis) hits += 1;
  return hits >= 2 || hasEmphasis;
}

/** Parse simple CSV/TSV into a table. Handles quoted fields. */
function parseDelimited(content: string, delimiter: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let i = 0;
  let inQuotes = false;
  const s = content.replace(/^\uFEFF/, "");
  while (i < s.length) {
    const ch = s[i];
    if (inQuotes) {
      if (ch === '"') {
        if (s[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i += 1;
        continue;
      }
      field += ch;
      i += 1;
      continue;
    }
    if (ch === '"') {
      inQuotes = true;
      i += 1;
      continue;
    }
    if (ch === delimiter) {
      row.push(field);
      field = "";
      i += 1;
      continue;
    }
    if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && s[i + 1] === "\n") i += 1;
      row.push(field);
      field = "";
      // skip trailing empty line
      if (row.length > 1 || row[0] !== "") rows.push(row);
      row = [];
      i += 1;
      continue;
    }
    field += ch;
    i += 1;
  }
  if (field.length || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

function tableHtml(rows: string[][], maxRows = 200): string {
  if (!rows.length) {
    return `<div class="fmt-empty">空表格</div>`;
  }
  const header = rows[0];
  const body = rows.slice(1, maxRows + 1);
  const truncated = rows.length - 1 > maxRows;
  const th = header
    .map((c) => `<th>${escapeHtml(c)}</th>`)
    .join("");
  const trs = body
    .map(
      (r) =>
        `<tr>${header
          .map((_, idx) => `<td>${escapeHtml(r[idx] ?? "")}</td>`)
          .join("")}</tr>`,
    )
    .join("");
  const note = truncated
    ? `<div class="fmt-meta">仅显示前 ${maxRows} 行（共 ${rows.length - 1} 行数据）</div>`
    : "";
  return `<div class="fmt-table-wrap">${note}<table class="fmt-table"><thead><tr>${th}</tr></thead><tbody>${trs}</tbody></table></div>`;
}

export function detectContentKind(
  content: string,
  pathHint?: string | null,
): { kind: ContentKind; language?: string } {
  const ext = pathHint ? fileExt(pathHint) : "";
  const mapped = ext ? EXT_LANG[ext] : "";

  if (mapped === "markdown") return { kind: "markdown", language: "markdown" };
  if (mapped === "csv") return { kind: "csv", language: "csv" };
  if (mapped === "tsv") return { kind: "tsv", language: "tsv" };
  if (mapped === "diff") return { kind: "diff", language: "diff" };
  if (mapped === "json") return { kind: "json", language: "json" };
  if (mapped === "html") return { kind: "html", language: "xml" };
  if (mapped && mapped !== "plaintext") {
    return { kind: "code", language: mapped };
  }

  // Content sniffing when extension is missing/generic
  if (looksLikeDiff(content)) return { kind: "diff", language: "diff" };
  const pretty = tryPrettyJson(content);
  if (pretty !== null) return { kind: "json", language: "json" };
  if (looksLikeMarkdown(content)) return { kind: "markdown", language: "markdown" };

  return { kind: "text", language: mapped || "plaintext" };
}

/**
 * Format arbitrary text content for rich preview.
 * @param content raw file / report text
 * @param pathHint optional path or filename for extension detection
 */
export function formatContent(
  content: string,
  pathHint?: string | null,
): FormattedContent {
  const text = content ?? "";
  const detected = detectContentKind(text, pathHint);
  const { kind, language } = detected;

  switch (kind) {
    case "markdown":
      return { kind, language, html: renderMarkdown(text) };
    case "json": {
      const pretty = tryPrettyJson(text) ?? text;
      return {
        kind,
        language: "json",
        html: codeBlockHtml(pretty, "json"),
      };
    }
    case "diff":
      return {
        kind,
        language: "diff",
        html: codeBlockHtml(text, "diff"),
      };
    case "csv":
      return {
        kind,
        language: "csv",
        html: tableHtml(parseDelimited(text, ",")),
      };
    case "tsv":
      return {
        kind,
        language: "tsv",
        html: tableHtml(parseDelimited(text, "\t")),
      };
    case "html":
      return {
        kind,
        language: "xml",
        html: codeBlockHtml(text, "xml"),
      };
    case "code":
      return {
        kind,
        language,
        html: codeBlockHtml(text, language),
      };
    case "text":
    default: {
      // Prefer highlight auto for non-empty multi-line text
      if (text.trim().length > 0 && language && language !== "plaintext") {
        return {
          kind: "code",
          language,
          html: codeBlockHtml(text, language),
        };
      }
      return {
        kind: "text",
        language: "plaintext",
        html: codeBlockHtml(text, "plaintext"),
      };
    }
  }
}

/** Convenience: write formatted HTML into an element. */
export function setFormattedContent(
  el: HTMLElement | null,
  content: string,
  pathHint?: string | null,
): FormattedContent | null {
  if (!el) return null;
  const formatted = formatContent(content, pathHint);
  el.classList.add("fmt-host");
  el.dataset.fmtKind = formatted.kind;
  if (formatted.language) el.dataset.fmtLang = formatted.language;
  el.innerHTML = formatted.html;
  return formatted;
}
