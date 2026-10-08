import type { NoteBlock, ReadBlock } from "./document.js";

function blockToText(block: NoteBlock): string {
  switch (block.type) {
    case "text":
      return block.label && block.text ? `${block.label}\n${block.text}` : block.text;
    case "password": {
      const entries = block.entries.map((entry) => (entry.label ? `${entry.label}: ${entry.value}` : entry.value)).join("\n");
      return block.label && entries ? `${block.label}\n${entries}` : entries;
    }
    case "code":
      return block.title ? `${block.title}\n${block.code}` : block.code;
    case "sshkey": {
      const key = [block.publicKey, block.privateKey, block.passphrase ? `Passphrase: ${block.passphrase}` : ""]
        .filter((part) => part.length > 0)
        .join("\n\n");
      return block.label && key ? `${block.label}\n${key}` : key;
    }
  }
}

/**
 * The whole note as plain text, for "copy all" in the web app and for saving a note from
 * the CLI client. Blocks this version cannot read are left out.
 */
export function noteToText(blocks: readonly ReadBlock[]): string {
  return blocks
    .filter((block): block is NoteBlock => block.type !== "unsupported")
    .map(blockToText)
    .filter((text) => text.length > 0)
    .join("\n\n");
}
