use crate::utils::new_id;
pub struct Agent {
    pub id: String,
    pub model_id: String,
    pub history_id: String,
    pub tool_ids: Vec<String>,
}

impl Agent {
    pub fn new(model_id: String, history_id: String, tool_ids: Vec<String>) -> Self {
        Self {
            id: new_id(),
            model_id,
            history_id,
            tool_ids,
        }
    }
}

pub trait AgentRepository {
    async fn get_agent(&self, id: &str) -> Agent;
}