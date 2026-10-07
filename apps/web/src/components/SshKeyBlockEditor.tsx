import { useId, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { Check, ClipboardPaste, Copy, Eye, EyeOff, KeyRound, Loader2, RefreshCw, Terminal, Wand2 } from "lucide-react";
import type { SshKeyBlock } from "@skysend/note-format";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { BlockEditorFrame, IconButton } from "@/components/BlockEditorFrame";
import { copyText } from "@/lib/clipboard";
import type { EditorMode } from "@/lib/note-editor";
import { Ed25519UnsupportedError, generateEd25519KeyPair, generateRSAKeyPair, type SSHKeyPair } from "@/lib/ssh-keygen";
import { showKnownErrorToast } from "@/lib/toast";
import { cn } from "@/lib/utils";

type Mode = "generate" | "paste";
type Algorithm = "ed25519" | "rsa";
type RSABits = 1024 | 2048 | 4096;
type Part = "public" | "private" | "passphrase";

const EMPTY: SshKeyBlock = { type: "sshkey", publicKey: "", privateKey: "", passphrase: "" };

/** The block for a generated pair: the parts chosen to share, nothing else. */
function fromPair(pair: SSHKeyPair, parts: readonly Part[], passphrase: string): SshKeyBlock {
  return {
    type: "sshkey",
    publicKey: parts.includes("public") ? pair.publicKey : "",
    privateKey: parts.includes("private") ? pair.privateKey : "",
    passphrase: parts.includes("passphrase") && passphrase ? passphrase : "",
  };
}

interface SshKeyBlockEditorProps {
  block: SshKeyBlock;
  onChange: (block: SshKeyBlock) => void;
  controls: ReactNode;
  disabled: boolean;
  /** A template asks for a key and holds none, filling it in works like writing a note. */
  mode?: EditorMode;
}

/**
 * An SSH key pair, generated in the browser or pasted. The block only holds what goes into
 * the note. The settings of the generator stay in this editor.
 */
export function SshKeyBlockEditor({ block, onChange, controls, disabled, mode: editorMode = "compose" }: SshKeyBlockEditorProps) {
  const { t } = useTranslation();
  const id = useId();
  const [mode, setMode] = useState<Mode>("generate");
  const [algorithm, setAlgorithm] = useState<Algorithm>("ed25519");
  const [rsaBits, setRsaBits] = useState<RSABits>(4096);
  const [comment, setComment] = useState("");
  const [passphrase, setPassphrase] = useState("");
  const [showPassphrase, setShowPassphrase] = useState(false);
  const [keyPair, setKeyPair] = useState<SSHKeyPair | null>(null);
  const [generating, setGenerating] = useState(false);
  // Someone filling in a request is asked for a key, and the public half is what grants access.
  // Sending a fresh private key to a stranger has to be a choice, not the default.
  const [parts, setParts] = useState<Part[]>(
    editorMode === "fill" ? ["public"] : ["public", "private", "passphrase"],
  );
  const [copied, setCopied] = useState<"public" | "private" | null>(null);

  const generate = async () => {
    setGenerating(true);
    try {
      const pair =
        algorithm === "ed25519"
          ? await generateEd25519KeyPair(comment || undefined, passphrase || undefined)
          : await generateRSAKeyPair(rsaBits, comment || undefined, passphrase || undefined);
      setKeyPair(pair);
      onChange(fromPair(pair, parts, passphrase));
      if (pair.extrasDropped) toast.warning(t("sshKey.extrasDropped"));
    } catch (err) {
      if (err instanceof Ed25519UnsupportedError) toast.error(t("sshKey.ed25519Unsupported"));
      else showKnownErrorToast(err instanceof Error ? err.message : t("sshKey.generateFailed"));
    } finally {
      setGenerating(false);
    }
  };

  const discardPair = () => {
    setKeyPair(null);
    onChange(EMPTY);
  };

  const copy = async (which: "public" | "private", text: string) => {
    await copyText(text);
    setCopied(which);
    setTimeout(() => setCopied((current) => (current === which ? null : current)), 2000);
  };

  const keyTextarea = "resize-y rounded-xl border-0 bg-transparent px-3 font-mono text-sm shadow-none placeholder:font-sans focus-visible:ring-0";

  if (editorMode === "template") {
    return (
      <BlockEditorFrame icon={Terminal} title={t("tab.sshkey")} controls={controls}>
        <p className="p-3 text-xs text-muted-foreground">{t("template.sshKeyHint")}</p>
      </BlockEditorFrame>
    );
  }

  return (
    <BlockEditorFrame
      icon={Terminal}
      title={t("tab.sshkey")}
      controls={controls}
      toolbar={
        <ToggleGroup
          variant="segmented"
          type="single"
          value={mode}
          onValueChange={(v) => {
            if (v !== "generate" && v !== "paste") return;
            setMode(v);
            setKeyPair(null);
            onChange(EMPTY);
          }}
          aria-label={t("share.sshMode")}
          disabled={disabled}
        >
          <ToggleGroupItem value="generate">
            <Wand2 />
            {t("sshKey.modeGenerate")}
          </ToggleGroupItem>
          <ToggleGroupItem value="paste">
            <ClipboardPaste />
            {t("sshKey.modePaste")}
          </ToggleGroupItem>
        </ToggleGroup>
      }
    >
      {mode === "paste" && (
        <>
          <div className="px-4 pt-3">
            <Label htmlFor={`${id}-public`} className="text-[13px]">{t("sshKey.publicKey")}</Label>
          </div>
          <div className="p-1.5">
            <Textarea
              id={`${id}-public`}
              value={block.publicKey}
              onChange={(e) => onChange({ ...block, publicKey: e.target.value, passphrase: "" })}
              placeholder={t("sshKey.pastePlaceholderPublic")}
              className={cn(keyTextarea, "min-h-20")}
              disabled={disabled}
              spellCheck={false}
            />
          </div>
          <div className="border-t border-border px-4 pt-3">
            <Label htmlFor={`${id}-private`} className="text-[13px]">{t("sshKey.privateKey")}</Label>
          </div>
          <div className="p-1.5">
            <Textarea
              id={`${id}-private`}
              value={block.privateKey}
              onChange={(e) => onChange({ ...block, privateKey: e.target.value, passphrase: "" })}
              placeholder={t("sshKey.pastePlaceholderPrivate")}
              className={cn(keyTextarea, "min-h-32")}
              disabled={disabled}
              spellCheck={false}
            />
          </div>
        </>
      )}

      {mode === "generate" && !keyPair && (
        <div className="space-y-4 p-4 sm:p-5">
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
            <span className="w-24 text-[13px] font-medium">{t("sshKey.algorithm")}</span>
            <ToggleGroup
              variant="segmented"
              type="single"
              value={algorithm}
              onValueChange={(v) => (v === "ed25519" || v === "rsa") && setAlgorithm(v)}
              aria-label={t("sshKey.algorithm")}
              disabled={disabled || generating}
            >
              <ToggleGroupItem value="ed25519">Ed25519</ToggleGroupItem>
              <ToggleGroupItem value="rsa">RSA</ToggleGroupItem>
            </ToggleGroup>
          </div>

          {algorithm === "rsa" && (
            <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
              <span className="w-24 text-[13px] font-medium">{t("sshKey.keySize")}</span>
              <ToggleGroup
                type="single"
                value={String(rsaBits)}
                onValueChange={(v) => v && setRsaBits(parseInt(v, 10) as RSABits)}
                aria-label={t("sshKey.keySize")}
                disabled={disabled || generating}
              >
                {[1024, 2048, 4096].map((bits) => (
                  <ToggleGroupItem key={bits} value={String(bits)}>
                    {bits} bit
                  </ToggleGroupItem>
                ))}
              </ToggleGroup>
            </div>
          )}

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor={`${id}-comment`} className="text-[13px]">{t("sshKey.comment")}</Label>
              <Input
                id={`${id}-comment`}
                value={comment}
                onChange={(e) => setComment(e.target.value)}
                placeholder={t("sshKey.commentPlaceholder")}
                disabled={disabled || generating}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor={`${id}-passphrase`} className="text-[13px]">{t("sshKey.passphrase")}</Label>
              <div className="relative">
                <Input
                  id={`${id}-passphrase`}
                  type={showPassphrase ? "text" : "password"}
                  value={passphrase}
                  onChange={(e) => setPassphrase(e.target.value)}
                  placeholder={t("sshKey.passphrasePlaceholder")}
                  autoComplete="off"
                  disabled={disabled || generating}
                  className="pr-10"
                />
                <button
                  type="button"
                  className="absolute right-1.5 top-1/2 inline-flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                  onClick={() => setShowPassphrase(!showPassphrase)}
                  aria-label={showPassphrase ? t("share.hidePassword") : t("share.showPassword")}
                >
                  {showPassphrase ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
            </div>
          </div>
          <p className="text-xs leading-relaxed text-muted-foreground">{t("sshKey.passphraseHint")}</p>

          <Button type="button" variant="outline" onClick={() => void generate()} disabled={disabled || generating}>
            {generating ? <Loader2 className="animate-spin" /> : <KeyRound />}
            {generating ? t("sshKey.generating") : t("sshKey.generate")}
          </Button>
        </div>
      )}

      {mode === "generate" && keyPair && (
        <>
          <div className="flex items-center gap-3 border-b border-border p-3 pl-4">
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold">{keyPair.algorithm === "ed25519" ? "Ed25519" : `RSA-${rsaBits}`}</p>
              <p className="break-all font-mono text-[11px] text-muted-foreground">{keyPair.fingerprint}</p>
            </div>
            <IconButton variant="ghost" label={t("share.sshRegenerate")} onClick={discardPair} disabled={disabled}>
              <RefreshCw />
            </IconButton>
          </div>

          {(["public", "private"] as const).map((which) => {
            const value = which === "public" ? keyPair.publicKey : keyPair.privateKey;
            return (
              <div key={which} className="space-y-2 border-b border-border p-3 pl-4">
                <div className="flex items-center justify-between">
                  <span className="text-[13px] font-medium">{which === "public" ? t("sshKey.publicKey") : t("sshKey.privateKey")}</span>
                  <Button type="button" variant="ghost" size="sm" className="h-7 px-2 text-xs" onClick={() => void copy(which, value)}>
                    {copied === which ? <Check className="text-primary-text" /> : <Copy />}
                    {copied === which ? t("common.copied") : t("common.copy")}
                  </Button>
                </div>
                <pre
                  className={cn(
                    "scrollbar-thin overflow-auto rounded-xl border border-border bg-card p-3 font-mono text-xs",
                    which === "public" ? "whitespace-pre-wrap break-all" : "max-h-40",
                  )}
                >
                  {value}
                </pre>
              </div>
            );
          })}

          <div className="flex flex-col gap-2 p-3 pl-4 sm:flex-row sm:items-center sm:gap-4">
            <span className="text-[13px] font-medium sm:w-32 sm:shrink-0">{t("sshKey.shareAs")}</span>
            <ToggleGroup
              type="multiple"
              value={parts}
              onValueChange={(value) => {
                const next = value.filter((part): part is Part => part === "public" || part === "private" || part === "passphrase");
                setParts(next);
                onChange(fromPair(keyPair, next, passphrase));
              }}
              aria-label={t("sshKey.shareAs")}
              disabled={disabled}
            >
              <ToggleGroupItem value="public">
                {parts.includes("public") && <Check />}
                {t("sshKey.publicKey")}
              </ToggleGroupItem>
              <ToggleGroupItem value="private">
                {parts.includes("private") && <Check />}
                {t("sshKey.privateKey")}
              </ToggleGroupItem>
              {passphrase && (
                <ToggleGroupItem value="passphrase">
                  {parts.includes("passphrase") && <Check />}
                  {t("sshKey.passphrase")}
                </ToggleGroupItem>
              )}
            </ToggleGroup>
          </div>
        </>
      )}
    </BlockEditorFrame>
  );
}
