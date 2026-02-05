import express from 'express';
import { createServer } from 'http';
import { WebSocketServer } from 'ws';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { spawn } from 'child_process';

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

// Style anchor image upload
app.post('/api/upload-style-anchor', express.raw({ type: 'image/*', limit: '20mb' }), (req, res) => {
  const contentType = req.headers['content-type'] || '';
  let ext = 'jpg';
  if (contentType.includes('png')) ext = 'png';
  else if (contentType.includes('webp')) ext = 'webp';

  mkdirSync(join(PROJECT_DIR, 'style-refs'), { recursive: true });
  const dest = join(PROJECT_DIR, 'style-refs', `anchor.${ext}`);
  writeFileSync(dest, req.body);
  res.json({ path: `style-refs/anchor.${ext}` });
});

// --- Suno API proxy ---
const SUNO_API = 'https://studio-api.prod.suno.com';

function getSunoToken() {
  const cookieFile = join(__dirname, '.suno-cookie');
  if (!existsSync(cookieFile)) return null;
  const cookie = readFileSync(cookieFile, 'utf-8').trim();
  const match = cookie.match(/__session=([^;]+)/);
  if (match) return match[1];
  if (cookie.startsWith('eyJ')) return cookie;
  return null;
}

// Save Suno cookie
app.post('/api/suno/cookie', (req, res) => {
  const { cookie } = req.body;
  if (!cookie) return res.status(400).json({ error: 'No cookie provided' });

  // Extract __session if full cookie string provided
  let sessionCookie = cookie;
  if (cookie.includes('__session=')) {
    const match = cookie.match(/__session=([^;]+)/);
    if (match) sessionCookie = `__session=${match[1]}`;
  }

  writeFileSync(join(__dirname, '.suno-cookie'), sessionCookie);
  res.json({ ok: true });
});

// List Suno songs
app.get('/api/suno/songs', async (req, res) => {
  const token = getSunoToken();
  if (!token) return res.status(401).json({ error: 'No Suno cookie. Save to .suno-cookie' });

  const page = req.query.page || 0;
  try {
    const resp = await fetch(`${SUNO_API}/api/feed/v2?page=${page}`, {
      headers: {
        'Authorization': `Bearer ${token}`,
        'User-Agent': 'Mozilla/5.0',
        'Accept': 'application/json'
      }
    });
    if (!resp.ok) {
      return res.status(resp.status).json({ error: `Suno API: ${resp.status}` });
    }
    const data = await resp.json();
    res.json(data);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Get single Suno song details
app.get('/api/suno/song/:id', async (req, res) => {
  const token = getSunoToken();
  if (!token) return res.status(401).json({ error: 'No Suno cookie' });

  try {
    const resp = await fetch(`${SUNO_API}/api/clip/${req.params.id}`, {
      headers: {
        'Authorization': `Bearer ${token}`,
        'User-Agent': 'Mozilla/5.0',
        'Accept': 'application/json'
      }
    });
    if (!resp.ok) {
      return res.status(resp.status).json({ error: `Suno API: ${resp.status}` });
    }
    res.json(await resp.json());
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Download and select a Suno song
app.post('/api/suno/select/:id', async (req, res) => {
  const token = getSunoToken();
  if (!token) return res.status(401).json({ error: 'No Suno cookie' });

  try {
    const resp = await fetch(`${SUNO_API}/api/clip/${req.params.id}`, {
      headers: {
        'Authorization': `Bearer ${token}`,
        'User-Agent': 'Mozilla/5.0',
        'Accept': 'application/json'
      }
    });
    if (!resp.ok) throw new Error(`Suno API: ${resp.status}`);
    const data = await resp.json();

    if (!data.audio_url) throw new Error('No audio URL');

    // Download audio
    const audioResp = await fetch(data.audio_url);
    const audioBuffer = Buffer.from(await audioResp.arrayBuffer());
    writeFileSync(join(PROJECT_DIR, 'audio.mp3'), audioBuffer);

    // Download cover if exists
    if (data.image_url) {
      const imgResp = await fetch(data.image_url);
      const imgBuffer = Buffer.from(await imgResp.arrayBuffer());
      mkdirSync(join(PROJECT_DIR, 'style-refs'), { recursive: true });
      writeFileSync(join(PROJECT_DIR, 'style-refs', 'suno-cover.jpg'), imgBuffer);
    }

    // Update project
    const projectFile = join(PROJECT_DIR, 'project.json');
    const project = existsSync(projectFile)
      ? JSON.parse(readFileSync(projectFile, 'utf-8'))
      : {};

    project.title = data.title || 'Untitled';
    project.artist = 'Suno AI';
    project.style = data.metadata?.tags || '';
    project.lyrics = data.metadata?.prompt || '';
    project.duration = Math.round(data.duration) || null;
    project.audioFile = 'audio.mp3';
    project.sunoId = req.params.id;
    project.stage = 'setup';

    writeFileSync(projectFile, JSON.stringify(project, null, 2));
    broadcast({ type: 'project-updated', data: project });

    res.json({ ok: true, project });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// --- Pipeline runners ---

// Run transcription (Whisper)
app.post('/api/pipeline/transcribe', async (req, res) => {
  const audioFile = join(PROJECT_DIR, 'audio.mp3');
  if (!existsSync(audioFile)) {
    const wavFile = join(PROJECT_DIR, 'audio.wav');
    if (!existsSync(wavFile)) {
      return res.status(400).json({ error: 'No audio file. Select a song first.' });
    }
  }

  broadcast({ type: 'pipeline-status', stage: 'transcribe', status: 'running', message: 'Starting Whisper transcription...' });

  // Use the venv Python with faster-whisper installed
  const venvPython = join(__dirname, '.venv', 'bin', 'python3');
  const pythonCmd = existsSync(venvPython) ? venvPython : 'python3';

  const proc = spawn(pythonCmd, [join(__dirname, 'pipeline', 'transcribe.py')], {
    cwd: __dirname,
    env: { ...process.env }
  });

  let stdout = '';
  let stderr = '';

  proc.stdout.on('data', (data) => {
    stdout += data.toString();
    broadcast({ type: 'pipeline-log', stage: 'transcribe', message: data.toString() });
  });

  proc.stderr.on('data', (data) => {
    stderr += data.toString();
    broadcast({ type: 'pipeline-log', stage: 'transcribe', message: data.toString() });
  });

  proc.on('close', (code) => {
    if (code === 0) {
      // Update project stage
      const projectFile = join(PROJECT_DIR, 'project.json');
      if (existsSync(projectFile)) {
        const project = JSON.parse(readFileSync(projectFile, 'utf-8'));
        project.stage = 'transcribed';
        writeFileSync(projectFile, JSON.stringify(project, null, 2));
        broadcast({ type: 'project-updated', data: project });
      }
      broadcast({ type: 'pipeline-status', stage: 'transcribe', status: 'done', message: 'Transcription complete!' });
      broadcast({ type: 'timeline-updated' });
    } else {
      broadcast({ type: 'pipeline-status', stage: 'transcribe', status: 'error', message: `Transcription failed (exit ${code})` });
    }
  });

  res.json({ ok: true, message: 'Transcription started' });
});

// Run storyboard generation (Claude)
app.post('/api/pipeline/storyboard', async (req, res) => {
  broadcast({ type: 'pipeline-status', stage: 'storyboard', status: 'running', message: 'Generating storyboard with Claude...' });

  const proc = spawn('node', [join(__dirname, 'pipeline', 'storyboard.js')], {
    cwd: __dirname,
    env: { ...process.env }
  });

  let stdout = '';
  proc.stdout.on('data', (data) => {
    stdout += data.toString();
    broadcast({ type: 'pipeline-log', stage: 'storyboard', message: data.toString() });
  });
  proc.stderr.on('data', (data) => {
    broadcast({ type: 'pipeline-log', stage: 'storyboard', message: data.toString() });
  });

  proc.on('close', (code) => {
    if (code === 0) {
      const projectFile = join(PROJECT_DIR, 'project.json');
      if (existsSync(projectFile)) {
        const project = JSON.parse(readFileSync(projectFile, 'utf-8'));
        project.stage = 'storyboarded';
        writeFileSync(projectFile, JSON.stringify(project, null, 2));
        broadcast({ type: 'project-updated', data: project });
      }
      broadcast({ type: 'pipeline-status', stage: 'storyboard', status: 'done', message: 'Storyboard complete!' });
      broadcast({ type: 'scenes-updated' });
    } else {
      broadcast({ type: 'pipeline-status', stage: 'storyboard', status: 'error', message: `Storyboard failed (exit ${code})` });
    }
  });

  res.json({ ok: true, message: 'Storyboard generation started' });
});

// Run prompt generation (Claude)
app.post('/api/pipeline/gen-prompts', async (req, res) => {
  broadcast({ type: 'pipeline-status', stage: 'prompts', status: 'running', message: 'Generating art prompts with Claude...' });

  const proc = spawn('node', [join(__dirname, 'pipeline', 'gen-prompts.js')], {
    cwd: __dirname,
    env: { ...process.env }
  });

  proc.stdout.on('data', (data) => {
    broadcast({ type: 'pipeline-log', stage: 'prompts', message: data.toString() });
  });
  proc.stderr.on('data', (data) => {
    broadcast({ type: 'pipeline-log', stage: 'prompts', message: data.toString() });
  });

  proc.on('close', (code) => {
    if (code === 0) {
      const projectFile = join(PROJECT_DIR, 'project.json');
      if (existsSync(projectFile)) {
        const project = JSON.parse(readFileSync(projectFile, 'utf-8'));
        project.stage = 'prompted';
        writeFileSync(projectFile, JSON.stringify(project, null, 2));
        broadcast({ type: 'project-updated', data: project });
      }
      broadcast({ type: 'pipeline-status', stage: 'prompts', status: 'done', message: 'Prompts generated!' });
      broadcast({ type: 'scenes-updated' });
    } else {
      broadcast({ type: 'pipeline-status', stage: 'prompts', status: 'error', message: `Prompt generation failed (exit ${code})` });
    }
  });

  res.json({ ok: true, message: 'Prompt generation started' });
});

// Run stitching (ffmpeg)
app.post('/api/pipeline/stitch', async (req, res) => {
  broadcast({ type: 'pipeline-status', stage: 'stitch', status: 'running', message: 'Stitching video with ffmpeg...' });

  const proc = spawn('node', [join(__dirname, 'pipeline', 'stitch.js')], {
    cwd: __dirname,
    env: { ...process.env }
  });

  proc.stdout.on('data', (data) => {
    broadcast({ type: 'pipeline-log', stage: 'stitch', message: data.toString() });
  });
  proc.stderr.on('data', (data) => {
    broadcast({ type: 'pipeline-log', stage: 'stitch', message: data.toString() });
  });

  proc.on('close', (code) => {
    if (code === 0) {
      const projectFile = join(PROJECT_DIR, 'project.json');
      if (existsSync(projectFile)) {
        const project = JSON.parse(readFileSync(projectFile, 'utf-8'));
        project.stage = 'done';
        writeFileSync(projectFile, JSON.stringify(project, null, 2));
        broadcast({ type: 'project-updated', data: project });
      }
      broadcast({ type: 'pipeline-status', stage: 'stitch', status: 'done', message: 'Video complete!' });
    } else {
      broadcast({ type: 'pipeline-status', stage: 'stitch', status: 'error', message: `Stitching failed (exit ${code})` });
    }
  });

  res.json({ ok: true, message: 'Stitching started' });
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
