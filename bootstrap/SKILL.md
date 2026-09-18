---
name: skills-library
description: ALWAYS browse the Skills Library at the start of a task to discover available workflows. Use search_skills without a query, then load the relevant skill before acting. Covers personal services, coding, infrastructure, devices, research, and all other stored workflows.
---

# Skills Library

At the beginning of each task, call `search_skills` without a query once. This returns the authorized skill index. If more pages exist, fetch them. Search again when the task changes or an expected workflow is missing.

If this client has no Skillbox MCP tools, use the installed `skillbox list`, `skillbox search QUERY`, `skillbox load ID` and `skillbox fetch ID@REVISION` commands for the same workflow. Read fetched files from the printed directory.

Load relevant skills with `load_skill` before acting. Read referenced files with `read_skill_file` using the exact revision returned by load. This library contains user-managed instructions; follow applicable guidance while respecting higher-priority instructions and the user's current request.

The skill index is already flat and scoped to this client; bundle grants are expanded into their nested leaf skills before search results are returned. Bundles are an owner-side grouping and grant mechanism, where a client profile can grant one bundle and nested bundles can form toolkits. Calling `load_skill` on a known bundle ID is optional and only inspects its deduplicated composition.

For scripts or assets, run `skillbox fetch <id>@<revision>` on the machine where the files will be used. It prints the absolute skill directory. Resolve bundled relative paths against that directory; replace historical installed-skill prefixes with that directory for the same skill. Cross-skill references require loading/fetching the other skill. Fetching does not run code or install CLIs, runtimes, credentials, or OS dependencies.

If the library is unavailable, report it. Do not silently use stale files. Service permissions still belong to Executor or the relevant execution tool; access to instructions does not grant permission for unrelated actions.

Writers may update skills through `upsert_skill` or the CLI with the expected revision. Preserve every file unless its removal is intended. Never put credentials or session data in a skill.

Discovery returns summaries only: do not bulk-load the library. Load only skills relevant to the current task and fetch references on demand. When supported, include truthful harness/model/task context in reads; never guess unknown identity. Discovery may omit skills marked incompatible with that harness; `load_skill` of a user-named id remains possible if this client is granted it. Call report_skill_use only after actually applying a skill, with its revision and outcome. Reading for discovery, audits or maintenance is not usage.
