import { BulkActionsBar, BuyProxiesButton, CheckCleanProxyButton, ImportProxyButton, NewProxyButton } from "../../features/manage-proxies";

export function ProxyToolbar() {
  return (
    <div className="flex items-center flex-none gap-2">
      <BulkActionsBar />
      <CheckCleanProxyButton />
      {/* Sits next to Import / New proxy so it's discoverable without a dialog. */}
      <BuyProxiesButton />
      <ImportProxyButton />
      <NewProxyButton />
    </div>
  );
}
