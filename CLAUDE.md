# CLAUDE.md

Весь контекст для AI-агентов — в общем файле:

@AGENTS.md

Кратко: перед работой с кодом используй граф кодовой базы (codebase-memory-mcp,
конфиг в `.mcp.json`, готовый индекс в `.codebase-memory/graph.db.zst`) вместо
сплошного чтения файлов — `get_graph_schema` → `search_graph` → `trace_path` →
`get_code_snippet`.
