import { Router } from 'express';
import { query } from '../db.js';
import { jobQueue, idempotencyCache } from '../jobQueue.js';
import { ExecutorFactory } from '../executors/factory.js';

const router = Router();
const cursorEncode = (row) => Buffer.from(JSON.stringify({ at: new Date(row.created_at).toISOString(), id: row.id })).toString('base64url');

router.get('/problems', async (_req, res, next) => {
  try {
    const [rows] = await query(`SELECT p.id, p.slug, p.title, p.description, p.time_limit_ms,
      c.input_data AS sample_input, c.expected_output AS sample_output
      FROM problems AS p LEFT JOIN test_cases AS c ON c.problem_id = p.id AND c.is_sample = TRUE
      ORDER BY p.id`);
    res.json(rows);
  } catch (error) { next(error); }
});

router.get('/users', async (_req, res, next) => {
  try {
    const [rows] = await query('SELECT id, username, department FROM users ORDER BY department, username');
    res.json(rows);
  } catch (error) { next(error); }
});

router.get('/', async (req, res, next) => {
  const limit = Math.min(100, Math.max(1, Number.parseInt(req.query.limit, 10) || 20));
  try {
    let cursor;
    if (req.query.cursor) {
      try {
        cursor = JSON.parse(Buffer.from(String(req.query.cursor), 'base64url').toString('utf8'));
        if (!cursor.at || !Number.isInteger(Number(cursor.id)) || Number.isNaN(Date.parse(cursor.at))) throw new Error();
      } catch { return res.status(400).json({ error: 'Invalid cursor' }); }
    }
    const sql = `SELECT s.id, s.user_id, u.username, s.problem_id, p.title AS problem_title,
      s.language, s.status, s.exec_time_ms, s.worker_node, s.created_at
      FROM submissions AS s JOIN users AS u ON u.id = s.user_id JOIN problems AS p ON p.id = s.problem_id
      ${cursor ? 'WHERE (s.created_at, s.id) < (?, ?)' : ''}
      ORDER BY s.created_at DESC, s.id DESC LIMIT ?`;
    const values = cursor ? [new Date(cursor.at), cursor.id, limit + 1] : [limit + 1];
    const [rows] = await query(sql, values);
    const hasMore = rows.length > limit;
    if (hasMore) rows.pop();
    res.json({ items: rows, nextCursor: hasMore && rows.length ? cursorEncode(rows.at(-1)) : null });
  } catch (error) { next(error); }
});

router.post('/', async (req, res, next) => {
  const { user_id: userId, problem_id: problemId, language, code } = req.body || {};
  const key = req.get('Idempotency-Key');
  if (!key || key.length > 128 || !/^[\w.:-]{8,128}$/.test(key)) return res.status(400).json({ error: 'A valid Idempotency-Key header is required' });
  if (!Number.isInteger(Number(userId)) || !Number.isInteger(Number(problemId)) || !['cpp', 'python'].includes(language) ||
      typeof code !== 'string' || code.length > 100000) {
    return res.status(400).json({ error: 'Invalid submission fields' });
  }
  const claim = idempotencyCache.claim(key);
  if (!claim.owner) {
    try { return res.status(202).json({ submission_id: await claim.result, duplicate: true }); }
    catch { return res.status(503).json({ error: 'Original request failed; retry with a new idempotency key' }); }
  }
  try {
    const [[problemRows], [userRows]] = await Promise.all([
      query('SELECT id FROM problems WHERE id = ?', [problemId]),
      query('SELECT id FROM users WHERE id = ?', [userId])
    ]);
    if (!problemRows.length || !userRows.length) {
      const error = new Error('Unknown user or problem');
      error.status = 404;
      throw error;
    }
    const [caseRows] = await query('SELECT input_data, expected_output FROM test_cases WHERE problem_id = ? ORDER BY id', [problemId]);
    if (!caseRows.length) {
      const error = new Error('Problem has no test cases');
      error.status = 422;
      throw error;
    }
    const workerNode = jobQueue.workerFor(String(problemId));
    const [insert] = await query(
      "INSERT INTO submissions (user_id, problem_id, language, code, status, worker_node) VALUES (?, ?, ?, ?, 'PENDING', ?)",
      [userId, problemId, language, code, workerNode]
    );
    claim.resolve(insert.insertId);
    const submissionId = insert.insertId;
    jobQueue.enqueue(workerNode, async () => {
      let verdict;
      try {
        verdict = await ExecutorFactory.create(language).execute(code, caseRows);
      } catch (error) {
        verdict = { status: 'RUNTIME_ERROR', execTimeMs: 0, message: error.message };
      }
      await query('UPDATE submissions SET status = ?, exec_time_ms = ? WHERE id = ?', [verdict.status, verdict.execTimeMs, submissionId]);
      req.app.get('broadcast')({ type: 'verdict', submission_id: submissionId, ...verdict });
    }).catch((error) => console.error(`Submission ${submissionId}: ${error.message}`));
    res.status(202).json({ submission_id: submissionId, worker_node: workerNode });
  } catch (error) {
    claim.reject(error);
    idempotencyCache.entries.delete(key);
    next(error);
  }
});

router.get('/:id', async (req, res, next) => {
  try {
    const [rows] = await query('SELECT id, user_id, problem_id, language, status, exec_time_ms, worker_node, created_at FROM submissions WHERE id = ?', [req.params.id]);
    if (!rows.length) return res.status(404).json({ error: 'Submission not found' });
    res.json(rows[0]);
  } catch (error) { next(error); }
});

export default router;
