fn map_text(value: &serde_json::Value) -> String {
    value
        .as_str()
        .map(str::to_owned)
        .unwrap_or_else(|| value.to_string())
}

fn draw_learning_map(
    frame: &mut Frame,
    area: Rect,
    course: &Course,
    state: &super::state::LearningMapState,
    p: &Palette,
) {
    let inner = panel(
        frame,
        area,
        &format!("{} · Learning map · {}", course.title, state.level),
        p,
    );
    let areas = Layout::vertical([
        Constraint::Length(2),
        Constraint::Min(1),
        Constraint::Length(2),
    ])
    .split(inner);
    let position = if state.is_future() {
        "Future-band preview"
    } else if state.level == course.current_level {
        "Current band"
    } else {
        "Lower-band review"
    };
    frame.render_widget(
        Paragraph::new(format!(
            "{position} · course {} · {} selected\n{}{}",
            course.current_level,
            state.selected.len(),
            if state.searching {
                "Search: "
            } else {
                "Filter: "
            },
            state.query
        ))
        .style(Style::default().fg(p.ink)),
        areas[0],
    );
    let hint = if let Some(request) = state.advance_request.as_ref() {
        format!(
            "a replay captured {} transition · r refresh · q back",
            map_text(&request["expectedLevel"])
        )
    } else if state.advance_confirmation {
        "Press a again to request this exact server-cleared transition.".into()
    } else if state.is_future() {
        "Read-only preview. Reach this level to practise its objectives. [ ] band · q back".into()
    } else {
        "Space select · p preview · v requirements · [ ] band · a advance · q back".into()
    };
    let footer = state.error.as_deref().unwrap_or(&hint);
    frame.render_widget(
        Paragraph::new(footer)
            .wrap(Wrap { trim: true })
            .style(Style::default().fg(if state.error.is_some() {
                p.error
            } else {
                p.ink_soft
            })),
        areas[2],
    );
    if state.loading {
        frame.render_widget(
            Paragraph::new("Reading the authoritative server receipt..."),
            areas[1],
        );
        return;
    }
    let Some(map) = state.response.as_ref() else {
        frame.render_widget(
            Paragraph::new("Map unavailable. Press r to retry. No progress has been inferred."),
            areas[1],
        );
        return;
    };
    if let Some(preview) = &state.preview {
        let names = preview["selection"]["objectives"]
            .as_array()
            .map(|objectives| {
                objectives
                    .iter()
                    .map(|objective| map_text(&objective["title"]))
                    .collect::<Vec<_>>()
                    .join("; ")
            })
            .unwrap_or_default();
        let parts = Layout::vertical([Constraint::Length(3), Constraint::Min(1)]).split(areas[1]);
        frame.render_widget(Paragraph::new(format!("Server-resolved {} selection: {names}\nChoose an available format and press Enter to start.", state.level)).wrap(Wrap { trim: true }), parts[0]);
        let items: Vec<ListItem> = state
            .formats()
            .iter()
            .map(|kind| ListItem::new(kind.clone()))
            .collect();
        let mut list = ListState::default().with_selected(Some(state.format_cursor));
        frame.render_stateful_widget(
            List::new(items)
                .highlight_symbol("› ")
                .highlight_style(Style::default().fg(p.primary).add_modifier(Modifier::BOLD)),
            parts[1],
            &mut list,
        );
        return;
    }
    if state.requirements || state.detail.is_some() {
        let text = if state.requirements {
            map_requirements(map)
        } else {
            map_detail(map, state.detail.as_deref().unwrap_or_default())
        };
        frame.render_widget(
            Paragraph::new(text)
                .wrap(Wrap { trim: false })
                .scroll((state.scroll, 0)),
            areas[1],
        );
        return;
    }
    let rows = state.rows();
    let items: Vec<ListItem> = rows
        .iter()
        .map(|entry| {
            let node = &entry["node"];
            let id = node["id"].as_str().unwrap_or_default();
            let selected = if state.selected.iter().any(|selected| selected == id) {
                "[x]"
            } else {
                "[ ]"
            };
            let progress = if node["kind"] == "GROUP" {
                format!(
                    "{} confident / {} objectives",
                    entry["summary"]["confident"], entry["summary"]["total"]
                )
            } else {
                format!(
                    "{}{}",
                    map_text(&entry["progress"]["status"]),
                    if entry["progress"]["reviewDue"] == true {
                        " · review due"
                    } else {
                        ""
                    }
                )
            };
            ListItem::new(format!(
                "{selected} {} · {}\n    {progress}",
                map_text(&node["branch"]),
                map_text(&node["title"])
            ))
        })
        .collect();
    let mut list = ListState::default().with_selected((!items.is_empty()).then_some(state.cursor));
    frame.render_stateful_widget(
        List::new(items)
            .highlight_symbol("› ")
            .highlight_style(Style::default().fg(p.primary).add_modifier(Modifier::BOLD)),
        areas[1],
        &mut list,
    );
}

fn map_requirements(map: &serde_json::Value) -> String {
    let readiness = &map["readiness"];
    let mut lines = vec![
        format!(
            "Server readiness: {}",
            if readiness["ready"] == true {
                "Ready"
            } else {
                "Not ready"
            }
        ),
        format!(
            "{} confident / {} required · {} unassessed · {} practising · {} need work",
            readiness["confidentCount"],
            readiness["requiredCount"],
            readiness["unassessedCount"],
            readiness["practisingCount"],
            readiness["needsWorkCount"]
        ),
        format!("Requirement receipt: {}", map_text(&map["requirementId"])),
        "Skill coverage:".into(),
    ];
    if let Some(skills) = map["coverage"]["skills"].as_object() {
        for (skill, coverage) in skills {
            lines.push(format!("  {skill}: {}", map_text(&coverage["state"])));
        }
    } else {
        lines.push("  This viewed band has no pinned coverage receipt.".into());
    }
    lines.push("Blockers:".into());
    if let Some(blockers) = map["blockers"].as_array() {
        if blockers.is_empty() {
            lines.push("  No pending-work blockers reported.".into());
        }
        for blocker in blockers {
            lines.push(format!("  {}", map_text(blocker)));
        }
    }
    lines.push("Missing required objectives:".into());
    if let Some(ids) = readiness["missingObjectiveIds"].as_array() {
        for id in ids {
            let title = map["nodes"]
                .as_array()
                .and_then(|nodes| nodes.iter().find(|node| node["node"]["id"] == *id))
                .map(|entry| map_text(&entry["node"]["title"]))
                .unwrap_or_else(|| map_text(id));
            lines.push(format!("  {title}"));
        }
    }
    lines.push("Sotto curricular alignment. Source exposure never grants mastery.".into());
    if let Some(references) = map["references"].as_array() {
        for reference in references {
            lines.push(format!(
                "{}: {}",
                map_text(&reference["title"]),
                map_text(&reference["url"])
            ));
        }
    }
    lines.join("\n")
}

fn map_detail(map: &serde_json::Value, id: &str) -> String {
    let Some(entry) = map["nodes"]
        .as_array()
        .and_then(|nodes| nodes.iter().find(|entry| entry["node"]["id"] == id))
    else {
        return "The selected objective is unavailable. Refresh the map.".into();
    };
    let node = &entry["node"];
    let mut lines = vec![
        map_text(&node["title"]),
        map_text(&node["description"]),
        String::new(),
    ];
    if node["kind"] == "GROUP" {
        lines.push(format!(
            "Group summary: {} confident / {} objectives.",
            entry["summary"]["confident"], entry["summary"]["total"]
        ));
        lines.push(
            "Space selects this group. Its server preview will name the exact objectives.".into(),
        );
    } else {
        lines.push(format!(
            "Status: {} · {} · criterion {}",
            map_text(&entry["progress"]["status"]),
            map_text(&node["level"]),
            node["criterionVersion"]
        ));
        lines.push(format!("Goal: {}", map_text(&node["assessment"])));
        if let Some(criteria) = node["skillCriteria"].as_object() {
            for (skill, criterion) in criteria {
                lines.push(format!("\n{skill}: {}", map_text(criterion)));
            }
        }
        if let Some(skills) = entry["progress"]["skills"].as_array() {
            for skill in skills {
                lines.push(format!(
                    "{}: {}{}",
                    map_text(&skill["skill"]),
                    map_text(&skill["status"]),
                    if skill["exempt"] == true {
                        " (provider exemption)"
                    } else {
                        ""
                    }
                ));
            }
        }
        if let Some(examples) = node["examples"].as_array() {
            lines.push("\nExamples:".into());
            for example in examples {
                lines.push(map_text(example));
            }
        }
    }
    lines.join("\n")
}
