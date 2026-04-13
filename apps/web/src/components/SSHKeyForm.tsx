import { useState, useCallback, useEffect } from "react";
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
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
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
import { formatDuration } from "@/lib/utils";
import {
  generateEd25519KeyPair,
  generateRSAKeyPair,
  type SSHKeyPair,
} from "@/lib/ssh-keygen";

type Algorithm = "ed25519" | "rsa";
type ShareMode = "both" | "public";

export function SSHKeyForm() {
  const { t } = useTranslation();
  const { config } = useServerConfig();
  const noteHook = useNoteUpload();

  // Generation config
  const [algorithm, setAlgorithm] = useState<Algorithm>("ed25519");
  const [comment, setComment] = useState("");
  const [passphrase, setPassphrase] = useState("");
  const [showPassphrase, setShowPassphrase] = useState(false);

  // Generated keys
  const [keyPair, setKeyPair] = useState<SSHKeyPair | null>(null);
  const [generating, setGenerating] = useState(false);
  const [genError, setGenError] = useState<string | null>(null);

  // Share settings
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

  // Initialize defaults when config loads
  useEffect(() => {
    if (config && expireSec === null) setExpireSec(config.noteDefaultExpire);
    if (config && maxViews === null) setMaxViews(config.noteDefaultViews);
  }, [config, expireSec, maxViews]);

  if (!config || expireSec === null || maxViews === null) return null;

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
              4096,
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

  const shareContent =
    shareMode === "both" && keyPair
      ? `${keyPair.publicKey}\n\n${keyPair.privateKey}`
      : keyPair?.publicKey ?? "";

  const isSubmitting =
    noteHook.phase === "encrypting" || noteHook.phase === "uploading";

  const handleSubmit = () => {
    if (!keyPair) return;
    noteHook.upload({
      content: shareContent,
      contentType: "code",
      maxViews,
      expireSec,
      password: notePasswordEnabled ? notePassword : "",
    });
  };

  const handleNewNote = () => {
    noteHook.reset();
    setKeyPair(null);
    setPassphrase("");
    setComment("");
    setNotePassword("");
    setNotePasswordEnabled(false);
  };

  // Show share link when done
  if (noteHook.phase === "done" && noteHook.shareLink) {
    return <ShareLink link={noteHook.shareLink} onNewUpload={handleNewNote} />;
  }

  return (
    <Card>
      <CardContent className="space-y-6 pt-6">
        {!keyPair ? (
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
                  <SelectItem value="rsa">RSA-4096</SelectItem>
                </SelectContent>
              </Select>
            </div>

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
        ) : (
          <>
            {/* Key Info */}
            <div className="rounded-lg border border-border/50 bg-muted/30 p-3">
              <div className="flex items-center gap-2 text-sm font-medium">
                <KeyRound className="h-4 w-4 text-primary" />
                {keyPair.algorithm === "ed25519" ? "Ed25519" : "RSA-4096"}
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

            {/* Expiry + Max Views */}
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label>{t("note.expiry")}</Label>
                <Select
                  value={String(expireSec)}
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
                  value={String(maxViews)}
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
