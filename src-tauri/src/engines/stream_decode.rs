//! Decode CLI JSONL streams into human-readable terminal lines.
use crate::db::now_iso8601;
use crate::engines::adapter::LogEvent;
use serde_json::Value;

/// Stateful decoder: collapses tiny token deltas into readable chunks.
pub struct StreamDecoder {
    engine: String,
    mode: Option<&'static str>,
    buf: String,
}

impl StreamDecoder {
    pub fn new(engine: &str) -> Self {
        Self {
            engine: engine.to_string(),
            mode: None,
            buf: String::new(),
        }
    }

    pub fn push(&mut self, ev: LogEvent) -> Vec<LogEvent> {
        // Keep command / stderr / already-decoded streams as-is.
        if ev.stream != "stdout" || !ev.line.trim_start().starts_with('{') {
            let mut out = self.flush();
            out.push(ev);
            return out;
        }

        let Ok(v) = serde_json::from_str::<Value>(&ev.line) else {
            let mut out = self.flush();
            out.push(ev);
            return out;
        };

        match self.engine.as_str() {
            "cursor-agent" => self.decode_cursor(&v, &ev),
            "codex" => self.decode_codex(&v, &ev),
            "opencode" => self.decode_opencode(&v, &ev),
            _ => {
                let mut out = self.flush();
                out.push(ev);
                out
            }
        }
    }

    pub fn finish(&mut self) -> Vec<LogEvent> {
        self.flush()
    }

    fn flush(&mut self) -> Vec<LogEvent> {
        if self.buf.is_empty() {
            self.mode = None;
            return vec![];
        }
        let stream = self.mode.unwrap_or("agent");
        let line = std::mem::take(&mut self.buf);
        self.mode = None;
        vec![log_ev(stream, &line)]
    }

    fn push_delta(&mut self, stream: &'static str, text: &str) -> Vec<LogEvent> {
        if text.is_empty() {
            return vec![];
        }
        let mut out = vec![];
        if self.mode.is_some() && self.mode != Some(stream) {
            out.extend(self.flush());
        }
        self.mode = Some(stream);
        self.buf.push_str(text);

        let should_flush = self.buf.len() >= 64
            || self.buf.contains('\n')
            || self
                .buf
                .chars()
                .last()
                .map(|c| matches!(c, '.' | '!' | '?' | '。' | '！' | '？'))
                .unwrap_or(false);
        if should_flush {
            out.extend(self.flush());
        }
        out
    }

    fn decode_cursor(&mut self, v: &Value, raw: &LogEvent) -> Vec<LogEvent> {
        let ty = v.get("type").and_then(|x| x.as_str()).unwrap_or("");
        match ty {
            "system" => {
                let mut out = self.flush();
                let model = v
                    .get("model")
                    .and_then(|x| x.as_str())
                    .unwrap_or("?");
                out.push(log_ev("status", &format!("session started · model={model}")));
                out
            }
            "thinking" => {
                let subtype = v.get("subtype").and_then(|x| x.as_str()).unwrap_or("");
                if subtype == "completed" {
                    let mut out = self.flush();
                    out.push(log_ev("status", "thinking done"));
                    out
                } else if let Some(text) = v.get("text").and_then(|x| x.as_str()) {
                    self.push_delta("think", text)
                } else {
                    vec![]
                }
            }
            "assistant" => {
                let text = extract_assistant_text(v);
                if text.is_empty() {
                    vec![]
                } else {
                    self.push_delta("agent", &text)
                }
            }
            "tool_call" | "tool_use" => {
                let mut out = self.flush();
                let subtype = v.get("subtype").and_then(|x| x.as_str()).unwrap_or("");
                let tool_obj = v.get("tool_call").unwrap_or(v);
                let (name, summary) = extract_cursor_tool(tool_obj);

                match subtype {
                    // Started: one compact tool line (UI merges adjacent tools).
                    "started" | "" => {
                        out.push(log_ev("tool", &format!("→ {summary}")));
                    }
                    // Completed: only surface failures / shell rejections — never drop them.
                    "completed" => {
                        if let Some(err) = extract_tool_error(tool_obj) {
                            out.push(log_ev(
                                "stderr",
                                &format!("✗ {name} rejected: {err}"),
                            ));
                        } else if let Some((code, cmd)) = extract_shell_nonzero(tool_obj) {
                            out.push(log_ev(
                                "stderr",
                                &format!("✗ Shell exit {code}: {cmd}"),
                            ));
                        }
                        // success → skip (started already logged)
                    }
                    other => {
                        out.push(log_ev("tool", &format!("→ {summary} ({other})")));
                    }
                }
                out
            }
            "result" => {
                let mut out = self.flush();
                let subtype = v.get("subtype").and_then(|x| x.as_str()).unwrap_or("");
                let ms = v.get("duration_ms").and_then(|x| x.as_u64());
                let msg = match (subtype, ms) {
                    ("success", Some(ms)) => format!("done in {ms}ms"),
                    ("success", None) => "done".into(),
                    (other, _) => format!("result: {other}"),
                };
                out.push(log_ev("status", &msg));
                out
            }
            "user" => vec![], // don't echo the prompt
            _ => {
                // Unknown JSON — skip raw dump to avoid noise; keep a breadcrumb.
                let mut out = self.flush();
                if !ty.is_empty() {
                    out.push(log_ev("status", &format!("event:{ty}")));
                } else {
                    out.push(raw.clone());
                }
                out
            }
        }
    }

    fn decode_codex(&mut self, v: &Value, raw: &LogEvent) -> Vec<LogEvent> {
        let ty = v.get("type").and_then(|x| x.as_str()).unwrap_or("");
        match ty {
            "thread.started" => {
                let mut out = self.flush();
                out.push(log_ev("status", "thread started"));
                out
            }
            "turn.started" => {
                let mut out = self.flush();
                out.push(log_ev("status", "turn started"));
                out
            }
            "turn.completed" => {
                let mut out = self.flush();
                out.push(log_ev("status", "turn completed"));
                out
            }
            "item.completed" | "item.updated" => {
                let item = v.get("item").unwrap_or(v);
                let item_ty = item.get("type").and_then(|x| x.as_str()).unwrap_or("");
                match item_ty {
                    "agent_message" => {
                        let text = item.get("text").and_then(|x| x.as_str()).unwrap_or("");
                        if text.is_empty() {
                            vec![]
                        } else if ty == "item.updated" {
                            self.push_delta("agent", text)
                        } else {
                            let mut out = self.flush();
                            out.push(log_ev("agent", text));
                            out
                        }
                    }
                    "reasoning" | "thought" => {
                        let text = item
                            .get("text")
                            .or_else(|| item.get("content"))
                            .and_then(|x| x.as_str())
                            .unwrap_or("");
                        if text.is_empty() {
                            vec![]
                        } else {
                            self.push_delta("think", text)
                        }
                    }
                    "command_execution" | "tool" | "function_call" => {
                        let mut out = self.flush();
                        let cmd = item
                            .get("command")
                            .or_else(|| item.get("name"))
                            .and_then(|x| x.as_str())
                            .unwrap_or(item_ty);
                        out.push(log_ev("tool", &format!("→ {cmd}")));
                        out
                    }
                    other if !other.is_empty() => {
                        let mut out = self.flush();
                        out.push(log_ev("status", &format!("item:{other}")));
                        out
                    }
                    _ => vec![],
                }
            }
            "error" => {
                let mut out = self.flush();
                let msg = v
                    .get("message")
                    .or_else(|| v.get("error"))
                    .and_then(|x| x.as_str())
                    .unwrap_or("error");
                out.push(log_ev("stderr", msg));
                out
            }
            _ => {
                let mut out = self.flush();
                if !ty.is_empty() {
                    out.push(log_ev("status", &format!("event:{ty}")));
                } else {
                    out.push(raw.clone());
                }
                out
            }
        }
    }

    fn decode_opencode(&mut self, v: &Value, raw: &LogEvent) -> Vec<LogEvent> {
        let ty = v.get("type").and_then(|x| x.as_str()).unwrap_or("");
        match ty {
            "step_start" => {
                let mut out = self.flush();
                out.push(log_ev("status", "step started"));
                out
            }
            "step_finish" => {
                let mut out = self.flush();
                out.push(log_ev("status", "step finished"));
                out
            }
            "text" => {
                let text = v
                    .pointer("/part/text")
                    .or_else(|| v.get("text"))
                    .and_then(|x| x.as_str())
                    .unwrap_or("");
                if text.is_empty() {
                    vec![]
                } else {
                    // OpenCode often sends the full text in one event; still route as agent.
                    let mut out = self.flush();
                    out.push(log_ev("agent", text));
                    out
                }
            }
            "reasoning" | "thinking" => {
                let text = v
                    .pointer("/part/text")
                    .or_else(|| v.get("text"))
                    .and_then(|x| x.as_str())
                    .unwrap_or("");
                if text.is_empty() {
                    vec![]
                } else {
                    self.push_delta("think", text)
                }
            }
            "tool_call" | "tool" => {
                let mut out = self.flush();
                let name = v
                    .pointer("/part/tool")
                    .or_else(|| v.pointer("/part/name"))
                    .or_else(|| v.get("name"))
                    .and_then(|x| x.as_str())
                    .unwrap_or("tool");
                out.push(log_ev("tool", &format!("→ {name}")));
                out
            }
            "error" => {
                let mut out = self.flush();
                let msg = v
                    .pointer("/part/error")
                    .or_else(|| v.get("error"))
                    .and_then(|x| x.as_str())
                    .unwrap_or("error");
                out.push(log_ev("stderr", msg));
                out
            }
            _ => {
                let mut out = self.flush();
                if !ty.is_empty() {
                    out.push(log_ev("status", &format!("event:{ty}")));
                } else {
                    out.push(raw.clone());
                }
                out
            }
        }
    }
}

fn extract_assistant_text(v: &Value) -> String {
    let Some(content) = v.pointer("/message/content").and_then(|x| x.as_array()) else {
        return v
            .pointer("/message/content")
            .and_then(|x| x.as_str())
            .unwrap_or("")
            .to_string();
    };
    let mut out = String::new();
    for part in content {
        if part.get("type").and_then(|x| x.as_str()) == Some("text") {
            if let Some(t) = part.get("text").and_then(|x| x.as_str()) {
                out.push_str(t);
            }
        }
    }
    out
}

/// Parse cursor `tool_call` object → (short name, display summary).
fn extract_cursor_tool(tool_obj: &Value) -> (String, String) {
    if let Some(obj) = tool_obj.as_object() {
        for (key, val) in obj {
            if key == "function" {
                let name = val
                    .get("name")
                    .and_then(|x| x.as_str())
                    .unwrap_or("function");
                return (name.to_string(), name.to_string());
            }
            if key.ends_with("ToolCall") {
                let name = tool_call_key_to_name(key);
                let detail = tool_call_detail(key, val);
                let summary = if detail.is_empty() {
                    name.clone()
                } else {
                    format!("{name} {detail}")
                };
                return (name, summary);
            }
        }
    }
    let name = tool_obj
        .get("name")
        .and_then(|x| x.as_str())
        .unwrap_or("tool");
    (name.to_string(), name.to_string())
}

fn tool_call_key_to_name(key: &str) -> String {
    let base = key.strip_suffix("ToolCall").unwrap_or(key);
    if base.is_empty() {
        return "Tool".into();
    }
    // shell → Shell, read → Read, grep → Grep
    let mut chars = base.chars();
    match chars.next() {
        Some(c) => format!("{}{}", c.to_uppercase(), chars.as_str()),
        None => "Tool".into(),
    }
}

fn tool_call_detail(key: &str, val: &Value) -> String {
    let args = val.get("args").unwrap_or(val);
    let raw = match key {
        "shellToolCall" => args
            .get("command")
            .and_then(|x| x.as_str())
            .unwrap_or("")
            .to_string(),
        "readToolCall" | "writeToolCall" | "editToolCall" | "lsToolCall"
        | "deleteToolCall" => args
            .get("path")
            .and_then(|x| x.as_str())
            .unwrap_or("")
            .to_string(),
        "grepToolCall" => args
            .get("pattern")
            .and_then(|x| x.as_str())
            .unwrap_or("")
            .to_string(),
        _ => args
            .get("path")
            .or_else(|| args.get("command"))
            .or_else(|| args.get("pattern"))
            .or_else(|| args.get("query"))
            .and_then(|x| x.as_str())
            .unwrap_or("")
            .to_string(),
    };
    truncate_detail(&raw, 80)
}

fn truncate_detail(s: &str, max: usize) -> String {
    let one_line = s.replace('\n', " ");
    if one_line.chars().count() <= max {
        return one_line;
    }
    let truncated: String = one_line.chars().take(max.saturating_sub(1)).collect();
    format!("{truncated}…")
}

fn extract_tool_error(tool_obj: &Value) -> Option<String> {
    let Some(obj) = tool_obj.as_object() else {
        return None;
    };
    for (_key, val) in obj {
        if let Some(msg) = val
            .pointer("/result/error/errorMessage")
            .or_else(|| val.pointer("/result/error/message"))
            .or_else(|| val.pointer("/result/rejected/reason"))
            .or_else(|| val.pointer("/result/rejected"))
            .and_then(|x| x.as_str())
        {
            if !msg.is_empty() {
                return Some(truncate_detail(msg, 160));
            }
        }
        // Some builds nest denial under result.failure / permissionDenied
        if let Some(msg) = val
            .pointer("/result/failure/message")
            .or_else(|| val.pointer("/result/permissionDenied"))
            .and_then(|x| x.as_str())
        {
            if !msg.is_empty() {
                return Some(truncate_detail(msg, 160));
            }
        }
    }
    None
}

/// Non-zero shell exit (not a soft success).
fn extract_shell_nonzero(tool_obj: &Value) -> Option<(u64, String)> {
    let shell = tool_obj.get("shellToolCall")?;
    let success = shell.pointer("/result/success")?;
    let code = success.get("exitCode").and_then(|x| x.as_u64())?;
    if code == 0 {
        return None;
    }
    let cmd = success
        .get("command")
        .or_else(|| shell.pointer("/args/command"))
        .and_then(|x| x.as_str())
        .unwrap_or("?");
    Some((code, truncate_detail(cmd, 80)))
}

fn log_ev(stream: &str, line: &str) -> LogEvent {
    LogEvent {
        ts: now_iso8601(),
        stream: stream.to_string(),
        line: line.to_string(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn cursor_assistant_deltas_coalesce() {
        let mut d = StreamDecoder::new("cursor-agent");
        let ev = |line: &str| LogEvent {
            ts: "t".into(),
            stream: "stdout".into(),
            line: line.into(),
        };
        let a = d.push(ev(
            r#"{"type":"assistant","message":{"role":"assistant","content":[{"type":"text","text":"Hel"}]}}"#,
        ));
        assert!(a.is_empty(), "short delta should buffer");
        let b = d.push(ev(
            r#"{"type":"assistant","message":{"role":"assistant","content":[{"type":"text","text":"lo world."}]}}"#,
        ));
        assert_eq!(b.len(), 1);
        assert_eq!(b[0].stream, "agent");
        assert_eq!(b[0].line, "Hello world.");
    }

    #[test]
    fn opencode_text_emits_agent() {
        let mut d = StreamDecoder::new("opencode");
        let out = d.push(LogEvent {
            ts: "t".into(),
            stream: "stdout".into(),
            line: r#"{"type":"text","part":{"type":"text","text":"OK"}}"#.into(),
        });
        assert_eq!(out.len(), 1);
        assert_eq!(out[0].stream, "agent");
        assert_eq!(out[0].line, "OK");
    }

    #[test]
    fn codex_agent_message() {
        let mut d = StreamDecoder::new("codex");
        let out = d.push(LogEvent {
            ts: "t".into(),
            stream: "stdout".into(),
            line: r#"{"type":"item.completed","item":{"id":"item_0","type":"agent_message","text":"OK"}}"#.into(),
        });
        assert_eq!(out.len(), 1);
        assert_eq!(out[0].stream, "agent");
        assert_eq!(out[0].line, "OK");
    }

    #[test]
    fn cursor_tool_started_shows_name_and_detail() {
        let mut d = StreamDecoder::new("cursor-agent");
        let out = d.push(LogEvent {
            ts: "t".into(),
            stream: "stdout".into(),
            line: r#"{"type":"tool_call","subtype":"started","call_id":"1","tool_call":{"shellToolCall":{"args":{"command":"ls -la"}}}}"#.into(),
        });
        assert_eq!(out.len(), 1);
        assert_eq!(out[0].stream, "tool");
        assert_eq!(out[0].line, "→ Shell ls -la");
    }

    #[test]
    fn cursor_tool_completed_success_is_silent() {
        let mut d = StreamDecoder::new("cursor-agent");
        let out = d.push(LogEvent {
            ts: "t".into(),
            stream: "stdout".into(),
            line: r#"{"type":"tool_call","subtype":"completed","call_id":"1","tool_call":{"readToolCall":{"args":{"path":"a.txt"},"result":{"success":{"content":"x","isEmpty":false,"exceededLimit":false,"totalLines":1,"totalChars":1}}}}}"#.into(),
        });
        assert!(out.is_empty(), "successful completed should not spam");
    }

    #[test]
    fn cursor_shell_rejection_always_emitted() {
        let mut d = StreamDecoder::new("cursor-agent");
        let out = d.push(LogEvent {
            ts: "t".into(),
            stream: "stdout".into(),
            line: r#"{"type":"tool_call","subtype":"completed","call_id":"1","tool_call":{"shellToolCall":{"args":{"command":"rm -rf /"},"result":{"error":{"errorMessage":"User rejected shell call"}}}}}"#.into(),
        });
        assert_eq!(out.len(), 1);
        assert_eq!(out[0].stream, "stderr");
        assert!(out[0].line.contains("rejected"));
        assert!(out[0].line.contains("User rejected shell call"));
    }

    #[test]
    fn cursor_shell_nonzero_exit_emitted() {
        let mut d = StreamDecoder::new("cursor-agent");
        let out = d.push(LogEvent {
            ts: "t".into(),
            stream: "stdout".into(),
            line: r#"{"type":"tool_call","subtype":"completed","call_id":"1","tool_call":{"shellToolCall":{"args":{"command":"false"},"result":{"success":{"command":"false","exitCode":1,"stdout":"","stderr":""}}}}}"#.into(),
        });
        assert_eq!(out.len(), 1);
        assert_eq!(out[0].stream, "stderr");
        assert!(out[0].line.contains("exit 1"));
    }
}
