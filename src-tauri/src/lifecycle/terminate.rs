#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum TerminateReply {
    Cancel = 0,
    Now = 1,
}

pub(crate) fn reply_for(verdict: super::runtime::ExitVerdict) -> TerminateReply {
    match verdict {
        super::runtime::ExitVerdict::Allow => TerminateReply::Now,
        super::runtime::ExitVerdict::Prevent => TerminateReply::Cancel,
    }
}

#[cfg(target_os = "macos")]
mod imp {
    use std::ffi::CStr;
    use std::sync::OnceLock;

    use objc2::runtime::{AnyClass, AnyObject, Imp, Sel};
    use objc2::{msg_send, sel};
    use tauri::Manager;

    use super::{reply_for, TerminateReply};

    const SHOULD_TERMINATE_TYPES: &CStr = c"L@:@";
    static APP: OnceLock<tauri::AppHandle> = OnceLock::new();

    extern "C-unwind" fn should_terminate(
        _this: &AnyObject,
        _cmd: Sel,
        _sender: *mut AnyObject,
    ) -> usize {
        let Some(app) = APP.get() else {
            log::error!("lifecycle: applicationShouldTerminate called before install");
            return TerminateReply::Now as usize;
        };
        let state = app.state::<crate::AppState>();
        reply_for(state.lifecycle.exit_requested()) as usize
    }

    pub(crate) fn install(app: &tauri::AppHandle) {
        if APP.set(app.clone()).is_err() {
            return;
        }

        let Some(ns_application) = AnyClass::get(c"NSApplication") else {
            log::error!("lifecycle: NSApplication class unavailable");
            return;
        };
        let application: *mut AnyObject = unsafe { msg_send![ns_application, sharedApplication] };
        let delegate: *mut AnyObject = if application.is_null() {
            std::ptr::null_mut()
        } else {
            unsafe { msg_send![application, delegate] }
        };
        let Some(delegate) = (unsafe { delegate.as_ref() }) else {
            log::error!("lifecycle: NSApp has no delegate");
            return;
        };

        let class: *mut AnyClass = (delegate.class() as *const AnyClass).cast_mut();
        let imp: Imp = unsafe {
            std::mem::transmute::<extern "C-unwind" fn(&AnyObject, Sel, *mut AnyObject) -> usize, Imp>(
                should_terminate,
            )
        };
        let added = unsafe {
            objc2::ffi::class_addMethod(
                class,
                sel!(applicationShouldTerminate:),
                imp,
                SHOULD_TERMINATE_TYPES.as_ptr(),
            )
        };
        if added.as_bool() {
            log::info!("lifecycle: applicationShouldTerminate installed");
        } else {
            log::error!("lifecycle: applicationShouldTerminate already defined; install skipped");
        }
    }
}

#[cfg(not(target_os = "macos"))]
mod imp {
    pub(crate) fn install(_app: &tauri::AppHandle) {}
}

pub(crate) use imp::install;

#[cfg(test)]
mod tests {
    use super::super::runtime::ExitVerdict;
    use super::*;

    #[test]
    fn reply_for_maps_machine_verdicts() {
        assert_eq!(
            [
                reply_for(ExitVerdict::Allow),
                reply_for(ExitVerdict::Prevent),
            ],
            [TerminateReply::Now, TerminateReply::Cancel]
        );
    }
}
