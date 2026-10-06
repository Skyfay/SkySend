/** The languages a code block can be set to. "auto" detects it when the note is shown. */
export const CODE_LANGUAGES = [
  { value: "auto", label: "Auto Detect" },
  // Web & scripting
  { value: "javascript", label: "JavaScript" },
  { value: "typescript", label: "TypeScript" },
  { value: "python", label: "Python" },
  { value: "php", label: "PHP" },
  { value: "ruby", label: "Ruby" },
  { value: "lua", label: "Lua" },
  { value: "perl", label: "Perl" },
  { value: "r", label: "R" },
  // Systems & compiled
  { value: "java", label: "Java" },
  { value: "csharp", label: "C#" },
  { value: "cpp", label: "C++" },
  { value: "c", label: "C" },
  { value: "go", label: "Go" },
  { value: "rust", label: "Rust" },
  { value: "swift", label: "Swift" },
  { value: "kotlin", label: "Kotlin" },
  { value: "scala", label: "Scala" },
  { value: "dart", label: "Dart" },
  { value: "haskell", label: "Haskell" },
  { value: "elixir", label: "Elixir" },
  { value: "erlang", label: "Erlang" },
  { value: "fsharp", label: "F#" },
  // Shell & scripting
  { value: "bash", label: "Bash" },
  { value: "shell", label: "Shell" },
  { value: "powershell", label: "PowerShell" },
  // Data & config
  { value: "sql", label: "SQL" },
  { value: "json", label: "JSON" },
  { value: "yaml", label: "YAML" },
  { value: "xml", label: "XML" },
  { value: "ini", label: "INI" },
  { value: "toml", label: "TOML" },
  { value: "protobuf", label: "Protocol Buffers" },
  { value: "graphql", label: "GraphQL" },
  { value: "diff", label: "Diff" },
  // Web & styles
  { value: "css", label: "CSS" },
  { value: "scss", label: "SCSS" },
  // Infrastructure
  { value: "dockerfile", label: "Dockerfile" },
  { value: "nginx", label: "Nginx" },
  { value: "nix", label: "Nix" },
  { value: "makefile", label: "Makefile" },
  // Markup & docs
  { value: "markdown", label: "Markdown" },
  { value: "http", label: "HTTP" },
  // Editor
  { value: "vim", label: "Vim Script" },
  { value: "plaintext", label: "Plain Text" },
] as const;

const LABELS: Record<string, string> = Object.fromEntries(CODE_LANGUAGES.map((l) => [l.value, l.label]));

/** The display name of a highlight.js language, or the name itself if it is not in the list. */
export function languageLabel(language: string): string {
  return LABELS[language] ?? language;
}
