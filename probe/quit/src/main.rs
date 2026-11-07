#[cfg(target_os = "macos")]
mod mac_terminate;
#[cfg(target_os = "macos")]
use std::sync::atomic::{AtomicUsize, Ordering};
use tauri::menu::{Menu, MenuItem, MenuItemKind, PredefinedMenuItem, Submenu};
use tauri::RunEvent;

fn replace(submenu: &Submenu<tauri::Wry>, item: &MenuItem<tauri::Wry>, label: &str) -> tauri::Result<usize> {
    let mut replaced = 0;
    for (index, child) in submenu.items()?.iter().enumerate() {
        match child {
            MenuItemKind::Predefined(p) if p.text()? == label => {
                submenu.remove(p)?;
                submenu.insert(item, index)?;
                replaced += 1;
            }
            MenuItemKind::Submenu(inner) => replaced += replace(inner, item, label)?,
            _ => {}
        }
    }
    Ok(replaced)
}

fn main() {
    let mode = std::env::var("PROBE_MODE").unwrap_or_default();
    tauri::Builder::default()
        .setup(move |app| {
            let handle = app.handle();
            let menu = Menu::default(handle)?;
            if mode == "custom" {
                let label = PredefinedMenuItem::quit(handle, None)?.text()?;
                println!("PROBE predefined quit label: {label}");
                let quit = MenuItem::with_id(handle, "probe-quit", &label, true, Some("CmdOrCtrl+Q"))?;
                let mut n = 0;
                for item in menu.items()? {
                    if let MenuItemKind::Submenu(s) = item {
                        n += replace(&s, &quit, &label)?;
                    }
                }
                println!("PROBE replaced {n}");
            }
            #[cfg(target_os = "macos")]
            if mode == "terminate" {
                static ASKED: AtomicUsize = AtomicUsize::new(0);
                let h = handle.clone();
                let ok = mac_terminate::install(move || {
                    let n = ASKED.fetch_add(1, Ordering::SeqCst) + 1;
                    println!("PROBE should-terminate asked {n}");
                    if n == 1 {
                        let h = h.clone();
                        std::thread::spawn(move || {
                            std::thread::sleep(std::time::Duration::from_secs(3));
                            println!("PROBE confirmed, exiting");
                            h.exit(0);
                        });
                        println!("PROBE held");
                        true
                    } else {
                        false
                    }
                });
                println!("PROBE hook installed {ok}");
                let h = handle.clone();
                std::thread::spawn(move || {
                    std::thread::sleep(std::time::Duration::from_secs(8));
                    let _ = h.run_on_main_thread(|| unsafe {
                        use objc2::runtime::AnyObject;
                        let app: *mut AnyObject = objc2::msg_send![objc2::class!(NSApplication), sharedApplication];
                        println!("PROBE sending terminate:");
                        let _: () = objc2::msg_send![app, terminate: std::ptr::null_mut::<AnyObject>()];
                    });
                });
            }
            app.set_menu(menu)?;
            app.on_menu_event(|app, event| {
                if event.id().as_ref() == "probe-quit" {
                    println!("PROBE quit chosen from the menu");
                    app.exit(0);
                }
            });
            tauri::WebviewWindowBuilder::new(app, "main", tauri::WebviewUrl::App("index.html".into())).build()?;
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("build")
        .run(|_, event| match event {
            RunEvent::ExitRequested { code, .. } => println!("PROBE ExitRequested {code:?}"),
            RunEvent::Exit => println!("PROBE Exit"),
            _ => {}
        });
}
