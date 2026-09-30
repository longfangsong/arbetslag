use crate::model::{agent::Agent, history::{History, HistoryEntry}};

pub struct Template {
    pub id: String,
    pub model_id: String,
    pub tool_ids: Vec<String>,
    pub system_prompt: String,
}

impl Template {
    pub fn instantiate(&self) -> (Agent, History) {
        let mut history = History::new();
        history.push(HistoryEntry::new_system(&self.system_prompt));
        let agent = Agent::new(self.model_id.clone(), history.id.clone(), self.tool_ids.clone());
        (agent, history)
    }
}

pub trait TemplateRepository {
    async fn get_template(&self, id: &str) -> Template;
}
