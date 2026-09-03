import { Button } from "@proxyshard/shardx-ui-kit";
import { useProxy } from "../../../entities/proxy";

function ShieldCheckIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className || "size-4"}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
      <path d="m9 12 2 2 4-4" />
    </svg>
  );
}

export function CheckCleanProxyButton() {
  const checkAndClean = useProxy((s) => s.checkAndClean);
  const cleaning = useProxy((s) => s.cleaning);
  const count = useProxy((s) => s.proxies.length);

  return (
    <Button
      variant="neutral"
      mode="stroke"
      size="small"
      disabled={cleaning || count === 0}
      leftIcon={<ShieldCheckIcon className="size-4 text-emerald-500" />}
      onClick={() => { checkAndClean(); }}
      title="Kiểm tra HTTPS & SSL của toàn bộ proxy, tự động xóa các proxy lỗi (Tunnel Fail, Lỗi SSL, Timeout)"
    >
      {cleaning ? "Checking..." : "Check & Clear"}
    </Button>
  );
}
