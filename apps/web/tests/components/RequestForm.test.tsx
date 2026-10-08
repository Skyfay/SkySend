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
  fileRequestUploadOptions: [1, 2, 3, 5, 10, 20],
  fileRequestDefaultUploads: 10,
  fileRequestDownloadOptions: [1, 2, 5],
  fileRequestDefaultDownloads: 5,
  fileRequestExpireOptions: [86_400, 259_200, 604_800],
  fileRequestDefaultExpire: 86_400,
  fileRequestRetention: 604_800,
  noteMaxSize: 1024 * 1024,
  forceRequestPassword: false,
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
const create = () => screen.getByRole("button", { name: /request\.create/ }) as HTMLButtonElement;

// Whether the window is wide enough for popovers, a phone gets sheets instead.
let wide = true;

beforeAll(() => {
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  vi.stubGlobal("matchMedia", (media: string) => ({
    matches: wide,
    media,
    addEventListener() {},
    removeEventListener() {},
  }));
});

afterEach(() => {
  cleanup();
  wide = true;
  writeDefaults({ file: {}, note: {}, request: {} });
});

describe("RequestForm settings", () => {
  it("picks a value in the popover of its pill and closes it again", () => {
    const handlers = renderForm();
    fireEvent.click(screen.getByRole("button", { name: /request\.pill\.uploads/ }));
    expect(screen.getByRole("dialog", { name: "request.pick.uploads" })).toBeTruthy();
    fireEvent.click(screen.getByRole("radio", { name: "20" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    fireEvent.click(create());
    expect(handlers.onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({ maxUploads: 20 }),
      undefined,
    );
  });

  it("opens the options in a sheet on a phone", () => {
    wide = false;
    const handlers = renderForm();
    fireEvent.click(screen.getByRole("button", { name: /request\.pill\.downloads/ }));
    expect(screen.getByRole("dialog", { name: "request.pick.downloads" })).toBeTruthy();
    fireEvent.click(screen.getByRole("radio", { name: "2" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    fireEvent.click(create());
    expect(handlers.onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({ downloads: 2 }),
      undefined,
    );
  });

  it("counts submissions for both and leaves the size out for a note alone", () => {
    renderForm({ start: access });
    expect(screen.getByRole("button", { name: /request\.pill\.submissions/ })).toBeTruthy();
    expect(screen.getByRole("button", { name: /request\.pill\.size/ })).toBeTruthy();
    cleanup();
    renderForm({ start: wlan });
    expect(screen.queryByRole("button", { name: /request\.pill\.size/ })).toBeNull();
    expect(screen.getByRole("button", { name: /request\.pill\.views/ })).toBeTruthy();
  });

  it("asks for a password once its switch is on", () => {
    const handlers = renderForm();
    const password = screen.getByRole("switch", { name: "share.password" });
    expect(password.getAttribute("aria-checked")).toBe("false");
    fireEvent.click(password);
    expect(password.getAttribute("aria-checked")).toBe("true");
    expect(create().disabled).toBe(true);
    fireEvent.change(screen.getByPlaceholderText("upload.passwordPlaceholder"), {
      target: { value: "correct horse" },
    });
    fireEvent.click(create());
    expect(handlers.onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({ password: "correct horse" }),
      undefined,
    );
  });

  it("takes an inbox password only from 8 characters on, like a file password", () => {
    renderForm();
    fireEvent.click(screen.getByRole("switch", { name: "share.password" }));
    const field = screen.getByPlaceholderText("upload.passwordPlaceholder");
    fireEvent.change(field, { target: { value: "1234567" } });
    expect(create().disabled).toBe(true);
    expect(screen.getByText("share.passwordTooShort")).toBeTruthy();
    fireEvent.change(field, { target: { value: "12345678" } });
    expect(create().disabled).toBe(false);
    expect(screen.queryByText("share.passwordTooShort")).toBeNull();
  });

  it("keeps a forced password on, with its field", () => {
    renderForm({ config: { ...config, forceRequestPassword: true } });
    const password = screen.getByRole("switch", { name: "share.password" }) as HTMLButtonElement;
    expect(password.getAttribute("aria-checked")).toBe("true");
    expect(password.disabled).toBe(true);
    expect(screen.getByPlaceholderText("upload.passwordPlaceholderRequired")).toBeTruthy();
    expect(create().disabled).toBe(true);
  });
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
    writeDefaults({ file: {}, note: {}, request: { expireSec: 259_200, sends: 3, downloads: 2 } });
    const handlers = renderForm({ start: wlan });
    fireEvent.click(create());
    expect(handlers.onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({ asks: ["note"], expireSec: 259_200, maxUploads: 3, downloads: 2 }),
      wlan,
    );
  });

  it("says how many new requests are left today, and stops at none", () => {
    renderForm({ dailyLimit: { dailyLimit: 10, remaining: 3, resetsAt: null } });
    expect(screen.getByText("request.limitLeft")).toBeTruthy();
    cleanup();
    const handlers = renderForm({
      dailyLimit: { dailyLimit: 10, remaining: 0, resetsAt: "2099-01-01T00:00:00.000Z" },
    });
    expect(screen.getByText("request.limitReached")).toBeTruthy();
    expect(create().disabled).toBe(true);
    fireEvent.click(create());
    expect(handlers.onSubmit).not.toHaveBeenCalled();
  });

  it("says nothing of a limit where the server sets none", () => {
    renderForm({ dailyLimit: { dailyLimit: 0, remaining: null, resetsAt: null } });
    expect(screen.queryByText("request.limitLeft")).toBeNull();
    expect(screen.queryByText("request.limitReached")).toBeNull();
  });

  it("names the template a request is created from, so it counts as used once created", () => {
    const handlers = renderForm({ start: wlan });
    fireEvent.click(create());
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

  it("fits the limits of a template to a smaller server, and counts submissions twice", () => {
    const handlers = renderForm({
      start: access,
      config: { ...config, fileRequestUploadOptions: [1, 2], fileRequestMaxSize: GIB },
    });
    expect(screen.getByRole("tab", { selected: true }).textContent).toContain("request.asksBoth");
    fireEvent.click(create());
    // Five submissions fit to the two the server offers, which take four uploads.
    expect(handlers.onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({ maxUploads: 4, maxSize: GIB, downloads: 5 }),
      access,
    );
  });

  it("keeps the template's own values when an edit on a smaller server leaves them alone", async () => {
    const handlers = renderForm({
      editing: access,
      config: { ...config, fileRequestUploadOptions: [1, 2], fileRequestMaxSize: GIB },
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
      limits: { expireSec: 259_200, sends: 5, maxSize: 2 * GIB, downloads: 5 },
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
    expect(screen.queryByRole("switch", { name: "share.password" })).toBeNull();
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
