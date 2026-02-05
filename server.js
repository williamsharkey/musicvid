import express from 'express';
import { createServer } from 'http';
import { WebSocketServer } from 'ws';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 3000;

const app = express();
const server = createServer(app);
const wss = new WebSocketServer({ server });

// Ensure project directory exists
const PROJECT_DIR = join(__dirname, 'project');
for (const sub of ['style-refs', 'keyframes', 'clips', 'output']) {
  mkdirSync(join(PROJECT_DIR, sub), { recursive: true });
}

// Serve static files
app.use(express.static(join(__dirname, 'public')));
app.use('/project', express.static(PROJECT_DIR));
app.use(express.json({ limit: '50mb' }));

// --- REST API ---

// Load project state
app.get('/api/project', (req, res) => {
  const projectFile = join(PROJECT_DIR, 'project.json');
  if (existsSync(projectFile)) {
    res.json(JSON.parse(readFileSync(projectFile, 'utf-8')));
  } else {
    const initial = {
      title: '',
      artist: '',
      style: '',
      lyrics: '',
      audioFile: null,
      bpm: null,
      stage: 'init' // init, transcribed, annotated, storyboarded, sliced, keyframed, clipped, done
    };
    writeFileSync(projectFile, JSON.stringify(initial, null, 2));
    res.json(initial);
  }
});

// Save project state
app.post('/api/project', (req, res) => {
  writeFileSync(join(PROJECT_DIR, 'project.json'), JSON.stringify(req.body, null, 2));
  broadcast({ type: 'project-updated', data: req.body });
  res.json({ ok: true });
});

// Timeline (word-level timestamps)
app.get('/api/timeline', (req, res) => {
  const f = join(PROJECT_DIR, 'timeline.json');
  res.json(existsSync(f) ? JSON.parse(readFileSync(f, 'utf-8')) : []);
});

app.post('/api/timeline', (req, res) => {
  writeFileSync(join(PROJECT_DIR, 'timeline.json'), JSON.stringify(req.body, null, 2));
  broadcast({ type: 'timeline-updated' });
  res.json({ ok: true });
});

// Scenes (segmented timeline)
app.get('/api/scenes', (req, res) => {
  const f = join(PROJECT_DIR, 'scenes.json');
  res.json(existsSync(f) ? JSON.parse(readFileSync(f, 'utf-8')) : []);
});

app.post('/api/scenes', (req, res) => {
  writeFileSync(join(PROJECT_DIR, 'scenes.json'), JSON.stringify(req.body, null, 2));
  broadcast({ type: 'scenes-updated' });
  res.json({ ok: true });
});

// Annotations
app.get('/api/annotations', (req, res) => {
  const f = join(PROJECT_DIR, 'annotations.json');
  res.json(existsSync(f) ? JSON.parse(readFileSync(f, 'utf-8')) : []);
});

app.post('/api/annotations', (req, res) => {
  writeFileSync(join(PROJECT_DIR, 'annotations.json'), JSON.stringify(req.body, null, 2));
  broadcast({ type: 'annotations-updated' });
  res.json({ ok: true });
});

// Storyboard
app.get('/api/storyboard', (req, res) => {
  const f = join(PROJECT_DIR, 'storyboard.json');
  res.json(existsSync(f) ? JSON.parse(readFileSync(f, 'utf-8')) : { scenes: [] });
});

app.post('/api/storyboard', (req, res) => {
  writeFileSync(join(PROJECT_DIR, 'storyboard.json'), JSON.stringify(req.body, null, 2));
  broadcast({ type: 'storyboard-updated' });
  res.json({ ok: true });
});

// Keyframe prompts
app.get('/api/keyframe-prompts', (req, res) => {
  const f = join(PROJECT_DIR, 'keyframe-prompts.json');
  res.json(existsSync(f) ? JSON.parse(readFileSync(f, 'utf-8')) : []);
});

app.post('/api/keyframe-prompts', (req, res) => {
  writeFileSync(join(PROJECT_DIR, 'keyframe-prompts.json'), JSON.stringify(req.body, null, 2));
  broadcast({ type: 'keyframe-prompts-updated' });
  res.json({ ok: true });
});

// Audio file upload
app.post('/api/upload-audio', express.raw({ type: 'audio/*', limit: '100mb' }), (req, res) => {
  const ext = req.headers['content-type']?.includes('wav') ? 'wav' : 'mp3';
  const dest = join(PROJECT_DIR, `audio.${ext}`);
  writeFileSync(dest, req.body);
  res.json({ path: `audio.${ext}` });
});

// --- WebSocket ---

const clients = new Set();

wss.on('connection', (ws) => {
  clients.add(ws);
  ws.on('close', () => clients.delete(ws));
  ws.on('message', (raw) => {
    try {
      const msg = JSON.parse(raw);
      handleWsMessage(ws, msg);
    } catch (e) {
      ws.send(JSON.stringify({ type: 'error', message: e.message }));
    }
  });
  // Send current state on connect
  ws.send(JSON.stringify({ type: 'connected', message: 'musicvid server' }));
});

function broadcast(msg) {
  const data = JSON.stringify(msg);
  for (const ws of clients) {
    if (ws.readyState === 1) ws.send(data);
  }
}

function handleWsMessage(ws, msg) {
  switch (msg.type) {
    case 'ping':
      ws.send(JSON.stringify({ type: 'pong' }));
      break;
    default:
      // Forward to all clients (for multi-window coordination)
      broadcast(msg);
  }
}

server.listen(PORT, () => {
  console.log(`musicvid server running at http://localhost:${PORT}`);
});
