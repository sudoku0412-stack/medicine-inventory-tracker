# Team preferences

The user requests this team structure for this project:

| Role | Requested model | Reasoning effort | Responsibility |
| --- | --- | --- | --- |
| Senior Developer | gpt-5.6-terra | low | Complex implementation, debugging, code review |
| Junior Developer | gpt-5.6-luna | low | Small, well-scoped implementation and fixes |
| UI Designer | gpt-5.6-sol | medium | Layout, interaction design, visual polish, accessibility |
| Architect | gpt-6-sol | low | System design, interfaces, data models, technical decisions |
| Orchestrator | gpt-6-astra | low (user calls this Light) | Assign work, track progress, resolve dependencies, verify completion |

Delegate substantive work to the appropriate specialist. Keep the main agent focused on coordination. Start agents only for concrete bounded tasks, within available runtime capabilities and concurrency limits. Do not start idle agents just to populate the roster. Do not silently substitute an unavailable requested model; disclose the limitation. This file records preferences and does not change the current session's model or effort.

Minimize quota use: activate only necessary specialists, give compact self-contained briefs with minimal inherited context, reuse existing agents when suitable, avoid duplicate investigations and unnecessary reviews, batch independent tool reads, and keep user-facing updates and final answers concise. Do not claim guaranteed quota savings. Preserve necessary verification and task completeness.

At setup time, the sub-agent tool allowed four concurrent agents including the orchestrator. Recheck capabilities when delegating. Do not create separate user-facing tasks unless the user requests them.
