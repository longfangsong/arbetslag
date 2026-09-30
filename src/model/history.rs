use crate::{model::history::ContentPart::Text, utils::new_id};
use serde_json::Value;
use std::collections::HashMap;

pub struct ToolCall {
    pub id: String,
    pub tool_name: String,
    pub arguments: HashMap<String, Value>,
}

pub struct ToolCallResult {
    pub tool_call_id: String,
    pub name: String,
    pub content: String,
}

pub struct Usage {
    pub prompt_tokens: u64,
}

pub struct CompletionResult {
    pub content: String,
    pub tool_calls: Option<Vec<ToolCall>>,
    pub usage: Option<Usage>,
}

pub enum ContentPart {
    Text(String),
    Image(String),
}

pub type Content = Vec<ContentPart>;

pub enum HistoryEntry {
    System(Content),
    User(Content),
    Tool(ToolCallResult),
    Assistant(CompletionResult),
}

impl HistoryEntry {
    pub fn new_system(prompt: &str) -> Self {
        Self::System(vec![Text(prompt.to_string())])
    }
}

impl From<ToolCallResult> for HistoryEntry {
    fn from(value: ToolCallResult) -> Self {
        Self::Tool(value)
    }
}

impl From<CompletionResult> for HistoryEntry {
    fn from(value: CompletionResult) -> Self {
        Self::Assistant(value)
    }
}

impl From<String> for HistoryEntry {
    fn from(value: String) -> Self {
        Self::User(vec![ContentPart::Text(value)])
    }
}

pub fn content_text(content: &Content) -> String {
    content
        .iter()
        .filter_map(|part| match part {
            ContentPart::Text(t) => Some(t.as_str()),
            ContentPart::Image(_) => None,
        })
        .collect::<Vec<&str>>()
        .join("\n")
}

pub struct History {
    pub id: String,
    pub entries: Vec<HistoryEntry>,
}

impl History {
    pub fn new() -> Self {
        Self {
            id: new_id(),
            entries: Vec::new(),
        }
    }

    pub fn push(&mut self, history: impl Into<HistoryEntry>) {
        self.entries.push(history.into());
    }
}

pub trait HistoryRepository {
    async fn get_history(&self, id: &str) -> History; 
    async fn put_history(&self, history: History);
    async fn update_history(&self, id: &str, f: impl AsyncFnOnce(History) -> History);
}