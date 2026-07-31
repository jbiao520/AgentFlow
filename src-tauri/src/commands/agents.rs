use crate::repo::{
    delete_agent as repo_delete_agent, get_agent_profile as repo_get_profile,
    list_agents as repo_list_agents, list_skills_by_agent, set_skill_enabled as repo_set_skill,
    upsert_agent as repo_upsert_agent, upsert_agent_profile as repo_upsert_profile,
    upsert_skills_many, Agent, AgentModelProfile, AgentUpsert, Skill, SkillUpsert,
};
use crate::services::import_agent::{
    import_agent as service_import_agent, ImportAgentRequest, ImportAgentResult,
};
use crate::services::skill_scan::{
    read_skill_content as service_read_skill, sync_agent_skills as service_sync_skills,
    SyncSkillsResult,
};
use crate::state::DbState;
use tauri::State;

fn with_db<T, F>(state: &State<'_, DbState>, f: F) -> Result<T, String>
where
    F: FnOnce(&rusqlite::Connection) -> Result<T, String>,
{
    let conn = state
        .conn
        .lock()
        .map_err(|e| format!("db lock poisoned: {e}"))?;
    f(&conn)
}

#[tauri::command]
pub fn list_agents(state: State<'_, DbState>) -> Result<Vec<Agent>, String> {
    with_db(&state, repo_list_agents)
}

#[tauri::command]
pub fn import_agent(
    state: State<'_, DbState>,
    name: String,
    workspace_path_or_git: String,
    default_cli: String,
    description: Option<String>,
) -> Result<ImportAgentResult, String> {
    with_db(&state, |c| {
        service_import_agent(
            c,
            ImportAgentRequest {
                name,
                workspace_path_or_git,
                default_cli,
                description,
            },
        )
    })
}

#[tauri::command]
pub fn upsert_agent(state: State<'_, DbState>, agent: AgentUpsert) -> Result<Agent, String> {
    with_db(&state, |c| repo_upsert_agent(c, agent))
}

#[tauri::command]
pub fn delete_agent(state: State<'_, DbState>, id: String) -> Result<(), String> {
    with_db(&state, |c| repo_delete_agent(c, &id))
}

#[tauri::command]
pub fn get_agent_profile(
    state: State<'_, DbState>,
    agent_id: String,
) -> Result<Option<AgentModelProfile>, String> {
    with_db(&state, |c| repo_get_profile(c, &agent_id))
}

#[tauri::command]
pub fn upsert_agent_profile(
    state: State<'_, DbState>,
    profile: AgentModelProfile,
) -> Result<AgentModelProfile, String> {
    with_db(&state, |c| repo_upsert_profile(c, profile))
}

#[tauri::command]
pub fn list_skills(state: State<'_, DbState>, agent_id: String) -> Result<Vec<Skill>, String> {
    with_db(&state, |c| list_skills_by_agent(c, &agent_id))
}

#[tauri::command]
pub fn upsert_skills(
    state: State<'_, DbState>,
    skills: Vec<SkillUpsert>,
) -> Result<Vec<Skill>, String> {
    with_db(&state, |c| upsert_skills_many(c, &skills))
}

#[tauri::command]
pub fn set_skill_enabled(
    state: State<'_, DbState>,
    id: String,
    enabled: bool,
) -> Result<Skill, String> {
    with_db(&state, |c| repo_set_skill(c, &id, enabled))
}

#[tauri::command]
pub fn sync_agent_skills(
    state: State<'_, DbState>,
    agent_id: String,
) -> Result<SyncSkillsResult, String> {
    with_db(&state, |c| service_sync_skills(c, &agent_id))
}

#[tauri::command]
pub fn read_skill_content(
    state: State<'_, DbState>,
    agent_id: String,
    relative_path: String,
) -> Result<String, String> {
    with_db(&state, |c| service_read_skill(c, &agent_id, &relative_path))
}
