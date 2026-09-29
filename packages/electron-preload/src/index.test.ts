import { IPC } from "@mediago/common";
import { beforeEach, describe, expect, it, vi } from "vitest";

const electronMocks = vi.hoisted(() => ({
  exposeInMainWorld: vi.fn(),
  invoke: vi.fn(async () => undefined),
}));

vi.mock("electron", () => ({
  contextBridge: { exposeInMainWorld: electronMocks.exposeInMainWorld },
  ipcRenderer: {
    invoke: electronMocks.invoke,
    on: vi.fn(),
    removeListener: vi.fn(),
  },
  webUtils: { getPathForFile: vi.fn(() => "/tmp/file") },
}));

const { electronApi } = await import("./index");

beforeEach(() => {
  vi.clearAllMocks();
});

describe("Electron preload tab API", () => {
  it("exposes tab lifecycle commands", async () => {
    await electronApi.browser.createTab({ url: "https://example.com" });
    await electronApi.browser.activateTab("tab-a");
    await electronApi.browser.closeTab("tab-a");
    await electronApi.browser.getTabs();

    expect(electronMocks.invoke).toHaveBeenNthCalledWith(
      1,
      IPC.browser.createTab,
      { url: "https://example.com" },
    );
    expect(electronMocks.invoke).toHaveBeenNthCalledWith(
      2,
      IPC.browser.activateTab,
      "tab-a",
    );
    expect(electronMocks.invoke).toHaveBeenNthCalledWith(
      3,
      IPC.browser.closeTab,
      "tab-a",
    );
    expect(electronMocks.invoke).toHaveBeenNthCalledWith(
      4,
      IPC.browser.getTabs,
    );
  });

  it("sends tab ids with browser operations while retaining legacy calls", async () => {
    await electronApi.browser.loadURL("tab-a", "https://example.com/a");
    await electronApi.browser.setBounds("tab-a", {
      x: 0,
      y: 1,
      width: 2,
      height: 3,
    });
    await electronApi.browser.showDownloadDialog("tab-a", []);
    await electronApi.browser.loadURL("https://example.com/legacy");

    expect(electronMocks.invoke).toHaveBeenNthCalledWith(
      1,
      IPC.browser.loadURL,
      { tabId: "tab-a", url: "https://example.com/a" },
    );
    expect(electronMocks.invoke).toHaveBeenNthCalledWith(
      2,
      IPC.browser.setBounds,
      {
        tabId: "tab-a",
        bounds: { x: 0, y: 1, width: 2, height: 3 },
      },
    );
    expect(electronMocks.invoke).toHaveBeenNthCalledWith(
      3,
      IPC.browser.showDownloadDialog,
      { tabId: "tab-a", data: [] },
    );
    expect(electronMocks.invoke).toHaveBeenNthCalledWith(
      4,
      IPC.browser.loadURL,
      { tabId: "", url: "https://example.com/legacy" },
    );
  });
});
