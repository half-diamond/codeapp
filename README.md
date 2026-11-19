# CodeSync

Node 20+, MySQL 8, and (for Docker sandbox mode) Docker are required. Run `npm install`, copy `.env.example` to `.env`, configure MySQL, then run `npm run db:init` and `npm start`. Open `http://localhost:3000`.

Set `DB_HOST`, `DB_PORT`, `DB_USER`, `DB_PASSWORD`, and `DB_NAME` for MySQL, `PORT` for HTTP, and `SANDBOX_MODE` to `local` or `docker`.

`SANDBOX_MODE=local` runs submitted programs as the server account in temporary folders with a 2 second runtime limit. This mode is for trusted, local development only; use `docker` for untrusted code. Docker mode requires the `gcc:13` and `python:3.11-alpine` images. Both modes disable network access for containers and cap runtime output.

## Layout

`src/` contains the HTTP/WebSocket server, SQL access, queue, runner, and routes. `public/` is the dependency-free browser client and IndexedDB offline queue. `sql/schema.sql` creates and seeds the InnoDB schema; `sql/benchmark.sql` has the index plan comparisons. `tests/` covers hashing and rate limiting.

## Design notes

Workspace writes use a version predicate and return the current row on a conflict. Submission history uses a `(created_at, id)` keyset cursor. The leaderboard aggregates per user before applying MySQL 8 `DENSE_RANK()`, so it works with `ONLY_FULL_GROUP_BY`. Worker queues are in-process partitions; idempotency keys are held in memory and reset when the server restarts.

## Index check

Run `mysql -u root -p codesync < sql/benchmark.sql` on a seeded MySQL 8 instance. The file includes `EXPLAIN ANALYZE` with the composite index ignored and forced, respectively. On the small seed set, either plan may be faster; use a representative production-sized dataset when comparing actual timings. Example output shape:

```text
-> Filter: (status = 'ACCEPTED')
    -> Table scan on submissions
-> Index lookup on submissions using idx_sub_prob_status_time
    (problem_id=1, status='ACCEPTED')
```
