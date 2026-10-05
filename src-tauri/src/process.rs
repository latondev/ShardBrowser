// Tracker for launched ShardX child processes; keyed by profile_id.

use anyhow::Result;
use std::collections::HashMap;
use std::sync::Mutex;
use std::time::Instant;
use tokio::process::Child;

pub struct Tracker {
    inner: Mutex<HashMap<String, ChildEntry>>,
}

struct ChildEntry {
    pid: u32,
    killer: tokio::sync::mpsc::Sender<()>,
    /// Set once DevToolsActivePort is read; None for UI launches.
    cdp: Option<CdpInfo>,
    /// Process start; serialised as elapsed ms in RunningProfile.
    started_at: Instant,
}

/// CDP endpoint for an API-launched profile.
#[derive(Debug, Clone, serde::Serialize)]
pub struct CdpInfo {
    pub port: u16,
    pub http_url: String,
    /// ws://127.0.0.1:<port>/devtools/browser/<id> for Puppeteer/Playwright.
    pub web_socket_debugger_url: String,
}

impl Tracker {
    pub fn new() -> Self {
        Self {
            inner: Mutex::new(HashMap::new()),
        }
    }

    /// Take a spawned child + monitor it; entry removed on exit/kill.
    pub fn track(
        self: &'static Self,
        profile_id: String,
        mut child: Child,
        temporary: bool,
        headless: bool,
    ) -> u32 {
        let pid = child.id().unwrap_or(0);
        let (tx, mut rx) = tokio::sync::mpsc::channel::<()>(1);

        {
            let mut g = self.inner.lock().unwrap();
            g.insert(
                profile_id.clone(),
                ChildEntry { pid, killer: tx, cdp: None, started_at: Instant::now() },
            );
        }

        let started_at = Instant::now();
        tokio::spawn(async move {
            let mut check_interval = tokio::time::interval(std::time::Duration::from_millis(1500));
            check_interval.tick().await; // First tick fires immediately, skip it

            let mut elapsed_checks: u32 = 0;
            let mut no_window_streak: u32 = 0;
            let mut saw_window_once = false;

            loop {
                tokio::select! {
                    res = child.wait() => {
                        let _ = res;
                        break;
                    }
                    _ = rx.recv() => {
                        Self::terminate_child(&mut child, pid).await;
                        break;
                    }
                    _ = check_interval.tick() => {
                        elapsed_checks += 1;
                        if !headless {
                            #[cfg(windows)]
                            {
                                let has_window = win_util::has_active_browser_window(pid);
                                if has_window {
                                    saw_window_once = true;
                                    no_window_streak = 0;
                                } else {
                                    // If window was active before or grace period elapsed (6s = 4 ticks),
                                    // check if the browser GUI has been closed by the user.
                                    if saw_window_once || elapsed_checks >= 4 {
                                        no_window_streak += 1;
                                        if no_window_streak >= 2 {
                                            eprintln!("[launcher] Profile {profile_id} (PID {pid}): browser window closed; stopping background process");
                                            Self::terminate_child(&mut child, pid).await;
                                            break;
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
            }

            if let Ok(mut g) = Self::shared().inner.lock() {
                g.remove(&profile_id);
            }
            // Bump the persisted total runtime; non-temporary only (temp
            // profiles get deleted next line so their counter is moot).
            if !temporary {
                let elapsed_ms = started_at.elapsed().as_millis() as u64;
                if let Err(e) = crate::profile::add_runtime(&profile_id, elapsed_ms) {
                    eprintln!("[launcher] add_runtime({profile_id}) failed: {e}");
                }
            }
            // Tear down temporary profile (config + udd) on close.
            if temporary {
                match crate::profile::delete(&profile_id) {
                    Ok(()) => eprintln!("[launcher] temporary profile {profile_id} deleted on close"),
                    Err(e) => eprintln!("[launcher] temporary profile {profile_id} cleanup failed: {e}"),
                }
            }

            // Cleanup any remaining orphaned child processes (GPU / renderer / utility)
            #[cfg(windows)]
            {
                use std::os::windows::process::CommandExt;
                let _ = std::process::Command::new("taskkill")
                    .args(["/F", "/T", "/PID", &pid.to_string()])
                    .creation_flags(0x08000000)
                    .stdout(std::process::Stdio::null())
                    .stderr(std::process::Stdio::null())
                    .status();
            }

            // Emit profile-stopped event to Tauri frontend so UI updates immediately
            if let Some(w) = crate::main_window() {
                use tauri::Emitter;
                let _ = w.emit("profile-stopped", &profile_id);
            }
            crate::notify_store_changed("profiles");
        });

        pid
    }

    async fn terminate_child(child: &mut Child, _pid: u32) {
        #[cfg(unix)]
        {
            if let Some(p) = child.id() {
                // SAFETY: libc::kill on a child pid we own.
                unsafe { libc::kill(p as libc::pid_t, libc::SIGTERM); }
            }
        }
        #[cfg(windows)]
        {
            use std::os::windows::process::CommandExt;
            if let Some(p) = child.id() {
                // taskkill /PID without /F posts WM_CLOSE for clean shutdown.
                // 0x08000000 = CREATE_NO_WINDOW — suppress the console flash.
                let _ = std::process::Command::new("taskkill")
                    .args(["/PID", &p.to_string()])
                    .creation_flags(0x08000000)
                    .stdout(std::process::Stdio::null())
                    .stderr(std::process::Stdio::null())
                    .status();
            }
        }
        let graceful = tokio::time::timeout(
            std::time::Duration::from_secs(3),
            child.wait(),
        ).await;
        if graceful.is_err() {
            let _ = child.kill().await;
            let _ = child.wait().await;
        }
    }

    /// Attach CDP to a tracked profile; no-op if the profile already exited.
    pub fn set_cdp(&self, profile_id: &str, cdp: CdpInfo) {
        if let Ok(mut g) = self.inner.lock() {
            if let Some(e) = g.get_mut(profile_id) {
                e.cdp = Some(cdp);
            }
        }
    }

    /// CDP endpoint when the profile was launched with remote debugging.
    pub fn cdp(&self, profile_id: &str) -> Option<CdpInfo> {
        self.inner.lock().ok()?.get(profile_id)?.cdp.clone()
    }

    pub fn running(&self) -> Vec<RunningProfile> {
        let g = self.inner.lock().unwrap();
        g.iter()
            .map(|(id, e)| RunningProfile {
                profile_id: id.clone(),
                pid: e.pid,
                cdp: e.cdp.clone(),
                uptime_ms: e.started_at.elapsed().as_millis() as u64,
            })
            .collect()
    }

    pub async fn kill(&self, profile_id: &str) -> Result<bool> {
        let killer = {
            let g = self.inner.lock().unwrap();
            g.get(profile_id).map(|e| e.killer.clone())
        };
        if let Some(k) = killer {
            let _ = k.send(()).await;
            Ok(true)
        } else {
            Ok(false)
        }
    }

    pub fn shared() -> &'static Tracker {
        static INSTANCE: std::sync::OnceLock<Tracker> = std::sync::OnceLock::new();
        INSTANCE.get_or_init(Tracker::new)
    }
}

#[derive(Debug, Clone, serde::Serialize)]
pub struct RunningProfile {
    pub profile_id: String,
    pub pid: u32,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub cdp: Option<CdpInfo>,
    /// Milliseconds since the engine was spawned; frontend formats as
    /// "1h 23m" / "12m 30s" / "45s".
    pub uptime_ms: u64,
}

#[cfg(windows)]
mod win_util {
    use std::sync::atomic::{AtomicBool, Ordering};
    use std::sync::Arc;

    type HWND = *mut std::ffi::c_void;
    type BOOL = i32;
    type LPARAM = isize;
    type DWORD = u32;

    #[repr(C)]
    struct RECT {
        left: i32,
        top: i32,
        right: i32,
        bottom: i32,
    }

    extern "system" {
        fn EnumWindows(
            lp_enum_func: Option<unsafe extern "system" fn(HWND, LPARAM) -> BOOL>,
            l_param: LPARAM,
        ) -> BOOL;
        fn GetWindowThreadProcessId(h_wnd: HWND, lpdw_process_id: *mut DWORD) -> DWORD;
        fn IsWindowVisible(h_wnd: HWND) -> BOOL;
        fn GetClassNameW(h_wnd: HWND, lp_class_name: *mut u16, n_max_count: i32) -> i32;
        fn GetWindowRect(h_wnd: HWND, lp_rect: *mut RECT) -> BOOL;
    }

    struct EnumContext {
        target_pid: u32,
        found: Arc<AtomicBool>,
    }

    unsafe extern "system" fn enum_proc(hwnd: HWND, lparam: LPARAM) -> BOOL {
        let ctx = &*(lparam as *const EnumContext);
        let mut proc_id: DWORD = 0;
        GetWindowThreadProcessId(hwnd, &mut proc_id);
        if proc_id == ctx.target_pid {
            if IsWindowVisible(hwnd) != 0 {
                let mut class_buf = [0u16; 256];
                let len = GetClassNameW(hwnd, class_buf.as_mut_ptr(), 256);
                if len > 0 {
                    let class_name = String::from_utf16_lossy(&class_buf[..len as usize]);
                    if class_name == "Chrome_WidgetWin_1" {
                        let mut rect = RECT {
                            left: 0,
                            top: 0,
                            right: 0,
                            bottom: 0,
                        };
                        if GetWindowRect(hwnd, &mut rect) != 0 {
                            let width = rect.right - rect.left;
                            let height = rect.bottom - rect.top;
                            // Visible interactive browser window with substantial size
                            if width > 50 && height > 50 {
                                ctx.found.store(true, Ordering::SeqCst);
                                return 0; // stop enumeration
                            }
                        }
                    }
                }
            }
        }
        1 // continue enumeration
    }

    pub fn has_active_browser_window(pid: u32) -> bool {
        let found = Arc::new(AtomicBool::new(false));
        let ctx = EnumContext {
            target_pid: pid,
            found: found.clone(),
        };
        unsafe {
            EnumWindows(Some(enum_proc), &ctx as *const _ as LPARAM);
        }
        found.load(Ordering::SeqCst)
    }
}

