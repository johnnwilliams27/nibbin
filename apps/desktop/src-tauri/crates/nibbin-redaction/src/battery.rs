//! Layer 3a — the regex battery. Always runs, sidecar up or down. The rule
//! JSON is embedded verbatim from packages/redaction/rules/ at compile time.

use crate::event::ValueClass;
use regex::Regex;
use serde::Deserialize;
use std::sync::OnceLock;

const RULES_JSON: &str =
    include_str!("../../../../../../packages/redaction/rules/redaction-rules.json");

#[derive(Deserialize)]
struct RulesFile {
    version: u32,
    battery: Vec<RuleSpec>,
    #[serde(rename = "valueClasses")]
    value_classes: Vec<ValueClassSpec>,
}

#[derive(Deserialize)]
struct RuleSpec {
    id: String,
    placeholder: String,
    pattern: String,
}

#[derive(Deserialize)]
struct ValueClassSpec {
    class: String,
    pattern: String,
}

struct CompiledRule {
    id: String,
    placeholder: String,
    regex: Regex,
}

struct CompiledRules {
    version: u32,
    battery: Vec<CompiledRule>,
    value_classes: Vec<(ValueClass, Regex)>,
}

fn rules() -> &'static CompiledRules {
    static RULES: OnceLock<CompiledRules> = OnceLock::new();
    RULES.get_or_init(|| {
        let parsed: RulesFile =
            serde_json::from_str(RULES_JSON).expect("redaction-rules.json must parse");
        CompiledRules {
            version: parsed.version,
            battery: parsed
                .battery
                .into_iter()
                .map(|r| CompiledRule {
                    regex: Regex::new(&r.pattern)
                        .unwrap_or_else(|e| panic!("battery rule {} must compile: {e}", r.id)),
                    id: r.id,
                    placeholder: r.placeholder,
                })
                .collect(),
            value_classes: parsed
                .value_classes
                .into_iter()
                .map(|r| {
                    let class = match r.class.as_str() {
                        "email" => ValueClass::Email,
                        "currency" => ValueClass::Currency,
                        "date" => ValueClass::Date,
                        other => panic!("unknown value class {other}"),
                    };
                    (
                        class,
                        Regex::new(&r.pattern).expect("value-class pattern must compile"),
                    )
                })
                .collect(),
        }
    })
}

pub fn rules_version() -> u32 {
    rules().version
}

pub struct BatteryResult {
    pub text: String,
    pub rules_hit: Vec<String>,
}

/// Apply every battery rule in declared order, recording which rules fired.
pub fn apply_battery(text: &str) -> BatteryResult {
    let mut out = text.to_string();
    let mut rules_hit = Vec::new();
    for rule in &rules().battery {
        if rule.regex.is_match(&out) {
            out = rule
                .regex
                .replace_all(&out, rule.placeholder.as_str())
                .into_owned();
            rules_hit.push(rule.id.clone());
        }
    }
    BatteryResult {
        text: out,
        rules_hit,
    }
}

/// Classify a field value, then let the caller discard it. The class — not
/// the value — is the only thing the schema can persist.
pub fn classify_value(value: Option<&str>) -> ValueClass {
    let Some(value) = value else {
        return ValueClass::None;
    };
    let trimmed = value.trim();
    if trimmed.is_empty() {
        return ValueClass::None;
    }
    for (class, regex) in &rules().value_classes {
        if regex.is_match(trimmed) {
            return *class;
        }
    }
    ValueClass::Freeform
}

/// Paranoid re-scan on export: does any PII-shaped rule still match?
/// (The generic NUM sweep is excluded — benign counts/durations match it.)
pub fn battery_still_matches(text: &str) -> Option<String> {
    rules()
        .battery
        .iter()
        .filter(|r| r.id != "NUM")
        .find(|r| r.regex.is_match(text))
        .map(|r| r.id.clone())
}
