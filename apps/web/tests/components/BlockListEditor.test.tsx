// @vitest-environment jsdom
import { createElement, useEffect, useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ReadBlock } from "@skysend/note-format";

let resolveKey: (pair: unknown) => void = () => {};
vi.mock("../../src/lib/ssh-keygen.js", () => ({
  Ed25519UnsupportedError: class extends Error {},
  generateEd25519KeyPair: () => new Promise((resolve) => (resolveKey = resolve)),
  generateRSAKeyPair: () => new Promise((resolve) => (resolveKey = resolve)),
}));
vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: (key: string) => key }) }));

import { BlockListEditor } from "../../src/components/BlockListEditor.js";
import { NoteBlocks } from "../../src/components/NoteBlocks.js";
import { TooltipProvider } from "../../src/components/ui/tooltip.js";
import type { DraftBlock, EditorMode } from "../../src/lib/note-editor.js";

let latest: DraftBlock[] = [];

function Harness({ start, mode }: { start: DraftBlock[]; mode: EditorMode }) {
  const [drafts, setDrafts] = useState(start);
  useEffect(() => {
    latest = drafts;
  }, [drafts]);
  return createElement(
    TooltipProvider,
    null,
    createElement(BlockListEditor, { drafts, onChange: setDrafts, mode, disabled: false }),
  );
}

afterEach(() => {
  cleanup();
});

describe("BlockListEditor", () => {
  it("keeps what was typed while an SSH key was generated", async () => {
    vi.stubGlobal("matchMedia", () => ({
      matches: false,
      addEventListener() {},
      removeEventListener() {},
    }));
    render(
      createElement(Harness, {
        mode: "compose",
        start: [
          { id: 1, type: "text", format: "plain", text: "" },
          { id: 2, type: "sshkey", publicKey: "", privateKey: "", passphrase: "" },
        ],
      }),
    );
    fireEvent.click(screen.getByText("sshKey.generate"));
    fireEvent.change(document.querySelector("textarea")!, { target: { value: "typed meanwhile" } });
    await act(async () => {
      resolveKey({
        publicKey: "ssh-ed25519 AAAA",
        privateKey: "-----BEGIN-----",
        extrasDropped: false,
      });
    });
    expect(latest[0]).toMatchObject({ text: "typed meanwhile" });
    expect(latest[1]).toMatchObject({ publicKey: "ssh-ed25519 AAAA" });
  });

  it("locks the structure and the labels when a template is filled in", () => {
    render(
      createElement(Harness, {
        mode: "fill",
        start: [{ id: 1, type: "password", entries: [{ label: "PIN", value: "" }] }],
      }),
    );
    expect(screen.queryByText("note.addBlock")).toBeNull();
    expect(screen.queryByLabelText("note.removeBlock")).toBeNull();
    expect(screen.queryByText("password.addAnother")).toBeNull();
    expect(screen.getByText("PIN").tagName).toBe("SPAN");
    fireEvent.change(screen.getByLabelText("PIN"), {
      target: { value: "4711" },
    });
    expect(latest[0]).toEqual({
      id: 1,
      type: "password",
      entries: [{ label: "PIN", value: "4711" }],
    });
  });

  it("lays out labels without values in a template", () => {
    render(
      createElement(Harness, {
        mode: "template",
        start: [{ id: 1, type: "password", entries: [{ label: "", value: "" }] }],
      }),
    );
    expect(screen.queryByLabelText("password.passwordNumber")).toBeNull();
    fireEvent.change(screen.getByLabelText("template.fieldLabel"), { target: { value: "PIN" } });
    fireEvent.click(screen.getByText("template.addField"));
    expect(latest[0]).toEqual({
      id: 1,
      type: "password",
      entries: [
        { label: "PIN", value: "" },
        { label: "", value: "" },
      ],
    });
  });
});

describe("entries that are no secret", () => {
  it("lets a template mark an entry as no secret and back", () => {
    render(
      createElement(Harness, {
        mode: "template",
        start: [{ id: 1, type: "password", entries: [{ label: "User", value: "" }] }],
      }),
    );
    // The block's own title, not the card that adds another block of its type.
    const title = () => screen.getAllByText(/^tab\.(password|fields)$/)[0]!.textContent;
    expect(title()).toBe("tab.password");
    fireEvent.click(screen.getByLabelText("password.makePlain"));
    expect(latest[0]).toMatchObject({ entries: [{ label: "User", value: "", secret: false }] });
    // A block with an entry in clear is no longer only passwords.
    expect(title()).toBe("tab.fields");
    fireEvent.click(screen.getByLabelText("password.makeSecret"));
    expect(latest[0]).toMatchObject({ entries: [{ label: "User", value: "" }] });
    expect((latest[0] as { entries: object[] }).entries[0]).not.toHaveProperty("secret");
  });

  it("fills in an entry that is no secret in clear, without a generator or a toggle", () => {
    render(
      createElement(Harness, {
        mode: "fill",
        start: [
          {
            id: 1,
            type: "password",
            entries: [
              { label: "User", value: "", secret: false },
              { label: "Password", value: "" },
            ],
          },
        ],
      }),
    );
    expect((screen.getByLabelText("User") as HTMLInputElement).type).toBe("text");
    expect((screen.getByLabelText("Password") as HTMLInputElement).type).toBe("password");
    expect(screen.getAllByLabelText("passwordGenerator.title")).toHaveLength(1);
    expect(screen.queryByLabelText("password.makeSecret")).toBeNull();
    expect(screen.queryByLabelText("password.makePlain")).toBeNull();
    fireEvent.change(screen.getByLabelText("User"), { target: { value: "alice" } });
    expect(latest[0]).toMatchObject({
      entries: [
        { label: "User", value: "alice", secret: false },
        { label: "Password", value: "" },
      ],
    });
  });

  it("shows an entry that is no secret in clear, and masks the others", () => {
    const blocks: ReadBlock[] = [
      {
        type: "password",
        entries: [
          { label: "User", value: "alice", secret: false },
          { label: "Password", value: "hunter2" },
        ],
      },
    ];
    render(createElement(TooltipProvider, null, createElement(NoteBlocks, { blocks })));
    expect(screen.getByText("alice")).toBeTruthy();
    expect(screen.queryByText("hunter2")).toBeNull();
    expect(screen.getByRole("heading", { name: "tab.fields" })).toBeTruthy();
    expect(screen.getAllByLabelText("noteView.reveal")).toHaveLength(1);
  });
});

describe("NoteBlocks", () => {
  it("shows the label of a text block as its title, so an answer matches its question", () => {
    const blocks: ReadBlock[] = [
      { type: "text", format: "plain", text: "10.0.0.1", label: "Server IP" },
      { type: "text", format: "plain", text: "none" },
    ];
    render(createElement(TooltipProvider, null, createElement(NoteBlocks, { blocks })));
    expect(screen.getByRole("heading", { name: "Server IP" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "tab.text" })).toBeTruthy();
  });
});
