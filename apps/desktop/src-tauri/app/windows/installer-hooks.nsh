; Nibbin NSIS installer hooks (Tauri v2 `bundle.windows.nsis.installerHooks`).
;
; PRIVACY-CRITICAL (0.2.5): the capture daemon `observerd.exe` is an independent
; process (registered for autostart under HKCU\...\Run\NibbinObserver and spawned
; detached by the app). NSIS removes files on uninstall and lays down new binaries
; on install/upgrade, but it does NOT touch a running process. Without these hooks:
;   - Uninstall leaves an orphaned `observerd.exe` capturing under the OLD rules.
;   - Upgrade-over-running fails with "Error opening file for writing" (the daemon
;     binary is locked) OR leaves the old daemon alive alongside the new one.
;   - The HKCU autostart entry survives uninstall and re-launches the daemon at
;     next login from a path that may no longer exist.
;
; These hooks stop the daemon BEFORE any file/registry mutation, and clear the
; autostart entry on uninstall. They are the installer-side half of the
; defense-in-depth model (the app kills the daemon on exit; the daemon self-exits
; via its own watchdog) — any one of the three is sufficient on its own.

; Kill any running capture daemon. `/F` forces, `/IM` matches by image name so we
; catch an orphaned older-version daemon too. `/T` also kills child processes
; (e.g. the Presidio NER sidecar) so nothing is left holding a file handle.
; nsExec::Exec runs silently (no console flash) and never aborts the installer if
; the process isn't running (taskkill exits non-zero — we ignore it on purpose).
!macro NIBBIN_KILL_OBSERVERD
  DetailPrint "Stopping Nibbin capture daemon (observerd)..."
  nsExec::Exec 'taskkill /F /T /IM observerd.exe'
  Pop $0 ; discard exit code: absent process => non-zero, which is fine
!macroend

!macro NSIS_HOOK_PREINSTALL
  ; Stop the daemon (and, defensively, the app) BEFORE laying down new binaries,
  ; so an install/upgrade over a running 0.2.3/0.2.4 cannot fail on a locked file
  ; or orphan the old daemon.
  !insertmacro NIBBIN_KILL_OBSERVERD
  nsExec::Exec 'taskkill /F /IM Nibbin.exe'
  Pop $0
!macroend

!macro NSIS_HOOK_POSTINSTALL
!macroend

!macro NSIS_HOOK_PREUNINSTALL
  ; Stop the daemon BEFORE file removal so uninstall actually stops capture
  ; (NSIS would otherwise delete the binary while the process keeps running in
  ; memory — the reported "fresh install still watching" privacy bug).
  !insertmacro NIBBIN_KILL_OBSERVERD
  ; Remove the autostart entry the daemon supervisor registered (it is never
  ; cleaned otherwise, and would relaunch observerd at next login).
  DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "NibbinObserver"
!macroend

!macro NSIS_HOOK_POSTUNINSTALL
!macroend
