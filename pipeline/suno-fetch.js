#!/usr/bin/env node
/**
 * Fetch songs from your Suno account.
 * Based on gcui-art/suno-api reverse engineering.
 *
 * Setup:
 * 1. Log into suno.com in your browser
 * 2. Open DevTools → Network tab → filter by "clerk" or "client"
 * 3. Find a request to clerk.suno.com and copy the Cookie header
 * 4. Set SUNO_COOKIE env var or create .suno-cookie file
 *
 * Usage:
 *   node pipeline/suno-fetch.js list              # list your songs
 *   node pipeline/suno-fetch.js download <id>     # download a song
 *   node pipeline/suno-fetch.js info <id>         # get song details (lyrics, style, etc)
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_DIR = join(__dirname, '..', 'project');

// Get cookie from env or file
function getCookie() {
  if (process.env.SUNO_COOKIE) return process.env.SUNO_COOKIE;
  const cookieFile = join(__dirname, '..', '.suno-cookie');
  if (existsSync(cookieFile)) return readFileSync(cookieFile, 'utf-8').trim();
  console.error(`No Suno cookie found.

To set up:
1. Log into suno.com
2. DevTools → Network tab → look for requests to clerk.suno.com or studio-api
3. Copy the full Cookie header from any authenticated request
4. Either:
   - export SUNO_COOKIE="your_cookie_here"
   - Or save to: ${cookieFile}
`);
  process.exit(1);
}

const API_BASE = 'https://studio-api.prod.suno.com';

// Extract __session JWT from cookie string
function getSessionToken() {
  const cookie = getCookie();
  // The __session cookie is already a JWT we can use as Bearer token
  const match = cookie.match(/__session=([^;]+)/);
  if (match) {
    return match[1];
  }
  // If just the token was provided directly
  if (cookie.startsWith('eyJ')) {
    return cookie;
  }
  console.error('Could not find __session token in cookie');
  process.exit(1);
}

async function sunoFetch(path) {
  const token = getSessionToken();
  const res = await fetch(`${API_BASE}${path}`, {
    headers: {
      'Authorization': `Bearer ${token}`,
      'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
      'Accept': 'application/json',
    }
  });
  if (!res.ok) {
    console.error(`API error: ${res.status} ${res.statusText}`);
    const text = await res.text();
    console.error('Response:', text.slice(0, 300));
    if (res.status === 401) console.error('Session expired. Re-copy cookie from browser.');
    process.exit(1);
  }
  return res.json();
}

async function listSongs(page = 0) {
  // Suno's feed endpoint returns your created songs
  const data = await sunoFetch(`/api/feed/v2?page=${page}`);
  const songs = data.clips || data.songs || data;

  console.log(`\nYour Suno songs (page ${page + 1}):\n`);
  console.log('ID                                    | Title                          | Duration');
  console.log('-'.repeat(90));

  for (const song of songs) {
    const title = (song.title || 'Untitled').slice(0, 30).padEnd(30);
    const dur = song.duration ? `${Math.round(song.duration)}s` : '?';
    console.log(`${song.id} | ${title} | ${dur}`);
  }

  console.log(`\nTo download: node pipeline/suno-fetch.js download <id>`);
  console.log(`To see details: node pipeline/suno-fetch.js info <id>`);
}

async function getSongInfo(id) {
  const data = await sunoFetch(`/api/clip/${id}`);

  console.log('\n=== Song Info ===');
  console.log(`ID: ${data.id}`);
  console.log(`Title: ${data.title}`);
  console.log(`Duration: ${data.duration}s`);
  console.log(`Style: ${data.metadata?.tags || data.metadata?.prompt || 'unknown'}`);
  console.log(`\nLyrics:\n${data.metadata?.prompt || data.lyric || '(no lyrics)'}`);
  console.log(`\nAudio URL: ${data.audio_url}`);
  console.log(`Image URL: ${data.image_url}`);

  return data;
}

async function downloadSong(id) {
  const data = await sunoFetch(`/api/clip/${id}`);

  if (!data.audio_url) {
    console.error('No audio URL found for this song');
    process.exit(1);
  }

  console.log(`Downloading: ${data.title || id}`);

  // Download audio
  const audioRes = await fetch(data.audio_url);
  const audioBuffer = Buffer.from(await audioRes.arrayBuffer());
  const audioPath = join(PROJECT_DIR, 'audio.mp3');
  writeFileSync(audioPath, audioBuffer);
  console.log(`Audio saved: ${audioPath}`);

  // Download cover image if exists
  if (data.image_url) {
    const imgRes = await fetch(data.image_url);
    const imgBuffer = Buffer.from(await imgRes.arrayBuffer());
    mkdirSync(join(PROJECT_DIR, 'style-refs'), { recursive: true });
    const imgPath = join(PROJECT_DIR, 'style-refs', 'suno-cover.jpg');
    writeFileSync(imgPath, imgBuffer);
    console.log(`Cover image saved: ${imgPath}`);
  }

  // Update project.json with song metadata
  const projectPath = join(PROJECT_DIR, 'project.json');
  const project = existsSync(projectPath)
    ? JSON.parse(readFileSync(projectPath, 'utf-8'))
    : {};

  project.title = data.title || project.title;
  project.artist = 'Suno AI';
  project.style = data.metadata?.tags || data.metadata?.prompt?.split('\n')[0] || project.style;
  project.lyrics = data.metadata?.prompt || data.lyric || project.lyrics;
  project.duration = Math.round(data.duration) || project.duration;
  project.audioFile = 'audio.mp3';
  project.sunoId = id;
  project.stage = 'setup';

  writeFileSync(projectPath, JSON.stringify(project, null, 2));
  console.log(`Project updated with song metadata`);
  console.log(`\nReload http://localhost:3000 to continue`);
}

// CLI
const [,, cmd, arg] = process.argv;

switch (cmd) {
  case 'list':
    listSongs(parseInt(arg) || 0);
    break;
  case 'info':
    if (!arg) { console.error('Usage: suno-fetch.js info <song-id>'); process.exit(1); }
    getSongInfo(arg);
    break;
  case 'download':
    if (!arg) { console.error('Usage: suno-fetch.js download <song-id>'); process.exit(1); }
    downloadSong(arg);
    break;
  default:
    console.log(`Usage:
  node pipeline/suno-fetch.js list [page]      List your songs
  node pipeline/suno-fetch.js info <id>        Show song details
  node pipeline/suno-fetch.js download <id>    Download song + set up project
`);
}
