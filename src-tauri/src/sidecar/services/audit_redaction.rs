use serde_json::Value;

const MAX_DEPTH: usize = 8;
const REDACTED: &str = "[REDACTED]";

pub fn redact_for_audit(value: &Value) -> Value {
    redact_value(value, 0)
}

fn redact_value(value: &Value, depth: usize) -> Value {
    if depth >= MAX_DEPTH {
        return Value::String("[Max depth reached]".to_string());
    }
    match value {
        Value::Object(map) => Value::Object(
            map.iter()
                .map(|(key, value)| {
                    if is_sensitive_key(key) {
                        (key.clone(), Value::String(REDACTED.to_string()))
                    } else {
                        (key.clone(), redact_value(value, depth + 1))
                    }
                })
                .collect(),
        ),
        Value::Array(items) => Value::Array(
            items
                .iter()
                .map(|item| redact_value(item, depth + 1))
                .collect(),
        ),
        _ => value.clone(),
    }
}

fn is_sensitive_key(key: &str) -> bool {
    let key = key.to_ascii_lowercase();
    [
        "token",
        "password",
        "secret",
        "key",
        "cookie",
        "authorization",
    ]
    .iter()
    .any(|needle| key.contains(needle))
}
