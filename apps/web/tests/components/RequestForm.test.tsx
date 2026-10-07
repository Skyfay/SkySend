// @vitest-environment jsdom
import { createElement } from "react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key, i18n: { language: "en" } }),
  Trans: ({ i18nKey }: { i18nKey: string }) => i18nKey,
}));
const toast = vi.hoisted(() => Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }));
vi.mock("sonner", () => ({ toast }));

import { RequestForm } from "../../src/components/RequestForm.js";
import { TooltipProvider } from "../../src/components/ui/tooltip.js";
import type { ServerConfig } from "../../src/lib/api.js";
import type { RequestTemplate, TemplateFields } from "../../src/lib/request-templates.js";
import { writeDefaults } from "../../src/lib/defaults.js";

const GIB = 1024 ** 3;
const config = {
  fileRequestMaxSize: 10 * GIB,
  fileRequestMaxUploads: 20,
  fileRequestExpireOptions: [86_400, 259_200, 604_800],
  fileRequestDefaultExpire: 86_400,
  fileRequestRetention: 604_800,
  fileRequestDownloads: 5,
  noteMaxSize: 1024 * 1024,
  forceFilePassword: false,
} as ServerConfig;

const access: RequestTemplate = {
  id: "00000000-0000-4000-8000-000000000001",
  name: "Server access",
  asks: ["files", "note"],
  title: "Access to the new server",
  note: { v: 1, blocks: [{ type: "password", entries: [{ label: "Username", value: "" }] }] },
  limits: { expireSec: 259_200, sends: 5, maxSize: 2 * GIB },
  createdAt: "2026-10-01T00:00:00.000Z",
};
const wlan: RequestTemplate = {
  id: "00000000-0000-4000-8000-000000000002",
  name: "WLAN",
  asks: ["note"],
  createdAt: "2026-10-02T00:00:00.000Z",
};

function renderForm(props: Partial<Parameters<typeof RequestForm>[0]> = {}) {
  const handlers = {
    onSubmit: vi.fn(),
    onSaveTemplate: vi.fn(async (fields: TemplateFields, replace?: RequestTemplate) => ({
      ...fields,
      id: replace?.id ?? "00000000-0000-4000-8000-000000000009",
      createdAt: "2026-10-07T00:00:00.000Z",
    })),
    onEditDone: vi.fn(),
  };
  render(
    createElement(
      MemoryRouter,
      null,
      createElement(
        TooltipProvider,
        null,
        createElement(RequestForm, {
          config,
          creating: false,
          templates: [access, wlan],
          ...handlers,
          ...props,
        }),
      ),
    ),
  );
  return handlers;
}

const titleInput = () => screen.getByLabelText("request.titleLabel") as HTMLInputElement;

beforeAll(() => {
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
});

afterEach(() => {
  cleanup();
  writeDefaults({ file: {}, note: {}, request: {} });
});

describe("RequestForm with templates", () => {
  it("starts from a template with its title, its tab, its fields and its limits", () => {
    renderForm({ start: access });
    expect(titleInput().value).toBe("Access to the new server");
    expect(screen.getByRole("tab", { selected: true }).textContent).toContain("request.asksBoth");
    expect((screen.getByDisplayValue("Username") as HTMLInputElement).value).toBe("Username");
    expect(screen.getByRole("radio", { name: "Server access" }).getAttribute("aria-checked")).toBe(
      "true",
    );
  });

  it("fills the form in from a picked template and empties it again", () => {
    renderForm();
    fireEvent.click(screen.getByRole("radio", { name: "Server access" }));
    expect(titleInput().value).toBe("Access to the new server");
    fireEvent.click(screen.getByRole("radio", { name: "templates.blank" }));
    expect(titleInput().value).toBe("");
    expect(screen.getByRole("tab", { selected: true }).textContent).toContain("request.asksFiles");
  });

  it("starts from this browser's defaults, also from a template that keeps no limits", () => {
    writeDefaults({ file: {}, note: {}, request: { expireSec: 259_200, sends: 3 } });
    const handlers = renderForm({ start: wlan });
    fireEvent.click(screen.getByRole("button", { name: /request\.create/ }));
    expect(handlers.onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({ asks: ["note"], expireSec: 259_200, maxUploads: 3 }),
      wlan,
    );
  });

  it("names the template a request is created from, so it counts as used once created", () => {
    const handlers = renderForm({ start: wlan });
    fireEvent.click(screen.getByRole("button", { name: /request\.create/ }));
    expect(handlers.onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({ asks: ["note"] }),
      wlan,
    );
  });

  it("offers to bring back what a picked template replaced", () => {
    renderForm({ start: access });
    fireEvent.change(titleInput(), { target: { value: "My own title" } });
    fireEvent.click(screen.getByRole("radio", { name: "templates.blank" }));
    expect(titleInput().value).toBe("");
    const [message, options] = toast.mock.calls.at(-1)! as [
      string,
      { action: { onClick: () => void } },
    ];
    expect(message).toBe("templates.replacedForm");
    act(() => options.action.onClick());
    expect(titleInput().value).toBe("My own title");
    expect(screen.getByRole("tab", { selected: true }).textContent).toContain("request.asksBoth");
  });

  it("falls back from both to the note and fits the limits on a smaller server", () => {
    renderForm({
      start: access,
      config: { ...config, fileRequestMaxUploads: 1, fileRequestMaxSize: GIB },
    });
    expect(screen.getByRole("tab", { selected: true }).textContent).toContain("request.asksNote");
    expect(
      (screen.getByRole("tab", { name: /request\.asksBoth/ }) as HTMLButtonElement).disabled,
    ).toBe(true);
  });

  it("keeps the template's own values when an edit on a smaller server leaves them alone", async () => {
    const handlers = renderForm({
      editing: access,
      config: { ...config, fileRequestMaxUploads: 1, fileRequestMaxSize: GIB },
    });
    expect(screen.getByText(/templates\.editAdjusted/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /templates\.saveEdited/ }));
    await screen.findByLabelText("templates.name");
    fireEvent.click(screen.getByRole("button", { name: "common.save" }));
    await waitFor(() => expect(handlers.onSaveTemplate).toHaveBeenCalledOnce());
    const [fields] = handlers.onSaveTemplate.mock.calls[0]!;
    expect(fields).toMatchObject({ asks: ["files", "note"], limits: access.limits });
  });

  it("saves the form as a template without the title when it is unticked", async () => {
    const handlers = renderForm({ start: access });
    fireEvent.click(screen.getByRole("button", { name: /templates\.saveAs/ }));
    const name = await screen.findByLabelText("templates.name");
    fireEvent.change(name, { target: { value: "Mine" } });
    fireEvent.click(screen.getByRole("checkbox", { name: /templates\.keepTitle/ }));
    fireEvent.click(screen.getByRole("button", { name: "common.save" }));
    await waitFor(() => expect(handlers.onSaveTemplate).toHaveBeenCalledOnce());
    const [fields, replace] = handlers.onSaveTemplate.mock.calls[0]!;
    expect(fields).toEqual({
      name: "Mine",
      asks: ["files", "note"],
      note: access.note,
      limits: { expireSec: 259_200, sends: 5, maxSize: 2 * GIB },
    });
    expect(replace).toBeUndefined();
  });

  it("replaces the template of the same name when saving under its name", async () => {
    const handlers = renderForm({ start: access });
    fireEvent.click(screen.getByRole("button", { name: /templates\.saveAs/ }));
    expect(((await screen.findByLabelText("templates.name")) as HTMLInputElement).value).toBe(
      "Server access",
    );
    expect(screen.getByText("templates.nameTaken")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "templates.replace" }));
    await waitFor(() => expect(handlers.onSaveTemplate).toHaveBeenCalledOnce());
    expect(handlers.onSaveTemplate.mock.calls[0]![1]).toBe(access);
  });

  it("edits a template without a password and without taking the name of another one", async () => {
    const handlers = renderForm({ editing: access });
    expect(screen.queryByText("share.password")).toBeNull();
    expect(screen.queryByRole("button", { name: /request\.create/ })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /templates\.saveEdited/ }));
    const name = await screen.findByLabelText("templates.name");
    fireEvent.change(name, { target: { value: "wlan" } });
    expect(screen.getByText("templates.nameInUse")).toBeTruthy();
    expect(
      (screen.getByRole("button", { name: "common.save" }) as HTMLButtonElement).disabled,
    ).toBe(true);

    fireEvent.change(name, { target: { value: "Server access 2" } });
    fireEvent.click(screen.getByRole("button", { name: "common.save" }));
    await waitFor(() => expect(handlers.onEditDone).toHaveBeenCalledOnce());
    expect(handlers.onSaveTemplate.mock.calls[0]![1]).toBe(access);
  });
});
