import { KeyRound, Lock, ShieldCheck } from "lucide-react";
import { SectionHeading } from "@/components/site/section-heading";
import { Reveal } from "@/components/site/reveal";

const POINTS = [
  {
    icon: Lock,
    title: "Encrypted before it leaves your browser",
    description:
      "Files and notes are encrypted client-side with AES-256-GCM before upload - the server only ever receives ciphertext.",
  },
  {
    icon: KeyRound,
    title: "The key never touches the server",
    description:
      "The decryption key lives only in the share link's URL fragment, which browsers never send to any server by design.",
  },
  {
    icon: ShieldCheck,
    title: "Open, standard encryption",
    description:
      "AES-256-GCM and Argon2id, documented standards implemented in every major language - not a custom cipher tied to SkySend.",
  },
];

export function ZeroKnowledgeSection() {
  return (
    <section className="border-y border-border/60 bg-card/40 dark:border-transparent dark:bg-card/20">
      <div className="mx-auto max-w-6xl px-6 py-20 sm:py-24">
        <SectionHeading
          eyebrow="Zero-knowledge"
          title="The server never sees your data"
          description="Every file and note is encrypted before it leaves your device. Even the person running the SkySend instance can't read what's shared through it."
        />

        <Reveal>
          <div className="mt-12 grid gap-8 md:grid-cols-3">
            {POINTS.map((point) => (
              <div key={point.title} className="text-center md:text-left">
                <point.icon className="mx-auto size-6 text-primary md:mx-0" />
                <h3 className="mt-3 font-semibold">{point.title}</h3>
                <p className="mt-1 text-sm text-muted-foreground">
                  {point.description}
                </p>
              </div>
            ))}
          </div>
        </Reveal>
      </div>
    </section>
  );
}
