EXPLAIN ANALYZE
SELECT id, exec_time_ms
FROM submissions IGNORE INDEX (idx_sub_prob_status_time)
WHERE problem_id = 1 AND status = 'ACCEPTED'
ORDER BY exec_time_ms;

EXPLAIN ANALYZE
SELECT id, exec_time_ms
FROM submissions FORCE INDEX (idx_sub_prob_status_time)
WHERE problem_id = 1 AND status = 'ACCEPTED'
ORDER BY exec_time_ms;
