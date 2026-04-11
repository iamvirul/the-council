# Security Policy

## Supported Versions

| Version | Supported |
|---------|-----------|
| 0.1.x   | Yes       |

## Reporting a Vulnerability

Do not open a public GitHub issue for security vulnerabilities.

Report them privately via [GitHub Security Advisories](https://github.com/iamvirul/the-council/security/advisories/new). Include:

- A description of the vulnerability
- Steps to reproduce
- Potential impact
- Any suggested fix (optional)

You should receive a response within 48 hours. If the issue is confirmed, a patch will be released as soon as possible depending on severity.

## Scope

Things that are in scope:

- Prompt injection through MCP tool inputs or agent responses that allows unintended tool execution or data exfiltration
- Input validation bypasses that circumvent the Zod schemas on tool inputs or agent JSON responses
- Log contamination — anything that causes structured data to leak onto stdout (reserved for MCP JSON-RPC)
- Session state issues that allow one session to read or corrupt another session's data
- Dependency vulnerabilities in the published package

Things that are out of scope:

- Vulnerabilities in Claude models themselves (report those to [Anthropic](https://www.anthropic.com/security))
- Issues that require physical access to the machine running the server
- Social engineering

## Security Design Notes

A few decisions worth knowing when evaluating this project:

- **Agent output validation** - all JSON responses from Chancellor, Executor, and Aide are validated against Zod schemas before being used. Malformed or schema-violating responses are rejected with a typed error.
- **Delegated task cap** - Executor responses are limited to 10 delegated tasks. This prevents prompt-injection-driven amplification of Aide invocations.
- **Input length limits** - all MCP tool inputs have explicit max-length constraints.
- **stderr-only logging** - all logs go to stderr. stdout is reserved exclusively for MCP JSON-RPC traffic.
- **No stack traces to callers** - internal errors are logged server-side; only a sanitized message is returned to MCP tool callers.
- **Session isolation** - sessions are keyed by `crypto.randomUUID()` and stored in an in-memory LRU map capped at 500 entries.
