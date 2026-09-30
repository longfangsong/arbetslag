mod agent;
mod history;
mod template;
mod tool;

pub trait Context:
    agent::AgentRepository
    + history::HistoryRepository
    + template::TemplateRepository
    + tool::ToolRepository
{
}

pub enum Event {}

pub trait EventSource {
    async fn work(&self, context: impl Context) -> Event;
}
