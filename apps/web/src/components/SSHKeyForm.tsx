import { useState, useCallback, useEffect } from "react";
import { useTranslation } from "react-i18next";
import {
  Eye,
  EyeOff,
  Send,
  Loader2,
  KeyRound,
  Copy,
  Check,
  RefreshCw,
  Wand2,
  ClipboardPaste,
} from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { ShareLink } from "@/components/ShareLink";
import { ShareOptions } from "@/components/ShareOptions";
import { ShareFooter } from "@/components/ShareFooter";
import { useNoteUpload } from "@/hooks/useNoteUpload";
import { useServerConfig } from "@/hooks/useServerConfig";
import { toast } from "sonner";
import { showKnownErrorToast } from "@/lib/toast";
import { cn, formatBytes } from "@/lib/utils";
import {
  generateEd25519KeyPair,
  generateRSAKeyPair,
  type SSHKeyPair,
} from "@/lib/ssh-keygen";

type Mode = "paste" | "generate";
type Algorithm = "ed25519" | "rsa";
type RSABits = 1024 | 2048 | 4096;

export function SSHKeyForm({ forcePassword = false }: { forcePassword?: boolean }) {
  const { t } = useTranslation();
  const { config } = useServerConfig();
  const noteHook = useNoteUpload();

  // Mode toggle
  const [mode, setMode] = useState<Mode>("generate");

  // Paste mode
  const [pastePublicKey, setPastePublicKey] = useState("");
  const [pastePrivateKey, setPastePrivateKey] = useState("");

  // Generate config
  const [algorithm, setAlgorithm] = useState<Algorithm>("ed25519");
  const [rsaBits, setRsaBits] = useState<RSABits>(4096);
  const [comment, setComment] = useState("");
  const [passphrase, setPassphrase] = useState("");
  const [showPassphrase, setShowPassphrase] = useState(false);

  // Generated keys
  const [keyPair, setKeyPair] = useState<SSHKeyPair | null>(null);
  const [generating, setGenerating] = useState(false);

  // Share settings (used by both modes)
  const [sharePublicKey, setSharePublicKey] = useState(true);
  const [sharePrivateKey, setSharePrivateKey] = useState(true);
  const [sharePassphrase, setSharePassphrase] = useState(true);
  const [expireSec, setExpireSec] = useState<number | null>(null);
  const [maxViews, setMaxViews] = useState<number | null>(null);
  const [notePassword, setNotePassword] = useState("");
  const [notePasswordEnabled, setNotePasswordEnabled] = useState(forcePassword);

  // Copy state
  const [copiedPublic, setCopiedPublic] = useState(false);
  const [copiedPrivate, setCopiedPrivate] = useState(false);

  const copyText = useCallback(
    async (text: string, setCopied: (v: boolean) => void) => {
      try {
        await navigator.clipboard.writeText(text);
      } catch {
        const ta = document.createElement("textarea");
        ta.value = text;
        document.body.appendChild(ta);
        ta.select();
        document.execCommand("copy");
        ta.remove();
      }
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    },
    [],
  );

  // Show note upload errors via toast
  useEffect(() => {
    if (noteHook.phase === "error" && noteHook.error) {
      showKnownErrorToast(noteHook.error);
    }
  }, [noteHook.phase, noteHook.error]);

  if (!config) return null;

  const effectiveExpireSec = expireSec ?? config.noteDefaultExpire;
  const effectiveMaxViews = maxViews ?? config.noteDefaultViews;

  const isSubmitting =
    noteHook.phase === "encrypting" || noteHook.phase === "uploading";

  // --- Generate mode handlers ---

  const handleGenerate = async () => {
    setGenerating(true);
    try {
      const pair =
        algorithm === "ed25519"
          ? await generateEd25519KeyPair(
              comment || undefined,
              passphrase || undefined,
            )
          : await generateRSAKeyPair(
              rsaBits,
              comment || undefined,
              passphrase || undefined,
            );
      setKeyPair(pair);
      if (pair.warning) {
        toast.warning(pair.warning);
      }
    } catch (err) {
      showKnownErrorToast(err instanceof Error ? err.message : "Key generation failed");
    } finally {
      setGenerating(false);
    }
  };

  const handleRegenerate = () => {
    setKeyPair(null);
  };

  // --- Content for note upload ---

  const getSubmitContent = (): string => {
    if (mode === "paste") {
      const parts = [pastePublicKey.trim(), pastePrivateKey.trim()].filter(Boolean);
      return parts.join("\n\n");
    }
    if (!keyPair) return "";
    const parts: string[] = [];
    if (sharePublicKey) parts.push(keyPair.publicKey);
    if (sharePrivateKey) parts.push(keyPair.privateKey);
    if (sharePassphrase && passphrase) parts.push(`Passphrase: ${passphrase}`);
    return parts.join("\n\n");
  };

  const pasteContent = mode === "paste"
    ? [pastePublicKey.trim(), pastePrivateKey.trim()].filter(Boolean).join("\n\n")
    : "";

  const canSubmit =
    mode === "paste"
      ? (pastePublicKey.trim().length > 0 || pastePrivateKey.trim().length > 0) &&
        new TextEncoder().encode(pasteContent).length <= config.noteMaxSize
      : keyPair !== null && (sharePublicKey || sharePrivateKey || (sharePassphrase && !!passphrase));

  const handleSubmit = () => {
    const content = getSubmitContent();
    if (!content) return;
    noteHook.upload({
      content,
      contentType: "sshkey",
      maxViews: effectiveMaxViews,
      expireSec: effectiveExpireSec,
      password: notePasswordEnabled ? notePassword : "",
    });
  };

  const handleNewNote = () => {
    noteHook.reset();
    setKeyPair(null);
    setPastePublicKey("");
    setPastePrivateKey("");
    setPassphrase("");
    setComment("");
    setNotePassword("");
    setNotePasswordEnabled(forcePassword);
    setSharePublicKey(true);
    setSharePrivateKey(true);
    setSharePassphrase(true);
  };

  if (noteHook.phase === "done" && noteHook.shareLink) {
    return <ShareLink link={noteHook.shareLink} onNewUpload={handleNewNote} />;
  }

  const pasteContentBytes = new TextEncoder().encode(pasteContent).length;
  const pasteSizeExceeded = pasteContentBytes > config.noteMaxSize;

  const shareParts = [
    sharePublicKey && "public",
    sharePrivateKey && "private",
    sharePassphrase && "passphrase",
  ].filter((v): v is string => Boolean(v));
  const editorBox =
    "rounded-[20px] border border-border bg-well transition-[border-color,box-shadow] focus-within:border-primary focus-within:ring-3 focus-within:ring-primary-soft";
  const keyTextarea =
    "resize-y rounded-xl border-0 bg-transparent px-3 font-mono text-sm shadow-none focus-visible:ring-0";

  const copyButton = (copied: boolean, onClick: () => void) => (
    <Button type="button" variant="ghost" size="sm" className="h-7 px-2 text-xs" onClick={onClick}>
      {copied ? <Check className="text-primary-text" /> : <Copy />}
      {copied ? t("common.copied") : t("common.copy")}
    </Button>
  );

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-2 px-2">
        <Label className="text-[13px]">{t("sshKey.pasteLabel")}</Label>
        <ToggleGroup
          variant="segmented"
          type="single"
          value={mode}
          onValueChange={(v) => {
            if (!v) return;
            setMode(v as Mode);
            setKeyPair(null);
          }}
          aria-label={t("share.sshMode")}
        >
          <ToggleGroupItem value="generate" disabled={isSubmitting}>
            <Wand2 />
            {t("sshKey.modeGenerate")}
          </ToggleGroupItem>
          <ToggleGroupItem value="paste" disabled={isSubmitting}>
            <ClipboardPaste />
            {t("sshKey.modePaste")}
          </ToggleGroupItem>
        </ToggleGroup>
      </div>

      {/* ====== PASTE MODE ====== */}
      {mode === "paste" && (
        <>
          <div className={editorBox}>
            <div className="border-b border-border px-4 py-2.5">
              <Label htmlFor="ssh-paste-public" className="text-[13px]">{t("sshKey.publicKey")}</Label>
            </div>
            <div className="p-1.5">
              <Textarea
                id="ssh-paste-public"
                value={pastePublicKey}
                onChange={(e) => setPastePublicKey(e.target.value)}
                placeholder={t("sshKey.pastePlaceholderPublic")}
                className={cn(keyTextarea, "min-h-20")}
                disabled={isSubmitting}
              />
            </div>
            <div className="border-y border-border px-4 py-2.5">
              <Label htmlFor="ssh-paste-private" className="text-[13px]">{t("sshKey.privateKey")}</Label>
            </div>
            <div className="p-1.5">
              <Textarea
                id="ssh-paste-private"
                value={pastePrivateKey}
                onChange={(e) => setPastePrivateKey(e.target.value)}
                placeholder={t("sshKey.pastePlaceholderPrivate")}
                className={cn(keyTextarea, "min-h-32")}
                disabled={isSubmitting}
              />
            </div>
            <div className="flex justify-end border-t border-border px-4 py-2">
              <span className={cn("font-mono text-[11px]", pasteSizeExceeded ? "text-destructive-text" : "text-muted-foreground")}>
                {formatBytes(pasteContentBytes)} / {formatBytes(config.noteMaxSize)}
              </span>
            </div>
          </div>
          {pasteSizeExceeded && (
            <p className="px-2 text-sm text-destructive-text" role="alert">
              {t("note.tooLarge", { size: formatBytes(config.noteMaxSize) })}
            </p>
          )}
        </>
      )}

      {/* ====== GENERATE MODE ====== */}
      {mode === "generate" && !keyPair && (
        <div className="space-y-4 rounded-[20px] border border-border bg-well p-4 sm:p-5">
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
            <Label className="w-24 text-[13px]">{t("sshKey.algorithm")}</Label>
            <ToggleGroup
              variant="segmented"
              type="single"
              value={algorithm}
              onValueChange={(v) => v && setAlgorithm(v as Algorithm)}
              aria-label={t("sshKey.algorithm")}
            >
              <ToggleGroupItem value="ed25519" disabled={generating}>Ed25519</ToggleGroupItem>
              <ToggleGroupItem value="rsa" disabled={generating}>RSA</ToggleGroupItem>
            </ToggleGroup>
          </div>

          {algorithm === "rsa" && (
            <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
              <Label className="w-24 text-[13px]">{t("sshKey.keySize")}</Label>
              <ToggleGroup
                type="single"
                value={String(rsaBits)}
                onValueChange={(v) => v && setRsaBits(parseInt(v, 10) as RSABits)}
                aria-label={t("sshKey.keySize")}
              >
                {[1024, 2048, 4096].map((bits) => (
                  <ToggleGroupItem key={bits} value={String(bits)} disabled={generating}>
                    {bits} bit
                  </ToggleGroupItem>
                ))}
              </ToggleGroup>
            </div>
          )}

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="ssh-comment" className="text-[13px]">{t("sshKey.comment")}</Label>
              <Input
                id="ssh-comment"
                value={comment}
                onChange={(e) => setComment(e.target.value)}
                placeholder={t("sshKey.commentPlaceholder")}
                disabled={generating}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="ssh-passphrase" className="text-[13px]">{t("sshKey.passphrase")}</Label>
              <div className="relative">
                <Input
                  id="ssh-passphrase"
                  type={showPassphrase ? "text" : "password"}
                  value={passphrase}
                  onChange={(e) => setPassphrase(e.target.value)}
                  placeholder={t("sshKey.passphrasePlaceholder")}
                  autoComplete="off"
                  disabled={generating}
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

          <Button onClick={handleGenerate} disabled={generating} className="w-full sm:w-auto">
            {generating ? <Loader2 className="animate-spin" /> : <KeyRound />}
            {generating ? t("sshKey.generating") : t("sshKey.generate")}
          </Button>
        </div>
      )}

      {/* ====== GENERATE MODE - KEY DISPLAY ====== */}
      {mode === "generate" && keyPair && (
        <>
          <div className="rounded-[20px] border border-border bg-well">
            <div className="flex items-center gap-3 border-b border-border p-3 pl-4">
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-primary-soft text-primary-text">
                <KeyRound className="h-4 w-4" />
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold">
                  {keyPair.algorithm === "ed25519" ? "Ed25519" : `RSA-${rsaBits}`}
                </p>
                <p className="break-all font-mono text-[11px] text-muted-foreground">{keyPair.fingerprint}</p>
              </div>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    onClick={handleRegenerate}
                    disabled={isSubmitting}
                    aria-label={t("share.sshRegenerate")}
                  >
                    <RefreshCw />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>{t("share.sshRegenerate")}</TooltipContent>
              </Tooltip>
            </div>

            <div className="space-y-2 p-3 pl-4">
              <div className="flex items-center justify-between">
                <Label className="text-[13px]">{t("sshKey.publicKey")}</Label>
                {copyButton(copiedPublic, () => copyText(keyPair.publicKey, setCopiedPublic))}
              </div>
              <pre className="scrollbar-thin overflow-x-auto whitespace-pre-wrap break-all rounded-xl border border-border bg-card p-3 font-mono text-xs">
                {keyPair.publicKey}
              </pre>
            </div>

            <div className="space-y-2 border-t border-border p-3 pl-4">
              <div className="flex items-center justify-between">
                <Label className="text-[13px]">{t("sshKey.privateKey")}</Label>
                {copyButton(copiedPrivate, () => copyText(keyPair.privateKey, setCopiedPrivate))}
              </div>
              <pre className="scrollbar-thin max-h-40 overflow-auto rounded-xl border border-border bg-card p-3 font-mono text-xs">
                {keyPair.privateKey}
              </pre>
            </div>
          </div>

          <div className="flex flex-col gap-2 px-2 sm:flex-row sm:items-center sm:gap-4">
            <Label className="text-[13px] sm:w-36 sm:shrink-0">{t("sshKey.shareAs")}</Label>
            <ToggleGroup
              type="multiple"
              value={shareParts}
              onValueChange={(v) => {
                setSharePublicKey(v.includes("public"));
                setSharePrivateKey(v.includes("private"));
                setSharePassphrase(v.includes("passphrase"));
              }}
              aria-label={t("sshKey.shareAs")}
            >
              <ToggleGroupItem value="public" disabled={isSubmitting}>
                {sharePublicKey && <Check />}
                {t("sshKey.publicKey")}
              </ToggleGroupItem>
              <ToggleGroupItem value="private" disabled={isSubmitting}>
                {sharePrivateKey && <Check />}
                {t("sshKey.privateKey")}
              </ToggleGroupItem>
              {passphrase && (
                <ToggleGroupItem value="passphrase" disabled={isSubmitting}>
                  {sharePassphrase && <Check />}
                  {t("sshKey.passphrase")}
                </ToggleGroupItem>
              )}
            </ToggleGroup>
          </div>
        </>
      )}

      {(mode === "paste" || keyPair) && (
        <>
          <div className="px-2 sm:px-3">
            <ShareOptions
              kind="note"
              expireOptions={config.noteExpireOptions}
              expireSec={effectiveExpireSec}
              onExpireChange={setExpireSec}
              limitOptions={config.noteViewOptions}
              limit={effectiveMaxViews}
              onLimitChange={setMaxViews}
              passwordEnabled={notePasswordEnabled}
              onPasswordEnabledChange={setNotePasswordEnabled}
              password={notePassword}
              onPasswordChange={setNotePassword}
              forcePassword={forcePassword}
              disabled={isSubmitting}
            />
          </div>

          <ShareFooter
            kind="note"
            expireSec={effectiveExpireSec}
            limit={effectiveMaxViews}
            label={t("share.encryptShare")}
            busyLabel={t("note.creating")}
            icon={<Send />}
            busy={isSubmitting}
            disabled={!canSubmit}
            onSubmit={handleSubmit}
          />
        </>
      )}
    </div>
  );
}
