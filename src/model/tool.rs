use serde_json::Value;

use crate::model::{EventSource, agent::Agent};

pub trait Tool {
    fn id(&self) -> &str;
    fn description(&self) -> &str;
    fn input_schema(&self) -> &Value;
    fn call<'a>(
        &'a self,
        context: Box<dyn super::Context>,
        caller: &'a Agent,
        input: Value,
    ) -> Pin<Box<dyn Future<Output = Value> + 'a>>;
}

pub trait ToolRepository {
    async fn get_tool(&self, id: &str) -> impl Tool;
}

pub struct ToolCall {
    tool: &'static dyn Tool,
    input: Value,
}

impl EventSource for ToolCall {
    async fn work(&self, context: impl super::Context) -> super::Event {
        todo!()
    }
}
