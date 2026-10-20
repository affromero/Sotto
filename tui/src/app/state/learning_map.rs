/// Presentation of authoritative map and preview responses. No mastery or readiness is inferred.
#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct LearningMapState {
    pub level: String,
    pub response: Option<serde_json::Value>,
    pub cursor: usize,
    pub query: String,
    pub searching: bool,
    pub detail: Option<String>,
    pub requirements: bool,
    pub scroll: u16,
    pub selected: Vec<String>,
    pub preview: Option<serde_json::Value>,
    pub format_cursor: usize,
    pub loading: bool,
    pub error: Option<String>,
    pub advance_confirmation: bool,
    pub advance_request: Option<serde_json::Value>,
}

impl LearningMapState {
    pub fn is_future(&self) -> bool {
        let levels = ["A1", "A2", "B1", "B2", "C1", "C2"];
        let Some(map) = self.response.as_ref() else {
            return false;
        };
        levels
            .iter()
            .position(|level| Some(*level) == map["viewedLevel"].as_str())
            > levels
                .iter()
                .position(|level| Some(*level) == map["currentLevel"].as_str())
    }
    pub fn new(level: String) -> Self {
        Self {
            level,
            response: None,
            cursor: 0,
            query: String::new(),
            searching: false,
            detail: None,
            requirements: false,
            scroll: 0,
            selected: Vec::new(),
            preview: None,
            format_cursor: 0,
            loading: true,
            error: None,
            advance_confirmation: false,
            advance_request: None,
        }
    }

    pub fn rows(&self) -> Vec<&serde_json::Value> {
        let Some(rows) = self
            .response
            .as_ref()
            .and_then(|map| map["nodes"].as_array())
        else {
            return Vec::new();
        };
        let query = self.query.to_lowercase();
        rows.iter()
            .filter(|entry| {
                query.is_empty()
                    || ["title", "description", "grammarKeys", "examples"]
                        .iter()
                        .any(|field| {
                            entry["node"][*field]
                                .to_string()
                                .to_lowercase()
                                .contains(&query)
                        })
            })
            .collect()
    }

    pub fn formats(&self) -> Vec<String> {
        self.preview
            .as_ref()
            .and_then(|preview| preview["availableKinds"].as_array())
            .map(|kinds| {
                kinds
                    .iter()
                    .filter_map(|kind| kind.as_str().map(str::to_owned))
                    .collect()
            })
            .unwrap_or_default()
    }

    pub fn selection_request(&self) -> Result<types::LearningSelectionRequest, String> {
        if self.is_future() {
            return Err("Reach this level to practise its objectives.".into());
        }
        let map = self
            .response
            .as_ref()
            .ok_or("Load the map before choosing objectives.")?;
        serde_json::from_value(serde_json::json!({
            "catalogVersion": map["catalogVersion"], "level": self.level, "nodeIds": self.selected,
        }))
        .map_err(|error| format!("The selection cannot be read: {error}"))
    }

    /// Explicit leaves freeze the server's chosen subset when the original choice was a group.
    pub fn resolved_request(&self) -> Result<types::LearningSelectionRequest, String> {
        if self.is_future() {
            return Err("Reach this level to practise its objectives.".into());
        }
        let preview = self
            .preview
            .as_ref()
            .ok_or("Preview the selected objectives first.")?;
        let selection = &preview["selection"];
        let objectives = selection["objectives"]
            .as_array()
            .ok_or("The preview has no objective inventory.")?;
        let ids = objectives
            .iter()
            .map(|objective| {
                objective["id"].as_str().map(str::to_owned).ok_or_else(|| {
                    "The preview contains an invalid objective identity.".to_string()
                })
            })
            .collect::<Result<Vec<_>, _>>()?;
        if ids.is_empty() {
            return Err("The preview contains no canonical objectives.".into());
        }
        serde_json::from_value(serde_json::json!({
            "catalogVersion": selection["catalogVersion"], "level": selection["level"], "nodeIds": ids,
        })).map_err(|error| format!("The frozen selection cannot be read: {error}"))
    }
}
