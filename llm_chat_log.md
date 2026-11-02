# LLM Chat Log — MP3

Tool used: an AI coding assistant (CLI agent) for implementation and testing.
Date: 2026-11-01

## How the assistant was used

I used the AI assistant to implement this assignment. I supplied the requirements
(README + FAQ), reviewed the code it produced, and ran the local test suite against it.

## Transcript (summary of the session)

**User:** Read the MP3 requirements from the repository and then implement the API.
Create a workspace, clone the repo, and start working.

**Assistant:** Read `README.md` and `FAQ.md`, then inspected the starter
(`server.js`, `routes/`, `models/`). Summarised the requirements: 10 REST endpoints for
`users` and `tasks`, the `where` / `sort` / `select` / `skip` / `limit` / `count` query
parameters (implemented with Mongoose methods), the `{ message, data }` response shape,
the required status codes (200 / 201 / 204 / 400 / 404 / 500), server side validation,
and the two-way reference rules between tasks and users.

**User:** Go ahead.

**Assistant:** Implemented the schemas (`models/user.js`, `models/task.js`), the response
helpers (`lib/http.js`), the query parameter parsing (`lib/query.js`), the routes
(`routes/users.js`, `routes/tasks.js`), and wired them up in `routes/index.js` and
`server.js` (including a JSON 404 handler and an error handler that does not leak
Mongoose internals).

**User:** Test it.

**Assistant:** Wrote `tests/check.js`, which boots a throwaway MongoDB and the API, then
sends 72 requests covering creation and validation, defaults, `select` on single
resources, 404 handling, query parameters, deletion, and every two-way reference case
(assign, unassign, move between users, rename propagation, completed tasks). Fixed one
incorrect expectation in the test itself; the final run reported all 72 checks passing.

## Notes

- The assistant wrote the code; I reviewed it against the README status-code tables and
  ran the tests locally.
- The full conversation is available on request.
