use std::sync::OnceLock;

use objc2::runtime::{AnyClass, AnyObject, Imp, Sel};
use objc2::{class, msg_send, sel};

type Hold = Box<dyn Fn() -> bool + Send + Sync>;

static HOLD: OnceLock<Hold> = OnceLock::new();

const TERMINATE_CANCEL: usize = 0;
const TERMINATE_NOW: usize = 1;

unsafe extern "C-unwind" fn should_terminate(_this: *mut AnyObject, _cmd: Sel, _sender: *mut AnyObject) -> usize {
    match HOLD.get() {
        Some(hold) if hold() => TERMINATE_CANCEL,
        _ => TERMINATE_NOW,
    }
}

pub fn install(hold: impl Fn() -> bool + Send + Sync + 'static) -> bool {
    if HOLD.set(Box::new(hold)).is_err() {
        return false;
    }
    unsafe {
        let app: *mut AnyObject = msg_send![class!(NSApplication), sharedApplication];
        if app.is_null() {
            return false;
        }
        let delegate: *mut AnyObject = msg_send![app, delegate];
        if delegate.is_null() {
            return false;
        }
        let cls = (*delegate).class() as *const AnyClass as *mut AnyClass;
        let imp: Imp = std::mem::transmute(
            should_terminate as unsafe extern "C-unwind" fn(*mut AnyObject, Sel, *mut AnyObject) -> usize,
        );
        objc2::ffi::class_addMethod(cls, sel!(applicationShouldTerminate:), imp, c"Q@:@".as_ptr()).as_bool()
    }
}
