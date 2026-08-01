use crate::db::now_iso8601;
use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Template {
    pub id: String,
    pub name: String,
    pub description: Option<String>,
    pub source_goal_id: Option<String>,
    pub source_plan_id: Option<String>,
    pub source_run_id: Option<String>,
    pub goal_prompt: String,
    pub plan_json: String,
    pub variables_json: String,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TemplateCreate {
    pub name: String,
    pub description: Option<String>,
    pub source_goal_id: Option<String>,
    pub source_plan_id: Option<String>,
    pub source_run_id: Option<String>,
    pub goal_prompt: String,
    pub plan_json: String,
    pub variables_json: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TemplateUpdate {
    pub name: Option<String>,
    pub description: Option<String>,
    pub goal_prompt: Option<String>,
    pub plan_json: Option<String>,
    pub variables_json: Option<String>,
}

fn map_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<Template> {
    Ok(Template {
        id: row.get(0)?,
        name: row.get(1)?,
        description: row.get(2)?,
        source_goal_id: row.get(3)?,
        source_plan_id: row.get(4)?,
        source_run_id: row.get(5)?,
        goal_prompt: row.get(6)?,
        plan_json: row.get(7)?,
        variables_json: row.get(8)?,
        created_at: row.get(9)?,
        updated_at: row.get(10)?,
    })
}

const SELECT_COLS: &str = "id, name, description, source_goal_id, source_plan_id, source_run_id, \
    goal_prompt, plan_json, variables_json, created_at, updated_at";

pub fn list_templates(conn: &Connection) -> Result<Vec<Template>, String> {
    let mut stmt = conn
        .prepare(&format!(
            "SELECT {SELECT_COLS} FROM templates ORDER BY updated_at DESC"
        ))
        .map_err(|e| format!("list templates prepare: {e}"))?;
    let rows = stmt
        .query_map([], map_row)
        .map_err(|e| format!("list templates query: {e}"))?;
    let mut out = Vec::new();
    for row in rows {
        out.push(row.map_err(|e| format!("list templates row: {e}"))?);
    }
    Ok(out)
}

pub fn get_template(conn: &Connection, id: &str) -> Result<Option<Template>, String> {
    conn.query_row(
        &format!("SELECT {SELECT_COLS} FROM templates WHERE id = ?1"),
        [id],
        map_row,
    )
    .optional()
    .map_err(|e| format!("get template: {e}"))
}

pub fn create_template(conn: &Connection, input: TemplateCreate) -> Result<Template, String> {
    let name = input.name.trim();
    if name.is_empty() {
        return Err("template name must not be empty".into());
    }
    let goal_prompt = input.goal_prompt.trim();
    if goal_prompt.is_empty() {
        return Err("goal_prompt must not be empty".into());
    }
    if input.plan_json.trim().is_empty() {
        return Err("plan_json must not be empty".into());
    }
    let variables_json = if input.variables_json.trim().is_empty() {
        "[]".to_string()
    } else {
        input.variables_json.clone()
    };
    // Validate variables_json is JSON array
    let _: serde_json::Value = serde_json::from_str(&variables_json)
        .map_err(|e| format!("variables_json invalid: {e}"))?;

    let id = Uuid::new_v4().to_string();
    let now = now_iso8601();
    conn.execute(
        "INSERT INTO templates (
            id, name, description, source_goal_id, source_plan_id, source_run_id,
            goal_prompt, plan_json, variables_json, created_at, updated_at
         ) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11)",
        params![
            id,
            name,
            input.description.as_deref().map(str::trim).filter(|s| !s.is_empty()),
            input.source_goal_id,
            input.source_plan_id,
            input.source_run_id,
            goal_prompt,
            input.plan_json,
            variables_json,
            now,
            now,
        ],
    )
    .map_err(|e| format!("create template: {e}"))?;

    get_template(conn, &id)?.ok_or_else(|| "template missing after insert".into())
}

pub fn update_template(
    conn: &Connection,
    id: &str,
    patch: TemplateUpdate,
) -> Result<Template, String> {
    let existing = get_template(conn, id)?.ok_or_else(|| format!("template not found: {id}"))?;

    let name = patch
        .name
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .unwrap_or(existing.name.as_str());
    let description = match &patch.description {
        Some(d) => {
            let t = d.trim();
            if t.is_empty() {
                None
            } else {
                Some(t.to_string())
            }
        }
        None => existing.description.clone(),
    };
    let goal_prompt = patch
        .goal_prompt
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .unwrap_or(existing.goal_prompt.as_str());
    let plan_json = patch
        .plan_json
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .unwrap_or(existing.plan_json.as_str());
    let variables_json = patch
        .variables_json
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .unwrap_or(existing.variables_json.as_str());
    let _: serde_json::Value = serde_json::from_str(variables_json)
        .map_err(|e| format!("variables_json invalid: {e}"))?;

    let now = now_iso8601();
    conn.execute(
        "UPDATE templates SET
            name = ?1,
            description = ?2,
            goal_prompt = ?3,
            plan_json = ?4,
            variables_json = ?5,
            updated_at = ?6
         WHERE id = ?7",
        params![
            name,
            description,
            goal_prompt,
            plan_json,
            variables_json,
            now,
            id
        ],
    )
    .map_err(|e| format!("update template: {e}"))?;

    get_template(conn, id)?.ok_or_else(|| "template missing after update".into())
}

pub fn delete_template(conn: &Connection, id: &str) -> Result<(), String> {
    let n = conn
        .execute("DELETE FROM templates WHERE id = ?1", [id])
        .map_err(|e| format!("delete template: {e}"))?;
    if n == 0 {
        return Err(format!("template not found: {id}"));
    }
    Ok(())
}

pub fn duplicate_template(conn: &Connection, id: &str) -> Result<Template, String> {
    let src = get_template(conn, id)?.ok_or_else(|| format!("template not found: {id}"))?;
    create_template(
        conn,
        TemplateCreate {
            name: format!("{} (副本)", src.name),
            description: src.description,
            source_goal_id: src.source_goal_id,
            source_plan_id: src.source_plan_id,
            source_run_id: src.source_run_id,
            goal_prompt: src.goal_prompt,
            plan_json: src.plan_json,
            variables_json: src.variables_json,
        },
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::migrate;
    use tempfile::NamedTempFile;

    #[test]
    fn crud_roundtrip() {
        let tmp = NamedTempFile::new().expect("tempfile");
        let conn = Connection::open(tmp.path()).expect("open");
        migrate(&conn).expect("migrate");

        let created = create_template(
            &conn,
            TemplateCreate {
                name: "竞品监控".into(),
                description: Some("desc".into()),
                source_goal_id: Some("g1".into()),
                source_plan_id: Some("p1".into()),
                source_run_id: None,
                goal_prompt: "监控 {{topic}}".into(),
                plan_json: r#"{"intent":{"summary":"x","tags":[]},"subtasks":[]}"#.into(),
                variables_json: r#"[{"key":"topic","label":"主题","required":true}]"#.into(),
            },
        )
        .expect("create");
        assert_eq!(created.name, "竞品监控");

        let listed = list_templates(&conn).expect("list");
        assert_eq!(listed.len(), 1);

        let updated = update_template(
            &conn,
            &created.id,
            TemplateUpdate {
                name: Some("竞品监控 v2".into()),
                description: None,
                goal_prompt: Some("监控 {{topic}} 价格".into()),
                plan_json: None,
                variables_json: None,
            },
        )
        .expect("update");
        assert_eq!(updated.name, "竞品监控 v2");
        assert_eq!(updated.goal_prompt, "监控 {{topic}} 价格");

        let dup = duplicate_template(&conn, &created.id).expect("dup");
        assert!(dup.name.contains("副本"));
        assert_eq!(list_templates(&conn).expect("list2").len(), 2);

        delete_template(&conn, &created.id).expect("delete");
        assert!(get_template(&conn, &created.id).expect("get").is_none());
    }
}
