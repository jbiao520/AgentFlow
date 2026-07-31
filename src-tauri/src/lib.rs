mod commands;
mod db;
mod repo;
mod services;
mod state;

use commands::agents::{
    delete_agent, get_agent_profile, import_agent, list_agents, list_skills, read_skill_content,
    set_skill_enabled, sync_agent_skills, upsert_agent, upsert_agent_profile, upsert_skills,
};
use commands::db::db_health;
use commands::settings::{get_orchestrator_settings, update_orchestrator_settings};
use commands::system::{app_info, ping, reveal_in_finder};
use commands::tasks::{
    append_task_log, create_goal, create_task_run, get_task_run, insert_task_nodes, list_task_logs,
    list_task_runs, save_plan, update_node_status, update_run_progress,
};
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
            import_agent,
            upsert_agent,
            delete_agent,
            get_agent_profile,
            upsert_agent_profile,
            list_skills,
            upsert_skills,
            set_skill_enabled,
            sync_agent_skills,
            read_skill_content,
            get_orchestrator_settings,
            update_orchestrator_settings,
            create_goal,
            save_plan,
            create_task_run,
            insert_task_nodes,
            list_task_runs,
            get_task_run,
            update_node_status,
            append_task_log,
            list_task_logs,
            update_run_progress
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
