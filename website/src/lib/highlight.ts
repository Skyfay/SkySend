import { codeToHtml } from "shiki";

export async function highlightCode(code: string, lang: string) {
  return codeToHtml(code, {
    lang,
    themes: { light: "github-light-default", dark: "github-dark-default" },
    defaultColor: false,
    structure: "inline",
  });
}
