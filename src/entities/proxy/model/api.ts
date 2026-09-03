import { invoke } from "@tauri-apps/api/core";
import type { ProxyEntry, ProxyTestSnapshot } from "./types";

export type CleanReport = {
  total: number;
  kept: number;
  removed: number;
  removed_names: string[];
};

export const proxyList = () => invoke<ProxyEntry[]>("proxy_list");
export const proxySave = (entry: ProxyEntry) => invoke("proxy_save", { entry });
export const proxyDelete = (id: string) => invoke("proxy_delete", { id });
export const proxyFullTest = (entry: ProxyEntry) => invoke<ProxyTestSnapshot>("proxy_full_test", { entry });
export const proxyLastTest = (id: string) => invoke<ProxyTestSnapshot | null>("proxy_last_test", { id });
export const proxyHistory = (id: string) => invoke<ProxyTestSnapshot[]>("proxy_history", { id });
export const proxyBulkParse = (text: string, kind: ProxyEntry["kind"]) => invoke<ProxyEntry[]>("proxy_bulk_parse", { text, kind });
export const proxyBulkSave = (entries: any[]) => invoke<number>("proxy_bulk_save", { entries });
export const proxyBulkImport = (text: string, kind: string) => invoke<number>("proxy_bulk_import", { text, kind });
export const proxyCheckAndClean = () => invoke<CleanReport>("proxy_check_and_clean");
export const proxyTestHttpsSsl = (entry: ProxyEntry) => invoke<number>("proxy_test_https_ssl", { entry });

