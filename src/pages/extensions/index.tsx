import { useEffect, useState, useMemo } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { openPath } from "@tauri-apps/plugin-opener";
import { Button, Input, Switch, cn } from "@proxyshard/shardx-ui-kit";
import { Topbar } from "../../shared/ui/Topbar";
import { CopyField } from "../../shared/ui/CopyField";
import Badge from "../../shared/ui/Badge";
import { toast } from "../../shared/model/toast";
import { confirmModal } from "../../shared/model/confirm";
import {
  NavExtensionsIcon,
  DeleteIcon,
  InfoIcon,
  RefreshIcon,
  FolderIcon,
} from "../../shared/icons";
import type { ExtensionInfo } from "../../entities/extension";
import {
  extensionList,
  extensionAdd,
  extensionToggle,
  extensionDelete,
  extensionReload,
  extensionDir,
} from "../../entities/extension";

function ExtensionDetailModal({
  ext,
  isReloading,
  onClose,
  onRemove,
  onToggle,
  onReload,
}: {
  ext: ExtensionInfo;
  isReloading: boolean;
  onClose: () => void;
  onRemove: (id: string, name: string) => void;
  onToggle: (id: string, enabled: boolean) => void;
  onReload: (ext: ExtensionInfo, overrideSource?: string) => Promise<void>;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs" onClick={onClose}>
      <div
        className="w-full max-w-lg rounded-xl bg-bg-white-0 p-6 shadow-xl ring-1 ring-stroke-soft-200"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="mb-4 flex items-start justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="flex size-11 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-bg-weak-50 ring-1 ring-inset ring-stroke-soft-200">
              {ext.icon_base64 ? (
                <img src={ext.icon_base64} alt={ext.name} className="size-full object-contain" />
              ) : (
                <NavExtensionsIcon className="size-6 text-text-soft-400" />
              )}
            </div>
            <div>
              <h2 className="text-label-md font-semibold text-text-strong-950">{ext.name}</h2>
              <div className="flex items-center gap-2 text-paragraph-xs text-text-soft-400">
                <span>v{ext.version}</span>
                <span>•</span>
                <span className="font-mono text-text-sub-600">{ext.id}</span>
              </div>
            </div>
          </div>
          <button
            type="button"
            className="flex size-8 items-center justify-center rounded-md text-text-soft-400 hover:bg-bg-weak-50 hover:text-text-strong-950"
            onClick={onClose}
          >
            ✕
          </button>
        </header>

        <div className="flex flex-col gap-4 text-paragraph-xs">
          {ext.description && (
            <div>
              <span className="text-label-xs font-medium text-text-sub-600">Description</span>
              <p className="mt-1 text-text-strong-950">{ext.description}</p>
            </div>
          )}

          <div>
            <span className="text-label-xs font-medium text-text-sub-600">Extension ID</span>
            <div className="mt-1">
              <CopyField value={ext.id} />
            </div>
          </div>

          <div>
            <span className="text-label-xs font-medium text-text-sub-600">Installed Location</span>
            <div className="mt-1 flex items-center gap-2">
              <div className="flex-1">
                <CopyField value={ext.path} />
              </div>
              <Button
                variant="neutral"
                mode="stroke"
                size="small"
                title="Open installed folder in Explorer"
                onClick={() => openPath(ext.path).catch((e) => toast.err(String(e)))}
              >
                <FolderIcon className="size-3.5" />
                Open
              </Button>
            </div>
          </div>

          <div>
            <span className="text-label-xs font-medium text-text-sub-600">Development Source Folder</span>
            <div className="mt-1 flex items-center gap-2">
              <div className="flex-1">
                <CopyField value={ext.source_path || "Not linked"} />
              </div>
              {ext.source_path && (
                <Button
                  variant="neutral"
                  mode="stroke"
                  size="small"
                  title="Open source folder in Explorer"
                  onClick={() => openPath(ext.source_path!).catch((e) => toast.err(String(e)))}
                >
                  <FolderIcon className="size-3.5" />
                  Open
                </Button>
              )}
              <Button
                variant="neutral"
                mode="stroke"
                size="small"
                title="Select or change development source folder"
                onClick={async () => {
                  const selected = await open({
                    directory: true,
                    multiple: false,
                    title: `Select source folder for "${ext.name}" (containing manifest.json)`,
                  });
                  if (typeof selected === "string") {
                    onReload(ext, selected);
                  }
                }}
              >
                Change...
              </Button>
            </div>
            <p className="mt-1 text-[11px] text-text-soft-400">
              When updating extension code in your development folder, click Reload to sync updates into ShardBrowser.
            </p>
          </div>

          {ext.permissions && ext.permissions.length > 0 && (
            <div>
              <span className="text-label-xs font-medium text-text-sub-600">Permissions</span>
              <div className="mt-1.5 flex flex-wrap gap-1.5">
                {ext.permissions.map((p: string) => (
                  <Badge key={p} size="small" color="gray" variant="light">
                    {p}
                  </Badge>
                ))}
              </div>
            </div>
          )}

          <div className="mt-3 flex items-center justify-between border-t border-stroke-soft-200 pt-4">
            <div className="flex items-center gap-2.5">
              <span className="text-label-xs font-medium text-text-strong-950">Status:</span>
              <Switch
                checked={ext.enabled}
                onChange={(checked: boolean) => onToggle(ext.id, checked)}
              />
              <span className="text-label-xs text-text-soft-400">
                {ext.enabled ? "Enabled" : "Disabled"}
              </span>
            </div>

            <div className="flex items-center gap-2">
              <Button
                variant="primary"
                mode="stroke"
                size="small"
                disabled={isReloading}
                onClick={() => onReload(ext)}
              >
                <RefreshIcon className={cn("size-3.5", isReloading && "animate-spin")} />
                Reload
              </Button>
              <Button
                variant="error"
                mode="stroke"
                size="small"
                onClick={() => {
                  onClose();
                  onRemove(ext.id, ext.name);
                }}
              >
                Remove
              </Button>
              <Button variant="neutral" mode="stroke" size="small" onClick={onClose}>
                Close
              </Button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export function ExtensionsPage() {
  const [extensions, setExtensions] = useState<ExtensionInfo[]>([]);
  const [loading, setLoading] = useState(false);
  const [reloadingId, setReloadingId] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [detailExt, setDetailExt] = useState<ExtensionInfo | null>(null);

  const load = () => {
    extensionList()
      .then(setExtensions)
      .catch((e) => toast.err(String(e)));
  };

  useEffect(() => {
    load();
  }, []);

  const add = async () => {
    try {
      const selected = await open({
        directory: true,
        multiple: false,
        title: "Select Unpacked Chrome Extension Folder (containing manifest.json)",
      });
      if (typeof selected !== "string") return;
      setLoading(true);
      const added = await extensionAdd(selected);
      toast.ok(`Extension "${added.name}" added successfully`);
      load();
    } catch (e) {
      toast.err(String(e));
    } finally {
      setLoading(false);
    }
  };

  const reloadExtension = async (ext: ExtensionInfo, overrideSource?: string) => {
    try {
      setReloadingId(ext.id);
      let targetSource = overrideSource;

      if (!targetSource && !ext.source_path) {
        const selected = await open({
          directory: true,
          multiple: false,
          title: `Select Source Folder for "${ext.name}" (containing manifest.json)`,
        });
        if (typeof selected !== "string") {
          setReloadingId(null);
          return;
        }
        targetSource = selected;
      }

      try {
        const updated = await extensionReload(ext.id, targetSource);
        setExtensions((prev: ExtensionInfo[]) =>
          prev.map((e) => (e.id === ext.id ? updated : e))
        );
        if (detailExt?.id === ext.id) {
          setDetailExt(updated);
        }
        toast.ok(`Extension "${updated.name}" reloaded to v${updated.version}! (Restart browser profiles to apply)`);
      } catch (err: any) {
        const msg = String(err);
        if (msg.includes("NO_SOURCE_PATH") || msg.includes("Source folder") || msg.includes("not exist")) {
          const selected = await open({
            directory: true,
            multiple: false,
            title: `Select Source Folder for "${ext.name}" (containing manifest.json)`,
          });
          if (typeof selected === "string") {
            const updated = await extensionReload(ext.id, selected);
            setExtensions((prev: ExtensionInfo[]) =>
              prev.map((e) => (e.id === ext.id ? updated : e))
            );
            if (detailExt?.id === ext.id) {
              setDetailExt(updated);
            }
            toast.ok(`Linked & reloaded "${updated.name}" (v${updated.version})!`);
          }
        } else {
          toast.err(msg);
        }
      }
    } catch (e) {
      toast.err(String(e));
    } finally {
      setReloadingId(null);
    }
  };

  const toggle = async (id: string, enabled: boolean) => {
    try {
      await extensionToggle(id, enabled);
      setExtensions((prev: ExtensionInfo[]) =>
        prev.map((e) => (e.id === id ? { ...e, enabled } : e))
      );
      toast.ok(enabled ? "Extension enabled" : "Extension disabled");
      if (detailExt?.id === id) {
        setDetailExt((prev) => (prev ? { ...prev, enabled } : null));
      }
    } catch (e) {
      toast.err(String(e));
    }
  };

  const remove = async (id: string, name: string) => {
    const ok = await confirmModal({
      title: "Remove Extension",
      message: `Are you sure you want to remove extension "${name}"? It will no longer be loaded into browser profiles.`,
      danger: true,
    });
    if (!ok) return;

    try {
      await extensionDelete(id);
      toast.ok(`Extension "${name}" removed`);
      load();
    } catch (e) {
      toast.err(String(e));
    }
  };

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return extensions;
    return extensions.filter(
      (e) =>
        e.name.toLowerCase().includes(q) ||
        e.id.toLowerCase().includes(q) ||
        (e.description && e.description.toLowerCase().includes(q))
    );
  }, [extensions, search]);

  const activeCount = extensions.filter((e) => e.enabled).length;

  return (
    <section className="flex flex-col">
      <Topbar crumbs={["Library", "Extensions"]} search={search} onSearch={setSearch} />
      
      <div className="mb-3.5 flex items-end justify-between gap-4">
        <div>
          <h1 className="m-0 text-title-h5 text-text-strong-950">Developer Extensions</h1>
          <p className="m-0 mt-1 text-paragraph-xs text-text-soft-400">
            Unpacked Chrome extensions installed here are loaded into your browser profiles (via <code>--load-extension</code>).
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="neutral"
            mode="stroke"
            size="small"
            title="Open extensions library folder in Explorer"
            onClick={async () => {
              try {
                const dir = await extensionDir();
                await openPath(dir);
              } catch (e) {
                toast.err(String(e));
              }
            }}
          >
            <FolderIcon className="size-3.5" />
            Open Folder
          </Button>

          <Button
            variant="neutral"
            mode="stroke"
            size="small"
            title="Refresh extension list"
            onClick={() => {
              load();
              toast.ok("Extensions list refreshed");
            }}
          >
            <RefreshIcon className="size-3.5" />
            Refresh
          </Button>

          <Button
            variant="primary"
            mode="filled"
            size="small"
            disabled={loading}
            onClick={add}
          >
            + Add Extension Folder
          </Button>
        </div>
      </div>

      {/* Metrics Bar */}
      <div className="mb-4 flex items-center gap-3">
        <Badge color="gray" size="medium" variant="light">
          Total: <strong className="ml-1 text-text-strong-950">{extensions.length}</strong>
        </Badge>
        <Badge color={activeCount > 0 ? "success" : "gray"} size="medium" variant="light">
          Active: <strong className="ml-1 text-text-strong-950">{activeCount}</strong>
        </Badge>
      </div>

      {/* Search Bar if items > 0 */}
      {extensions.length > 0 && (
        <div className="mb-4 max-w-md">
          <Input
            inputSize="small"
            placeholder="Search extensions by name, ID or description…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
      )}

      {/* Extensions Grid */}
      {filtered.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-stroke-soft-200 bg-bg-white-0 py-12 px-6 text-center">
          <div className="flex size-14 items-center justify-center rounded-full bg-bg-weak-50 text-icon-soft-400 ring-1 ring-stroke-soft-200">
            <NavExtensionsIcon className="size-7" />
          </div>
          <h3 className="mt-3 text-label-md font-semibold text-text-strong-950">
            {extensions.length === 0 ? "No extensions installed yet" : "No matching extensions found"}
          </h3>
          <p className="mt-1 max-w-md text-paragraph-xs text-text-soft-400">
            {extensions.length === 0
              ? "Add any unpacked Chrome extension folder containing a valid manifest.json file. It will be copied to your library and injected when browsers launch."
              : "Try searching with a different keyword."}
          </p>
          {extensions.length === 0 && (
            <div className="mt-4">
              <Button variant="primary" mode="filled" size="small" onClick={add} disabled={loading}>
                + Select Extension Folder
              </Button>
            </div>
          )}
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-3.5 md:grid-cols-2 xl:grid-cols-3">
          {filtered.map((ext) => (
            <div
              key={ext.id}
              className={cn(
                "flex flex-col justify-between rounded-xl bg-bg-white-0 p-4 shadow-[var(--shadow-xs)] ring-1 ring-inset ring-stroke-soft-200 transition-all",
                !ext.enabled && "opacity-60"
              )}
            >
              <div>
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="flex size-10 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-bg-weak-50 ring-1 ring-inset ring-stroke-soft-200">
                      {ext.icon_base64 ? (
                        <img src={ext.icon_base64} alt={ext.name} className="size-full object-contain" />
                      ) : (
                        <NavExtensionsIcon className="size-5 text-text-soft-400" />
                      )}
                    </div>
                    <div className="min-w-0">
                      <div className="flex items-center gap-1.5">
                        <span className="truncate text-label-sm font-semibold text-text-strong-950" title={ext.name}>
                          {ext.name}
                        </span>
                        <Badge size="small" color="gray" variant="light">
                          v{ext.version}
                        </Badge>
                      </div>
                      <span className="font-mono text-[11px] text-text-sub-600 truncate block" title={ext.id}>
                        {ext.id}
                      </span>
                    </div>
                  </div>

                  <Switch
                    checked={ext.enabled}
                    onChange={(checked: boolean) => toggle(ext.id, checked)}
                    title={ext.enabled ? "Click to disable" : "Click to enable"}
                  />
                </div>

                {ext.description && (
                  <p className="mt-2.5 line-clamp-2 text-paragraph-xs text-text-sub-600">
                    {ext.description}
                  </p>
                )}
              </div>

              <div className="mt-4 flex items-center justify-between border-t border-stroke-soft-200 pt-3 text-paragraph-xs">
                <button
                  type="button"
                  className="flex items-center gap-1 text-primary-base hover:underline font-medium cursor-pointer"
                  onClick={() => setDetailExt(ext)}
                >
                  <InfoIcon className="size-3.5" />
                  Inspect details
                </button>

                <div className="flex items-center gap-3">
                  <button
                    type="button"
                    disabled={reloadingId === ext.id}
                    className="flex items-center gap-1 text-text-sub-600 hover:text-text-strong-950 font-medium cursor-pointer disabled:opacity-50"
                    title={ext.source_path ? `Reload from: ${ext.source_path}` : "Select source folder & reload"}
                    onClick={() => reloadExtension(ext)}
                  >
                    <RefreshIcon className={cn("size-3.5", reloadingId === ext.id && "animate-spin")} />
                    Reload
                  </button>

                  <button
                    type="button"
                    className="flex items-center gap-1 text-error-base hover:text-error-hover font-medium cursor-pointer"
                    onClick={() => remove(ext.id, ext.name)}
                  >
                    <DeleteIcon className="size-3.5" />
                    Remove
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {detailExt && (
        <ExtensionDetailModal
          ext={detailExt}
          isReloading={reloadingId === detailExt.id}
          onClose={() => setDetailExt(null)}
          onRemove={remove}
          onToggle={toggle}
          onReload={reloadExtension}
        />
      )}
    </section>
  );
}
