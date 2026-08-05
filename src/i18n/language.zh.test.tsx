// L2 zh-CN rendering spot-check (TASK-M9-02): switching the language via
// setLang re-renders components with the Chinese resources — the error
// classification pipeline (errorTitleKey -> useT) and one feature surface
// render Chinese copy, and switching back restores English. Guards the
// language switcher end-to-end without a full shell mount.

import { afterEach, describe, expect, it } from "vitest";
import { render, screen } from "@solidjs/testing-library";
import { LANG_STORAGE_KEY, setLang, useT } from "./index.js";
import { ApiError } from "../services/errors.js";
import ErrorBanner from "../components/ErrorBanner.js";

afterEach(() => {
  setLang("en");
  localStorage.removeItem(LANG_STORAGE_KEY);
});

describe("zh-CN rendering (TASK-M9-02 spot-check)", () => {
  it("resolves error titles and feature copy in Chinese after setLang", () => {
    setLang("zh-CN");
    const t = useT();
    expect(t("errors:networkTitle")).toBe("无法连接服务器");
    expect(t("sessions:newSession")).toBe("新建会话");
    expect(t("permissions:permissionRequest")).toBe("权限请求");
    expect(t("models:provider")).toBe("模型服务商");
    expect(t("messages:promptPlaceholder")).toBe("输入消息…");
  });

  it("re-renders the ErrorBanner with the Chinese classified title", () => {
    const err = new ApiError(undefined, "network", "", false);
    const { unmount } = render(() => <ErrorBanner error={err} onDismiss={() => undefined} />);
    // English first.
    expect(screen.getByTestId("error-banner-title")).toHaveTextContent("Cannot reach server");

    // Switch to zh-CN: the reactive t() re-renders the banner.
    setLang("zh-CN");
    expect(screen.getByTestId("error-banner-title")).toHaveTextContent("无法连接服务器");

    // And back.
    setLang("en");
    expect(screen.getByTestId("error-banner-title")).toHaveTextContent("Cannot reach server");
    unmount();
  });

  it("renders the 401 classified title in Chinese", () => {
    setLang("zh-CN");
    const err = new ApiError(401, "http", "", false);
    const { unmount } = render(() => <ErrorBanner error={err} onDismiss={() => undefined} />);
    expect(screen.getByTestId("error-banner-title")).toHaveTextContent("需要身份验证");
    unmount();
  });

  it("persists the language override for the next launch", () => {
    setLang("zh-CN");
    expect(localStorage.getItem(LANG_STORAGE_KEY)).toBe("zh-CN");
  });
});
