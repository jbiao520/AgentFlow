mod commands;
mod db;
mod repo;
mod state;

use commands::agents::{
    delete_agent, get_agent_profile, list_agents, list_skills, set_skill_enabled, upsert_agent,
    upsert_agent_profile, upsert_skills,
};
use commands::db::db_health;
use commands::settings::{get_orchestrator_settings, update_orchestrator_settings};
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
            db_health,
            list_agents,
            upsert_agent,
            delete_agent,
            get_agent_profile,
            upsert_agent_profile,
            list_skills,
            upsert_skills,
            set_skill_enabled,
            get_orchestrator_settings,
            update_orchestrator_settings
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
