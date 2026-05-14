use serde_json::Value;
use tokio::sync::broadcast;

pub struct EventBus {
    sender: broadcast::Sender<(String, Value)>,
}

impl EventBus {
    pub fn new(capacity: usize) -> Self {
        let (sender, _) = broadcast::channel(capacity);
        Self { sender }
    }

    pub fn emit(&self, event: &str, data: Value) {
        let _ = self.sender.send((event.to_string(), data));
    }

    pub fn subscribe(&self) -> broadcast::Receiver<(String, Value)> {
        self.sender.subscribe()
    }
}
