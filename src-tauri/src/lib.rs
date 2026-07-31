mod commands;
mod db;
mod state;

use commands::db::db_health;
use commands::system::{app_info, ping, reveal_in_finder};
use db::open_db;
use state::DbState;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let conn = open_db().expect("failed to open AgentMind database");

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .manage(DbState::new(conn))
        .invoke_handler(tauri::generate_handler![
            ping,
            app_info,
            reveal_in_finder,
            db_health
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
