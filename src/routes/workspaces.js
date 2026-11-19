import { Router } from 'express';
import { query } from '../db.js';

const router = Router();
const languages = new Set(['cpp', 'python']);

router.get('/', async (_req, res, next) => {
  try {
    const [rows] = await query('SELECT id, title, language, version, updated_at FROM workspaces ORDER BY id');
    res.json(rows);
  } catch (error) { next(error); }
});

router.get('/:id', async (req, res, next) => {
  try {
    const [rows] = await query('SELECT id, title, language, code, version, updated_at FROM workspaces WHERE id = ?', [req.params.id]);
    if (!rows.length) return res.status(404).json({ error: 'Workspace not found' });
    res.json(rows[0]);
  } catch (error) { next(error); }
});

router.post('/', async (req, res, next) => {
  const { title, language = 'python', code = '' } = req.body || {};
  if (typeof title !== 'string' || !title.trim() || title.length > 120 || !languages.has(language) || typeof code !== 'string') {
    return res.status(400).json({ error: 'Invalid workspace fields' });
  }
  try {
    const [result] = await query('INSERT INTO workspaces (title, language, code) VALUES (?, ?, ?)', [title.trim(), language, code]);
    const [rows] = await query('SELECT id, title, language, code, version, updated_at FROM workspaces WHERE id = ?', [result.insertId]);
    res.status(201).json(rows[0]);
  } catch (error) { next(error); }
});

router.put('/:id', async (req, res, next) => {
  const { title, language, code, version } = req.body || {};
  if (typeof title !== 'string' || !title.trim() || title.length > 120 || !languages.has(language) ||
      typeof code !== 'string' || !Number.isInteger(version) || version < 1) {
    return res.status(400).json({ error: 'Invalid workspace fields or version' });
  }
  try {
    const [result] = await query(
      'UPDATE workspaces SET title = ?, language = ?, code = ?, version = version + 1 WHERE id = ? AND version = ?',
      [title.trim(), language, code, req.params.id, version]
    );
    if (result.affectedRows === 0) {
      const [rows] = await query('SELECT id, title, language, code, version, updated_at FROM workspaces WHERE id = ?', [req.params.id]);
      if (!rows.length) return res.status(404).json({ error: 'Workspace not found' });
      return res.status(409).json({ error: 'Workspace changed on the server', latest: rows[0] });
    }
    const [rows] = await query('SELECT id, title, language, code, version, updated_at FROM workspaces WHERE id = ?', [req.params.id]);
    req.app.get('broadcastRoom')(String(req.params.id), { type: 'saved', workspace: rows[0] }, req.get('X-Client-Id'));
    res.json(rows[0]);
  } catch (error) { next(error); }
});

router.delete('/:id', async (req, res, next) => {
  try {
    const [result] = await query('DELETE FROM workspaces WHERE id = ?', [req.params.id]);
    if (!result.affectedRows) return res.status(404).json({ error: 'Workspace not found' });
    res.status(204).end();
  } catch (error) { next(error); }
});

export default router;
