mod commands;
mod db;
mod engines;
mod repo;
mod services;
mod state;

use commands::agents::{
    delete_agent, get_agent_profile, import_agent, list_agents, list_skills, read_skill_content,
    set_skill_enabled, sync_agent_skills, upsert_agent, upsert_agent_profile, upsert_skills,
};
use commands::cli::{list_cli_engine_status, probe_cli_engines};
use commands::db::db_health;
use commands::orchestrate::{orchestrate, orchestrate_from_json};
use commands::overview::{get_overview_stats, get_overview_topology, list_running_queue};
use commands::sandbox::{sandbox_cancel, sandbox_run};
use commands::settings::{get_orchestrator_settings, update_orchestrator_settings};
use commands::system::{app_info, ping, reveal_in_finder};
use commands::tasks::{
    append_task_log, cancel_run, create_goal, create_task_run, dispatch_plan, get_task_run,
    insert_task_nodes, list_task_logs, list_task_runs, read_workspace_file, retry_node, save_plan,
    skip_node, start_run, update_node_status, update_run_progress,
};
use db::open_db;
use state::{DbState, RunState, SandboxState};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let conn = open_db().expect("failed to open AgentMind database");

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .manage(DbState::new(conn))
        .manage(SandboxState::new())
        .manage(RunState::new())
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
            probe_cli_engines,
            list_cli_engine_status,
            sandbox_run,
            sandbox_cancel,
            orchestrate,
            orchestrate_from_json,
            get_overview_stats,
            get_overview_topology,
            list_running_queue,
            create_goal,
            save_plan,
            create_task_run,
            insert_task_nodes,
            list_task_runs,
            get_task_run,
            update_node_status,
            append_task_log,
            list_task_logs,
            update_run_progress,
            dispatch_plan,
            start_run,
            cancel_run,
            retry_node,
            skip_node,
            read_workspace_file
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
