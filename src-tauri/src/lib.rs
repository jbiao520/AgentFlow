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
use commands::cli::{list_cli_engine_status, list_engine_models, probe_cli_engines};
use commands::db::db_health;
use commands::orchestrate::{confirm_plan_answers, orchestrate, orchestrate_from_json};
use commands::overview::{get_overview_stats, list_recent_agents, list_running_queue};
use commands::sandbox::{sandbox_cancel, sandbox_run};
use commands::schedules::{
    create_schedule_cmd, delete_schedule_cmd, get_schedule_cmd, list_schedule_runs,
    list_schedules,
    run_schedule_now_cmd, set_schedule_enabled_cmd, update_schedule_cmd,
};
use commands::settings::{get_orchestrator_settings, update_orchestrator_settings};
use commands::system::{app_info, ping, reveal_in_finder};
use commands::tasks::{
    append_task_log, cancel_run, clear_task_runs, create_goal, create_task_run, delete_task_run,
    dispatch_plan, get_task_run, insert_task_nodes, list_task_logs, list_task_runs,
    read_workspace_file, reveal_workspace_artifact, retry_node, retry_run, save_plan, skip_node, start_run,
    update_node_status, update_run_progress,
};
use commands::templates::{
    create_template_cmd, delete_template_cmd, duplicate_template_cmd, get_template_cmd,
    instantiate_template, list_templates, polish_template, update_template_cmd,
};
use db::open_db;
use services::notify::request_notification_permission;
use services::recovery::interrupt_orphaned_runs;
use services::scheduler::start_scheduler;
use state::{DbState, RunState, SandboxState};
use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let conn = open_db().expect("failed to open AgentFlow database");
    match interrupt_orphaned_runs(&conn) {
        Ok(n) if n > 0 => {
            eprintln!("[AgentFlow] interrupted {n} orphaned task run(s) left from previous session");
        }
        Ok(_) => {}
        Err(e) => {
            eprintln!("[AgentFlow] failed to interrupt orphaned runs: {e}");
        }
    }

    let db_state = DbState::new(conn);
    let run_state = RunState::new();

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_notification::init())
        .manage(SandboxState::new())
        .manage(db_state)
        .manage(run_state)
        .setup(|app| {
            let handle = app.handle().clone();
            let db = app.state::<DbState>().conn_arc();
            let cancels = app.state::<RunState>().cancels_arc();
            start_scheduler(handle, db, cancels);
            request_notification_permission(app.handle());
            Ok(())
        })
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
            list_engine_models,
            sandbox_run,
            sandbox_cancel,
            orchestrate,
            orchestrate_from_json,
            confirm_plan_answers,
            get_overview_stats,
            list_recent_agents,
            list_running_queue,
            create_goal,
            save_plan,
            create_task_run,
            insert_task_nodes,
            list_task_runs,
            get_task_run,
            delete_task_run,
            clear_task_runs,
            update_node_status,
            append_task_log,
            list_task_logs,
            update_run_progress,
            dispatch_plan,
            start_run,
            cancel_run,
            retry_node,
            retry_run,
            skip_node,
            read_workspace_file,
            reveal_workspace_artifact,
            list_templates,
            get_template_cmd,
            polish_template,
            create_template_cmd,
            update_template_cmd,
            delete_template_cmd,
            duplicate_template_cmd,
            instantiate_template,
            list_schedules,
            list_schedule_runs,
            get_schedule_cmd,
            create_schedule_cmd,
            update_schedule_cmd,
            delete_schedule_cmd,
            set_schedule_enabled_cmd,
            run_schedule_now_cmd
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
