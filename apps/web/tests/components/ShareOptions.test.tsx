// @vitest-environment jsdom
import { createElement } from "react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key, i18n: { language: "en" } }),
  Trans: ({ i18nKey }: { i18nKey: string }) => i18nKey,
}));

import { ShareOptions } from "../../src/components/ShareOptions.js";
import { TooltipProvider } from "../../src/components/ui/tooltip.js";

type Props = Parameters<typeof ShareOptions>[0];

function renderOptions(props: Partial<Props> = {}) {
  const handlers = {
    onExpireChange: vi.fn(),
    onLimitChange: vi.fn(),
    onPasswordEnabledChange: vi.fn(),
    onPasswordChange: vi.fn(),
  };
  render(
    createElement(
      TooltipProvider,
      null,
      createElement(ShareOptions, {
        kind: "file",
        expireOptions: [3_600, 86_400, 604_800],
        expireSec: 86_400,
        limitOptions: [1, 2, 5, 10],
        limit: 5,
        passwordEnabled: false,
        password: "",
        ...handlers,
        ...props,
      }),
    ),
  );
  return handlers;
}

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
    matches: true,
    media,
    addEventListener() {},
    removeEventListener() {},
  }));
});

afterEach(cleanup);

describe("ShareOptions", () => {
  it("picks the expiry and the download limit in the popovers of their pills", () => {
    const handlers = renderOptions();
    fireEvent.click(screen.getByRole("button", { name: /share\.pill\.expiry/ }));
    fireEvent.click(screen.getByRole("radio", { name: "7d" }));
    expect(handlers.onExpireChange).toHaveBeenCalledWith(604_800);
    fireEvent.click(screen.getByRole("button", { name: /share\.pill\.downloads/ }));
    fireEvent.click(screen.getByRole("radio", { name: "10" }));
    expect(handlers.onLimitChange).toHaveBeenCalledWith(10);
  });

  it("names the view limits of a note, an unlimited one included", () => {
    renderOptions({ kind: "note", limitOptions: [0, 1, 2, 5], limit: 0 });
    fireEvent.click(screen.getByRole("button", { name: /share\.pill\.unlimitedViews/ }));
    expect(screen.getByRole("radio", { name: "note.unlimited" }).textContent).toBe("∞");
    expect(screen.getByText("share.pick.viewsHint")).toBeTruthy();
    cleanup();
    renderOptions({ kind: "note", limitOptions: [0, 1, 2, 5], limit: 1 });
    expect(screen.getByRole("button", { name: /share\.pill\.burnAfterReading/ })).toBeTruthy();
  });

  it("switches the password on and shows its field", () => {
    const handlers = renderOptions();
    expect(screen.queryByPlaceholderText("upload.passwordPlaceholder")).toBeNull();
    fireEvent.click(screen.getByRole("switch", { name: "share.password" }));
    expect(handlers.onPasswordEnabledChange).toHaveBeenCalledWith(true);
    cleanup();
    renderOptions({ passwordEnabled: true });
    expect(screen.getByPlaceholderText("upload.passwordPlaceholder")).toBeTruthy();
  });

  it("keeps a forced password on", () => {
    renderOptions({ passwordEnabled: true, forcePassword: true });
    const password = screen.getByRole("switch", { name: "share.password" }) as HTMLButtonElement;
    expect(password.getAttribute("aria-checked")).toBe("true");
    expect(password.disabled).toBe(true);
    expect(screen.getByPlaceholderText("upload.passwordPlaceholderRequired")).toBeTruthy();
    expect(screen.getByText("share.passwordForced")).toBeTruthy();
  });
});
