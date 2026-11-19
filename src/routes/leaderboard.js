import { Router } from 'express';
import { query } from '../db.js';

const router = Router();

router.get('/', async (_req, res, next) => {
  try {
    const [rows] = await query(`
      WITH user_stats AS (
        SELECT u.id, u.username, u.department,
          COUNT(DISTINCT CASE WHEN s.status = 'ACCEPTED' THEN s.problem_id END) AS problems_solved,
          COALESCE(SUM(CASE WHEN s.status = 'ACCEPTED' THEN s.exec_time_ms ELSE 0 END), 0) AS total_time_ms
        FROM users AS u
        LEFT JOIN submissions AS s ON s.user_id = u.id
        GROUP BY u.id, u.username, u.department
      ), ranked AS (
        SELECT id, username, department, problems_solved, total_time_ms,
          DENSE_RANK() OVER (PARTITION BY department ORDER BY problems_solved DESC, total_time_ms ASC) AS department_rank
        FROM user_stats
      )
      SELECT id, username, department, problems_solved, total_time_ms, department_rank
      FROM ranked ORDER BY department, department_rank, username
    `);
    res.json(rows);
  } catch (error) { next(error); }
});

export default router;
