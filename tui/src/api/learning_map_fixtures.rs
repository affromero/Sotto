use serde_json::{Value, json};

pub(crate) fn map(course_id: &str, level: &str, current: &str, ready: bool) -> Value {
    let objective = json!({
        "kind":"OBJECTIVE","id":"es.g.perfect","parentId":"es.grammar","branch":"GRAMMAR",
        "title":"Perfect past","description":"Report a completed event.","order":1,
        "level":level,"required":true,"criterionVersion":1,"policyVersion":1,
        "skills":["GRAMMAR","WRITING"],"skillCriteria":{
            "GRAMMAR":"Choose or construct the perfect form.",
            "WRITING":"Independently report a completed event using the perfect."
        },"assessment":"Use the perfect to report a completed event.",
        "examples":["Ya he llegado."],"grammarKeys":["present-perfect"],"vocabulary":[]
    });
    let summary = json!({"total":1,"confident":0,"notAssessed":1,"reviewDue":0});
    json!({
        "courseId":course_id,"targetLang":"es","currentLevel":current,"viewedLevel":level,
        "catalogVersion":1,"catalogHash":"a".repeat(64),"requirementId":"pinned-requirement",
        "coverage":null,"completedAt":null,"blockers":[],
        "readiness":{"level":level,"nextLevel":"B1","ready":ready,"requiredCount":1,
            "confidentCount":0,"unassessedCount":1,"practisingCount":0,"needsWorkCount":0,
            "missingObjectiveIds":["es.g.perfect"],"exemptSkills":["LISTENING","SPEAKING"]},
        "references":[{"title":"Fixture curricular reference","url":"https://example.test/cefr"}],
        "nodes":[
            {"node":{"kind":"GROUP","id":"es.grammar","parentId":null,"branch":"GRAMMAR","title":"Grammar","description":"Grammar structures","order":0},"progress":null,"summary":summary},
            {"node":objective,"progress":{"objectiveId":"es.g.perfect","status":"NOT_ASSESSED","reviewDue":false,
                "skills":[{"skill":"GRAMMAR","status":"NOT_ASSESSED","exempt":false,"evidence":null},{"skill":"WRITING","status":"NOT_ASSESSED","exempt":false,"evidence":null}]},"summary":summary}
        ]
    })
}

pub(crate) fn preview(level: &str) -> Value {
    let mut objective = map("course", level, "A2", false)["nodes"][1]["node"].clone();
    for field in ["kind", "parentId", "order", "required", "description"] {
        objective.as_object_mut().unwrap().remove(field);
    }
    json!({"selection":{"schemaVersion":1,"catalogVersion":1,"catalogHash":"a".repeat(64),
        "targetLang":"es","level":level,"nodeIds":["es.grammar"],"objectives":[objective],"materialFocusId":null},
        "requirementId":"pinned-requirement","availableKinds":["GRAMMAR"]})
}

pub(crate) fn completion(course_id: &str, level: &str) -> Value {
    json!({"completed":true,"courseId":course_id,"level":level,"currentLevel":"B1",
        "nextLevel":"B1","requirementId":"pinned-requirement","completedAt":"2026-10-20T12:00:00Z",
        "exemptSkills":["LISTENING","SPEAKING"]})
}
