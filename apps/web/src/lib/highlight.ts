import DOMPurify from "dompurify";
import type { ReadBlock } from "@skysend/note-format";
import hljs from "highlight.js/lib/core";

// Register languages
import javascript from "highlight.js/lib/languages/javascript";
import typescript from "highlight.js/lib/languages/typescript";
import python from "highlight.js/lib/languages/python";
import php from "highlight.js/lib/languages/php";
import ruby from "highlight.js/lib/languages/ruby";
import lua from "highlight.js/lib/languages/lua";
import perl from "highlight.js/lib/languages/perl";
import r from "highlight.js/lib/languages/r";
import java from "highlight.js/lib/languages/java";
import csharp from "highlight.js/lib/languages/csharp";
import cpp from "highlight.js/lib/languages/cpp";
import c from "highlight.js/lib/languages/c";
import go from "highlight.js/lib/languages/go";
import rust from "highlight.js/lib/languages/rust";
import swift from "highlight.js/lib/languages/swift";
import kotlin from "highlight.js/lib/languages/kotlin";
import scala from "highlight.js/lib/languages/scala";
import dart from "highlight.js/lib/languages/dart";
import haskell from "highlight.js/lib/languages/haskell";
import elixir from "highlight.js/lib/languages/elixir";
import erlang from "highlight.js/lib/languages/erlang";
import fsharp from "highlight.js/lib/languages/fsharp";
import bash from "highlight.js/lib/languages/bash";
import shell from "highlight.js/lib/languages/shell";
import powershell from "highlight.js/lib/languages/powershell";
import sql from "highlight.js/lib/languages/sql";
import json from "highlight.js/lib/languages/json";
import yaml from "highlight.js/lib/languages/yaml";
import xml from "highlight.js/lib/languages/xml";
import ini from "highlight.js/lib/languages/ini";
import protobuf from "highlight.js/lib/languages/protobuf";
import graphql from "highlight.js/lib/languages/graphql";
import diff from "highlight.js/lib/languages/diff";
import css from "highlight.js/lib/languages/css";
import scss from "highlight.js/lib/languages/scss";
import docker from "highlight.js/lib/languages/dockerfile";
import nginx from "highlight.js/lib/languages/nginx";
import nix from "highlight.js/lib/languages/nix";
import makefile from "highlight.js/lib/languages/makefile";
import markdown from "highlight.js/lib/languages/markdown";
import http from "highlight.js/lib/languages/http";
import vim from "highlight.js/lib/languages/vim";
import plaintext from "highlight.js/lib/languages/plaintext";

hljs.registerLanguage("javascript", javascript);
hljs.registerLanguage("typescript", typescript);
hljs.registerLanguage("python", python);
hljs.registerLanguage("php", php);
hljs.registerLanguage("ruby", ruby);
hljs.registerLanguage("lua", lua);
hljs.registerLanguage("perl", perl);
hljs.registerLanguage("r", r);
hljs.registerLanguage("java", java);
hljs.registerLanguage("csharp", csharp);
hljs.registerLanguage("cpp", cpp);
hljs.registerLanguage("c", c);
hljs.registerLanguage("go", go);
hljs.registerLanguage("rust", rust);
hljs.registerLanguage("swift", swift);
hljs.registerLanguage("kotlin", kotlin);
hljs.registerLanguage("scala", scala);
hljs.registerLanguage("dart", dart);
hljs.registerLanguage("haskell", haskell);
hljs.registerLanguage("elixir", elixir);
hljs.registerLanguage("erlang", erlang);
hljs.registerLanguage("fsharp", fsharp);
hljs.registerLanguage("bash", bash);
hljs.registerLanguage("shell", shell);
hljs.registerLanguage("powershell", powershell);
hljs.registerLanguage("sql", sql);
hljs.registerLanguage("json", json);
hljs.registerLanguage("yaml", yaml);
hljs.registerLanguage("xml", xml);
hljs.registerLanguage("ini", ini);
hljs.registerLanguage("toml", ini); // toml is handled by the ini grammar
hljs.registerLanguage("protobuf", protobuf);
hljs.registerLanguage("graphql", graphql);
hljs.registerLanguage("diff", diff);
hljs.registerLanguage("css", css);
hljs.registerLanguage("scss", scss);
hljs.registerLanguage("dockerfile", docker);
hljs.registerLanguage("nginx", nginx);
hljs.registerLanguage("nix", nix);
hljs.registerLanguage("makefile", makefile);
hljs.registerLanguage("markdown", markdown);
hljs.registerLanguage("http", http);
hljs.registerLanguage("vim", vim);
hljs.registerLanguage("plaintext", plaintext);

// Defense in depth on top of the HTML escaping of highlight.js: the markup that reaches
// dangerouslySetInnerHTML can only ever hold span elements with a class.
const SAFE_HTML = { ALLOWED_TAGS: ["span"], ALLOWED_ATTR: ["class"] };

/**
 * highlight.js takes quadratic time on crafted input: 64KB of quotes keeps it busy for 15
 * seconds, on the recipient's main thread. Code above this length is shown without
 * highlighting, and a note gets HIGHLIGHT_BUDGET characters in total.
 */
export const MAX_HIGHLIGHT_LENGTH = 16 * 1024;
export const HIGHLIGHT_BUDGET = 32 * 1024;

function escapeHtml(code: string): string {
  return code.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** Highlights code as a known language. Returns null if highlight.js does not know it. */
export function highlightAs(code: string, language: string): string | null {
  if (code.length > MAX_HIGHLIGHT_LENGTH) return null;
  try {
    return DOMPurify.sanitize(hljs.highlight(code, { language }).value, SAFE_HTML);
  } catch {
    return null;
  }
}

/**
 * Highlights the code of a code block. "auto", or a language highlight.js does not know,
 * detects the language instead. Returns the language the block is shown as. Without
 * `highlight`, or above MAX_HIGHLIGHT_LENGTH, the code comes back escaped and plain.
 */
export function highlightCode(
  code: string,
  language: string,
  highlight = true,
): { html: string; language: string } {
  if (!highlight || code.length > MAX_HIGHLIGHT_LENGTH) {
    return { html: escapeHtml(code), language: language === "auto" ? "plaintext" : language };
  }
  const known = language === "auto" ? null : highlightAs(code, language);
  if (known !== null) return { html: known, language };
  const detected = hljs.highlightAuto(code);
  return {
    html: DOMPurify.sanitize(detected.value, SAFE_HTML),
    language: language === "auto" ? (detected.language ?? "plaintext") : language,
  };
}

/**
 * Which blocks of a note get syntax highlighting. Each block above MAX_HIGHLIGHT_LENGTH goes
 * without, and so does every block once the note has used up HIGHLIGHT_BUDGET.
 */
export function highlightedBlocks(blocks: readonly ReadBlock[]): boolean[] {
  let budget = HIGHLIGHT_BUDGET;
  return blocks.map((block) => {
    const size =
      block.type === "code" ? block.code.length : block.type === "text" && block.format === "markdown" ? block.text.length : 0;
    if (size === 0 || size > MAX_HIGHLIGHT_LENGTH || size > budget) return false;
    budget -= size;
    return true;
  });
}
