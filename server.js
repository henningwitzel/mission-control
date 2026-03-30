const express = require('express');
const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');

const app = express();
const PORT = 3456;
const HOME = require('os').homedir();
const MEMORY_DIR = path.join(HOME, '.openclaw/workspace/memory');
const DATA_DIR = path.join(HOME, '.openclaw/workspace/data');
const TASKS_FILE = path.join(DATA_DIR, 'tasks.json');
const KB_PATH = path.join(DATA_DIR, 'knowledge.db');

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// --- Helpers ---
function readTasks() {
  try {
    return JSON.parse(fs.readFileSync(TASKS_FILE, 'utf-8'));
  } catch {
    return { tasks: [], activity: [] };
  }
}

function writeTasks(data) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(TASKS_FILE, JSON.stringify(data, null, 2));
}

function getDb() {
  const Database = require('better-sqlite3');
  const db = new Database(KB_PATH, { readonly: true });
  db.pragma('trusted_schema = ON');
  return db;
}

// --- Memory API (existing) ---
app.get('/api/dates', (req, res) => {
  try {
    const files = fs.readdirSync(MEMORY_DIR)
      .filter(f => /^\d{4}-\d{2}-\d{2}\.md$/.test(f))
      .map(f => f.replace('.md', ''))
      .sort();
    res.json(files);
  } catch {
    res.json([]);
  }
});

app.get('/api/memory/:date', (req, res) => {
  const date = req.params.date;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return res.status(400).json({ error: 'Invalid date format' });
  }
  const filePath = path.join(MEMORY_DIR, `${date}.md`);
  try {
    const content = fs.readFileSync(filePath, 'utf-8');
    res.json({ date, content });
  } catch {
    res.status(404).json({ error: 'No entry for this date' });
  }
});

// --- Tasks API ---
app.get('/api/tasks', (req, res) => {
  res.json(readTasks());
});

app.post('/api/tasks', (req, res) => {
  const { title, description, assignee } = req.body;
  if (!title) return res.status(400).json({ error: 'Title required' });

  const data = readTasks();
  const id = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  const now = new Date().toISOString();
  const task = {
    id,
    title,
    description: description || '',
    assignee: assignee || 'Henning',
    status: 'backlog',
    created_at: now,
    updated_at: now
  };
  data.tasks.push(task);
  data.activity.unshift({ task_id: id, title, action: 'created', from: null, to: 'backlog', time: now });
  data.activity = data.activity.slice(0, 50);
  writeTasks(data);
  res.json(task);
});

app.patch('/api/tasks/:id', (req, res) => {
  const data = readTasks();
  const task = data.tasks.find(t => t.id === req.params.id);
  if (!task) return res.status(404).json({ error: 'Task not found' });

  const oldStatus = task.status;
  const now = new Date().toISOString();

  if (req.body.status) task.status = req.body.status;
  if (req.body.title !== undefined) task.title = req.body.title;
  if (req.body.description !== undefined) task.description = req.body.description;
  if (req.body.assignee !== undefined) task.assignee = req.body.assignee;
  task.updated_at = now;

  if (req.body.status && req.body.status !== oldStatus) {
    data.activity.unshift({ task_id: task.id, title: task.title, action: 'moved', from: oldStatus, to: req.body.status, time: now });
    data.activity = data.activity.slice(0, 50);
  }

  writeTasks(data);
  res.json(task);
});

app.delete('/api/tasks/:id', (req, res) => {
  const data = readTasks();
  const idx = data.tasks.findIndex(t => t.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'Task not found' });
  const [removed] = data.tasks.splice(idx, 1);
  const now = new Date().toISOString();
  data.activity.unshift({ task_id: removed.id, title: removed.title, action: 'deleted', from: removed.status, to: null, time: now });
  data.activity = data.activity.slice(0, 50);
  writeTasks(data);
  res.json({ ok: true });
});

// --- Crons API ---
app.get('/api/crons', (req, res) => {
  const openclawPath = process.env.OPENCLAW_PATH || '/Users/henning/.nvm/versions/node/v24.14.0/bin/openclaw';
  execFile(openclawPath, ['cron', 'list', '--json'], { timeout: 10000 }, (err, stdout) => {
    if (err) {
      return res.json({ crons: [], error: err.message });
    }
    try {
      const parsed = JSON.parse(stdout);
      res.json({ crons: Array.isArray(parsed) ? parsed : (parsed.jobs || parsed.crons || parsed.data || []) });
    } catch {
      res.json({ crons: [], raw: stdout });
    }
  });
});

// --- Knowledge Base API ---
app.get('/api/kb/stats', (req, res) => {
  try {
    const db = getDb();
    const row = db.prepare('SELECT COUNT(*) as count FROM sources').get();
    const types = db.prepare('SELECT source_type, COUNT(*) as count FROM sources GROUP BY source_type').all();
    db.close();
    res.json({ total: row.count, by_type: types });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/kb/search', (req, res) => {
  const q = (req.query.q || '').trim();
  if (!q) return res.json({ results: [], query: '' });

  try {
    const db = getDb();
    const results = db.prepare(`
      SELECT s.id, s.title, s.url, s.summary, s.source_type, s.depth, s.date_added,
             s.author, s.domain, s.content_full, s.relevance
      FROM sources_fts fts
      JOIN sources s ON s.id = fts.rowid
      WHERE sources_fts MATCH ?
      ORDER BY rank
      LIMIT 30
    `).all(q);
    db.close();
    res.json({ results, query: q });
  } catch (e) {
    res.status(500).json({ error: e.message, results: [] });
  }
});

app.listen(PORT, () => {
  console.log(`Mission Control running at http://localhost:${PORT}`);
});
