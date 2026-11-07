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
