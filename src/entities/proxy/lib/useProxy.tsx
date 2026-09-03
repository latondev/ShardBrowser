import { create } from 'zustand'
import { ProxyEntry, ProxyTestSnapshot } from '../model/types'
import { proxyFullTest, proxyLastTest, proxyList, proxyDelete, proxySave, proxyBulkImport, proxyCheckAndClean, CleanReport } from '../model/api';
import { profileList } from '../../profile/model/api';
import { toast } from '../../../shared/lib/toast';
import { clip } from '../../../shared/lib/clipboard';
import { confirmModal } from '../../../shared/lib/confirm';
import { ProfileMeta } from '../../profile/model/types';

export type ProxyInfoTarget = { proxy: ProxyEntry; anchor: { x: number; y: number } };

export type ProxyStore = {

    status: 'idle' | 'loading' | 'ready' | 'error';
    error: string | null;

    proxyTesting: Record<string, boolean>,
    proxies: ProxyEntry[],
    snapshots: Record<string, ProxyTestSnapshot>,
    proxySel: Set<string>,
    profiles: ProfileMeta[],

    // UI state lives in the store so feature buttons stay prop-free.
    editing: ProxyEntry | null,
    bulkOpen: boolean,
    infoFor: ProxyInfoTarget | null,
    search: string,

    init: () => Promise<void>,
    testProxy: (p: ProxyEntry) => Promise<'error' | 'ok'>,
    reload: () => Promise<void>,
    setProxies: (proxies: ProxyEntry[]) => void,
    setSnapshots: (snapshots: Record<string, ProxyTestSnapshot>) => void,
    selectProxy: (isChecked: boolean, proxies: ProxyEntry[]) => void,
    clearSelected: () => void,

    setEditing: (p: ProxyEntry | null) => void,
    setBulkOpen: (open: boolean) => void,
    setInfoFor: (target: ProxyInfoTarget | null) => void,
    setSearch: (q: string) => void,

    renameProxy: (id: string, name: string) => Promise<void>,
    removeProxy: (id: string) => Promise<void>,
    bulkTest: () => Promise<void>,
    bulkDelete: () => Promise<void>,
    bulkExport: () => void,
    bulkImportClipboard: () => Promise<void>,
    cleaning: boolean,
    checkAndClean: () => Promise<CleanReport | null>,
}
export const useProxy = create<ProxyStore>((set, get) => ({
    status: 'idle',
    error: null,
    proxyTesting: {},
    proxies: new Array<ProxyEntry>(),
    snapshots: {},
    proxySel: new Set<string>(),
    profiles: new Array<ProfileMeta>(),
    editing: null,
    bulkOpen: false,
    infoFor: null,
    search: '',
    testProxy: async (p: ProxyEntry) => {
        set({ proxyTesting: { ...get().proxyTesting, [p.id]: true } });
        try {
            const snap = await proxyFullTest(p);
            set({ snapshots: { ...get().snapshots, [p.id]: snap } });
            // Refresh: backend may have just populated the country tag.
            get().reload();
        } catch (e) {
            return 'error';
        } finally {
            set({ proxyTesting: { ...get().proxyTesting, [p.id]: false } });
            return 'ok';
        }
    },
    init: async () => {
        // защита от повторного запуска
        if (get().status === 'loading' || get().status === 'ready') return;
        set({ status: 'loading' });
        try {
            const proxies = await proxyList();
            const profiles = await profileList();
            set({ proxies, profiles });

            if (proxies.length === 0) return;
            const entries = await Promise.all(
                proxies.map(async (p) => {
                    try {
                        const snap = await proxyLastTest(p.id);
                        return [p.id, snap] as const;
                    } catch {
                        return [p.id, null] as const;
                    }
                }),
            )
            const next: Record<string, ProxyTestSnapshot> = {};
            for (const [id, snap] of entries) if (snap) next[id] = snap;
            set({ snapshots: next });

        } catch (e) {
            set({ status: 'error', error: (e as Error).message });
        }
    },
    reload: async () => {
        try {
            set({ proxies: await proxyList() });
            set({ profiles: await profileList() });
        } catch (e) { toast.err(String(e)); }
    },
    setProxies: (proxies: ProxyEntry[]) => set({ proxies }),
    setSnapshots: (snapshots: Record<string, ProxyTestSnapshot>) => set({ snapshots }),
    selectProxy: (isChecked: boolean, proxies: ProxyEntry[]) => {
        const next = new Set(get().proxySel);
        if (isChecked) {
            for (const p of proxies) next.add(p.id);
        } else {
            for (const p of proxies) next.delete(p.id);
        }
        set({ proxySel: next });
    },
    clearSelected: () => set({ proxySel: new Set<string>() }),

    setEditing: (editing) => set({ editing }),
    setBulkOpen: (bulkOpen) => set({ bulkOpen }),
    setInfoFor: (infoFor) => set({ infoFor }),
    setSearch: (search) => set({ search }),

    renameProxy: async (id, name) => {
        const entry = get().proxies.find((p) => p.id === id);
        if (!entry) return;
        const newName = name.trim();
        if (newName === entry.name) return;
        try {
            await proxySave({ ...entry, name: newName });
            get().reload();
        } catch (e) { toast.err(String(e)); }
    },
    removeProxy: async (id) => {
        if ((await confirmModal({ title: "Delete proxy", message: "Delete this proxy?", danger: true })) !== true) return;
        try { await proxyDelete(id); get().reload(); toast.ok("Proxy deleted"); }
        catch (e) { toast.err(String(e)); }
    },
    // Capped-parallel bulk TCP/UDP/geo to avoid socket fan-out.
    bulkTest: async () => {
        const { proxySel, proxies, testProxy } = get();
        const ids = [...proxySel];
        if (ids.length === 0) return;
        toast.info(`Testing ${ids.length} prox${ids.length === 1 ? "y" : "ies"}…`);
        const targets = proxies.filter((p) => proxySel.has(p.id));
        const CONCURRENCY = 5;
        let i = 0;
        await Promise.all(
            Array.from({ length: Math.min(CONCURRENCY, targets.length) }, async () => {
                while (i < targets.length) {
                    const p = targets[i++];
                    if (!p) break;
                    await testProxy(p);
                }
            }),
        );
        toast.ok("Bulk test done");
    },
    bulkDelete: async () => {
        const { proxySel } = get();
        const ids = [...proxySel];
        if (ids.length === 0) return;
        if ((await confirmModal({ title: "Delete proxies", message: `Delete ${ids.length} prox${ids.length === 1 ? "y" : "ies"}?`, danger: true })) !== true) return;
        for (const id of ids) {
            try { await proxyDelete(id); } catch (e) { toast.err(String(e)); }
        }
        get().clearSelected();
        get().reload();
        toast.ok(`Deleted ${ids.length}`);
    },
    // Export in bulk-import format so round-trip preserves country tag.
    bulkExport: () => {
        const { proxySel, proxies } = get();
        const targets = proxies.filter((p) => proxySel.has(p.id));
        if (targets.length === 0) return;
        const lines = targets.map((p) => {
            const auth = p.username || p.password ? `${p.username}:${p.password}@` : "";
            const base = `${p.kind}://${auth}${p.host}:${p.port}`;
            const tag = p.country ? `  # country=${p.country}` : "";
            return base + tag;
        });
        const text = lines.join("\n");
        clip.write(text).then(
            () => toast.ok(`Copied ${targets.length} to clipboard`),
            (e) => toast.err("Copy failed: " + String(e)),
        );
    },
    // Import from clipboard (one per line, bulkExport format).
    bulkImportClipboard: async () => {
        try {
            const text = await clip.read();
            if (!text.trim()) { toast.err("Clipboard is empty"); return; }
            const n = await proxyBulkImport(text, "socks5");
            get().reload();
            toast.ok(`Imported ${n} prox${n === 1 ? "y" : "ies"}`);
        } catch (e) { toast.err("Import failed: " + String(e)); }
    },
    cleaning: false,
    checkAndClean: async () => {
        const proxies = get().proxies;
        if (proxies.length === 0) {
            toast.info("Không có proxy nào trong danh sách để kiểm tra.");
            return null;
        }
        if ((await confirmModal({
            title: "Check & Clean Proxies",
            message: `Kiểm tra HTTPS & chứng chỉ SSL của toàn bộ ${proxies.length} proxy. Các proxy bị lỗi (Tunnel Fail, Lỗi SSL, Timeout) sẽ TỰ ĐỘNG BỊ XÓA để bảo đảm trình duyệt không bị lỗi. Bạn có muốn tiếp tục?`,
            danger: true,
        })) !== true) {
            return null;
        }

        set({ cleaning: true });
        toast.info(`Đang kiểm tra HTTPS & SSL cho ${proxies.length} proxy...`);
        try {
            const report = await proxyCheckAndClean();
            await get().reload();
            if (report.removed > 0) {
                toast.ok(`Đã lọc xong: Giữ lại ${report.kept} proxy chuẩn 100%, đã xóa ${report.removed} proxy lỗi.`);
            } else {
                toast.ok(`Hoàn tất: Toàn bộ ${report.kept} proxy đều đạt chuẩn HTTPS 100%!`);
            }
            return report;
        } catch (e) {
            toast.err("Lỗi kiểm tra proxy: " + String(e));
            return null;
        } finally {
            set({ cleaning: false });
        }
    },
}))

