import { useState, useCallback } from "react";
import { useTranslation } from "react-i18next";
import {
  Lock,
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
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ShareLink } from "@/components/ShareLink";
import { useNoteUpload } from "@/hooks/useNoteUpload";
import { useServerConfig } from "@/hooks/useServerConfig";
import { formatDuration, formatBytes } from "@/lib/utils";
import {
  generateEd25519KeyPair,
  generateRSAKeyPair,
  type SSHKeyPair,
} from "@/lib/ssh-keygen";

type Mode = "paste" | "generate";
type Algorithm = "ed25519" | "rsa";
type RSABits = 1024 | 2048 | 4096;
type ShareMode = "both" | "public";

export function SSHKeyForm() {
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
  const [genError, setGenError] = useState<string | null>(null);

  // Share settings (used by both modes)
  const [shareMode, setShareMode] = useState<ShareMode>("both");
  const [expireSec, setExpireSec] = useState<number | null>(null);
  const [maxViews, setMaxViews] = useState<number | null>(null);
  const [notePassword, setNotePassword] = useState("");
  const [showNotePassword, setShowNotePassword] = useState(false);
  const [notePasswordEnabled, setNotePasswordEnabled] = useState(false);

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

  if (!config) return null;

  const effectiveExpireSec = expireSec ?? config.noteDefaultExpire;
  const effectiveMaxViews = maxViews ?? config.noteDefaultViews;

  const isSubmitting =
    noteHook.phase === "encrypting" || noteHook.phase === "uploading";

  // --- Generate mode handlers ---

  const handleGenerate = async () => {
    setGenerating(true);
    setGenError(null);
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
    } catch (err) {
      setGenError(
        err instanceof Error ? err.message : "Key generation failed",
      );
    } finally {
      setGenerating(false);
    }
  };

  const handleRegenerate = () => {
    setKeyPair(null);
    setGenError(null);
  };

  // --- Content for note upload ---

  const getSubmitContent = (): string => {
    if (mode === "paste") {
      const parts = [pastePublicKey.trim(), pastePrivateKey.trim()].filter(Boolean);
      return parts.join("\n\n");
    }
    if (!keyPair) return "";
    return shareMode === "both"
      ? `${keyPair.publicKey}\n\n${keyPair.privateKey}`
      : keyPair.publicKey;
  };

  const pasteContent = mode === "paste"
    ? [pastePublicKey.trim(), pastePrivateKey.trim()].filter(Boolean).join("\n\n")
    : "";

  const canSubmit =
    mode === "paste"
      ? (pastePublicKey.trim().length > 0 || pastePrivateKey.trim().length > 0) &&
        new TextEncoder().encode(pasteContent).length <= config.noteMaxSize
      : keyPair !== null;

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
    setNotePasswordEnabled(false);
  };

  if (noteHook.phase === "done" && noteHook.shareLink) {
    return <ShareLink link={noteHook.shareLink} onNewUpload={handleNewNote} />;
  }

  const pasteContentBytes = new TextEncoder().encode(pasteContent).length;
  const pasteSizeExceeded = pasteContentBytes > config.noteMaxSize;

  // --- Shared UI pieces ---

  const renderShareSettings = () => (
    <>
      {/* Expiry + Max Views */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label>{t("note.expiry")}</Label>
          <Select
            value={String(effectiveExpireSec)}
            onValueChange={(v) => setExpireSec(parseInt(v, 10))}
            disabled={isSubmitting}
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {config.noteExpireOptions.map((sec) => (
                <SelectItem key={sec} value={String(sec)}>
                  {formatDuration(sec)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-2">
          <Label>{t("note.maxViews")}</Label>
          <Select
            value={String(effectiveMaxViews)}
            onValueChange={(v) => setMaxViews(parseInt(v, 10))}
            disabled={isSubmitting}
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {config.noteViewOptions.map((num) => (
                <SelectItem key={num} value={String(num)}>
                  {num === 0
                    ? t("note.unlimited")
                    : num === 1
                      ? t("note.burnAfterReading")
                      : String(num)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* Note Password */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <Label className="flex items-center gap-2">
            <Lock className="h-4 w-4" />
            {t("upload.password")}
          </Label>
          <Switch
            checked={notePasswordEnabled}
            onCheckedChange={setNotePasswordEnabled}
            disabled={isSubmitting}
          />
        </div>
        {notePasswordEnabled && (
          <div className="relative">
            <Input
              type={showNotePassword ? "text" : "password"}
              value={notePassword}
              onChange={(e) => setNotePassword(e.target.value)}
              placeholder={t("upload.passwordPlaceholder")}
              autoComplete="off"
              disabled={isSubmitting}
            />
            <button
              type="button"
              className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-muted-foreground hover:text-foreground"
              onClick={() => setShowNotePassword(!showNotePassword)}
            >
              {showNotePassword ? (
                <EyeOff className="h-4 w-4" />
              ) : (
                <Eye className="h-4 w-4" />
              )}
            </button>
          </div>
        )}
      </div>

      {/* Error */}
      {noteHook.phase === "error" && noteHook.error && (
        <p className="text-sm text-destructive-foreground" role="alert">
          {noteHook.error}
        </p>
      )}
    </>
  );

  return (
    <Card>
      <CardContent className="space-y-6 pt-6">
        {/* Mode toggle */}
        <div className="flex gap-1 rounded-lg border border-border bg-muted/50 p-1">
          {([
            { key: "generate" as const, icon: Wand2, label: t("sshKey.modeGenerate") },
            { key: "paste" as const, icon: ClipboardPaste, label: t("sshKey.modePaste") },
          ]).map(({ key, icon: Icon, label }) => (
            <button
              key={key}
              type="button"
              onClick={() => { setMode(key); setKeyPair(null); }}
              className={`flex flex-1 items-center justify-center gap-1.5 rounded-md px-3 py-2 text-sm font-medium transition-colors ${
                mode === key
                  ? "bg-background text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              <Icon className="h-4 w-4" />
              {label}
            </button>
          ))}
        </div>

        {/* ====== PASTE MODE ====== */}
        {mode === "paste" && (
          <>
            {/* Public Key */}
            <div className="space-y-2">
              <Label htmlFor="ssh-paste-public">{t("sshKey.publicKey")}</Label>
              <Textarea
                id="ssh-paste-public"
                value={pastePublicKey}
                onChange={(e) => setPastePublicKey(e.target.value)}
                placeholder={t("sshKey.pastePlaceholderPublic")}
                className="min-h-20 resize-y font-mono text-sm"
                disabled={isSubmitting}
              />
            </div>

            {/* Private Key */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label htmlFor="ssh-paste-private">{t("sshKey.privateKey")}</Label>
                <span
                  className={`text-xs ${pasteSizeExceeded ? "text-destructive-foreground" : "text-muted-foreground"}`}
                >
                  {formatBytes(pasteContentBytes)} / {formatBytes(config.noteMaxSize)}
                </span>
              </div>
              <Textarea
                id="ssh-paste-private"
                value={pastePrivateKey}
                onChange={(e) => setPastePrivateKey(e.target.value)}
                placeholder={t("sshKey.pastePlaceholderPrivate")}
                className="min-h-30 resize-y font-mono text-sm"
                disabled={isSubmitting}
              />
              {pasteSizeExceeded && (
                <p className="text-sm text-destructive-foreground" role="alert">
                  {t("note.tooLarge", { size: formatBytes(config.noteMaxSize) })}
                </p>
              )}
            </div>

            {renderShareSettings()}

            <Button
              onClick={handleSubmit}
              disabled={!canSubmit || isSubmitting}
              className="w-full"
              size="lg"
            >
              {isSubmitting ? (
                <Loader2 className="mr-2 h-5 w-5 animate-spin" />
              ) : (
                <Send className="mr-2 h-5 w-5" />
              )}
              {isSubmitting ? t("note.creating") : t("sshKey.createNote")}
            </Button>
          </>
        )}

        {/* ====== GENERATE MODE ====== */}
        {mode === "generate" && !keyPair && (
          <>
            {/* Algorithm */}
            <div className="space-y-2">
              <Label>{t("sshKey.algorithm")}</Label>
              <Select
                value={algorithm}
                onValueChange={(v) => setAlgorithm(v as Algorithm)}
                disabled={generating}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="ed25519">Ed25519</SelectItem>
                  <SelectItem value="rsa">RSA</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {/* RSA bits */}
            {algorithm === "rsa" && (
              <div className="space-y-2">
                <Label>{t("sshKey.keySize")}</Label>
                <Select
                  value={String(rsaBits)}
                  onValueChange={(v) => setRsaBits(parseInt(v, 10) as RSABits)}
                  disabled={generating}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="1024">1024 bit</SelectItem>
                    <SelectItem value="2048">2048 bit</SelectItem>
                    <SelectItem value="4096">4096 bit</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            )}

            {/* Comment */}
            <div className="space-y-2">
              <Label htmlFor="ssh-comment">{t("sshKey.comment")}</Label>
              <Input
                id="ssh-comment"
                value={comment}
                onChange={(e) => setComment(e.target.value)}
                placeholder={t("sshKey.commentPlaceholder")}
                disabled={generating}
              />
            </div>

            {/* Passphrase */}
            <div className="space-y-2">
              <Label htmlFor="ssh-passphrase">
                {t("sshKey.passphrase")}
              </Label>
              <div className="relative">
                <Input
                  id="ssh-passphrase"
                  type={showPassphrase ? "text" : "password"}
                  value={passphrase}
                  onChange={(e) => setPassphrase(e.target.value)}
                  placeholder={t("sshKey.passphrasePlaceholder")}
                  autoComplete="off"
                  disabled={generating}
                />
                <button
                  type="button"
                  className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-muted-foreground hover:text-foreground"
                  onClick={() => setShowPassphrase(!showPassphrase)}
                >
                  {showPassphrase ? (
                    <EyeOff className="h-4 w-4" />
                  ) : (
                    <Eye className="h-4 w-4" />
                  )}
                </button>
              </div>
              <p className="text-xs text-muted-foreground">
                {t("sshKey.passphraseHint")}
              </p>
            </div>

            {/* Error */}
            {genError && (
              <p className="text-sm text-destructive-foreground" role="alert">
                {genError}
              </p>
            )}

            {/* Generate Button */}
            <Button
              onClick={handleGenerate}
              disabled={generating}
              className="w-full"
              size="lg"
            >
              {generating ? (
                <Loader2 className="mr-2 h-5 w-5 animate-spin" />
              ) : (
                <KeyRound className="mr-2 h-5 w-5" />
              )}
              {generating ? t("sshKey.generating") : t("sshKey.generate")}
            </Button>
          </>
        )}

        {/* ====== GENERATE MODE - KEY DISPLAY ====== */}
        {mode === "generate" && keyPair && (
          <>
            {/* Key Info */}
            <div className="rounded-lg border border-border/50 bg-muted/30 p-3">
              <div className="flex items-center gap-2 text-sm font-medium">
                <KeyRound className="h-4 w-4 text-primary" />
                {keyPair.algorithm === "ed25519"
                  ? "Ed25519"
                  : `RSA-${rsaBits}`}
              </div>
              <p className="mt-1 font-mono text-xs text-muted-foreground">
                {keyPair.fingerprint}
              </p>
            </div>

            {/* Public Key */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label>{t("sshKey.publicKey")}</Label>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-7 px-2 text-xs"
                  onClick={() => copyText(keyPair.publicKey, setCopiedPublic)}
                >
                  {copiedPublic ? (
                    <Check className="mr-1 h-3 w-3" />
                  ) : (
                    <Copy className="mr-1 h-3 w-3" />
                  )}
                  {copiedPublic ? t("common.copied") : t("common.copy")}
                </Button>
              </div>
              <pre className="overflow-x-auto rounded-lg border bg-muted/50 p-3 font-mono text-xs break-all whitespace-pre-wrap scrollbar-thin">
                {keyPair.publicKey}
              </pre>
            </div>

            {/* Private Key */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label>{t("sshKey.privateKey")}</Label>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-7 px-2 text-xs"
                  onClick={() =>
                    copyText(keyPair.privateKey, setCopiedPrivate)
                  }
                >
                  {copiedPrivate ? (
                    <Check className="mr-1 h-3 w-3" />
                  ) : (
                    <Copy className="mr-1 h-3 w-3" />
                  )}
                  {copiedPrivate ? t("common.copied") : t("common.copy")}
                </Button>
              </div>
              <pre className="max-h-40 overflow-auto rounded-lg border bg-muted/50 p-3 font-mono text-xs scrollbar-thin">
                {keyPair.privateKey}
              </pre>
            </div>

            {/* Share Mode */}
            <div className="space-y-2">
              <Label>{t("sshKey.shareAs")}</Label>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setShareMode("both")}
                  className={`flex-1 rounded-md border px-3 py-2 text-sm font-medium transition-colors ${
                    shareMode === "both"
                      ? "border-primary bg-primary/10 text-primary"
                      : "border-border text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {t("sshKey.shareBoth")}
                </button>
                <button
                  type="button"
                  onClick={() => setShareMode("public")}
                  className={`flex-1 rounded-md border px-3 py-2 text-sm font-medium transition-colors ${
                    shareMode === "public"
                      ? "border-primary bg-primary/10 text-primary"
                      : "border-border text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {t("sshKey.sharePublicOnly")}
                </button>
              </div>
            </div>

            {renderShareSettings()}

            {/* Submit + Regenerate */}
            <div className="flex gap-2">
              <Button
                onClick={handleSubmit}
                disabled={isSubmitting}
                className="flex-1"
                size="lg"
              >
                {isSubmitting ? (
                  <Loader2 className="mr-2 h-5 w-5 animate-spin" />
                ) : (
                  <Send className="mr-2 h-5 w-5" />
                )}
                {isSubmitting ? t("note.creating") : t("sshKey.createNote")}
              </Button>
              <Button
                onClick={handleRegenerate}
                variant="outline"
                size="lg"
                disabled={isSubmitting}
              >
                <RefreshCw className="h-5 w-5" />
              </Button>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
