import { invoke } from "@tauri-apps/api/core";
import type { ExtensionInfo } from "./types";

export const extensionList = (): Promise<ExtensionInfo[]> =>
  invoke<ExtensionInfo[]>("extension_list");

export const extensionAdd = (sourceDir: string): Promise<ExtensionInfo> =>
  invoke<ExtensionInfo>("extension_add", { sourceDir });

export const extensionToggle = (id: string, enabled: boolean): Promise<void> =>
  invoke<void>("extension_toggle", { id, enabled });

export const extensionDelete = (id: string): Promise<void> =>
  invoke<void>("extension_delete", { id });
