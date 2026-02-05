#!/usr/bin/env node
/**
 * Clean up Whisper timeline using Claude.
 * Reconciles transcribed words against known lyrics,
 * fixes misheard words, and aligns timing.
 *
 * Usage: node pipeline/clean-timeline.js
 *
 * Requires: claude CLI (claude code) or ANTHROPIC_API_KEY in env
 */
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { execSync } from 'child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_DIR = join(__dirname, '..', 'project');

const timelinePath = join(PROJECT_DIR, 'timeline.json');
const projectPath = join(PROJECT_DIR, 'project.json');

if (!existsSync(timelinePath)) {
  console.error('No timeline.json found. Run transcribe.py first.');
  process.exit(1);
}

const timeline = JSON.parse(readFileSync(timelinePath, 'utf-8'));
const project = JSON.parse(readFileSync(projectPath, 'utf-8'));

if (!project.lyrics) {
  console.error('No lyrics in project.json. Add lyrics in the web UI first.');
  process.exit(1);
}

const prompt = `You are cleaning up a Whisper transcription by reconciling it against the known correct lyrics.

KNOWN LYRICS:
${project.lyrics}

WHISPER TRANSCRIPTION (with timestamps):
${JSON.stringify(timeline, null, 2)}

Your task:
1. Match each whisper word to the correct lyric word
2. Fix any misheard words (use the known lyrics as ground truth)
3. Keep the timestamps from Whisper (they are accurate even if words are wrong)
4. If Whisper missed words, interpolate reasonable timestamps
5. If Whisper added extra words not in lyrics, remove them
6. Mark instrumental/non-lyric sections with [instrumental] entries

Output ONLY valid JSON — an array of objects with { "word", "start", "end" } fields.
No explanation, no markdown code fences, just the JSON array.`;

console.log('Sending to Claude for cleanup...');
console.log(`Timeline has ${timeline.length} words, lyrics have ~${project.lyrics.split(/\s+/).length} words`);

try {
  // Use claude CLI in pipe mode
  const result = execSync(
    `echo ${JSON.stringify(prompt)} | claude --print`,
    { encoding: 'utf-8', maxBuffer: 10 * 1024 * 1024, timeout: 120000 }
  );

  // Try to parse the JSON from Claude's response
  const jsonMatch = result.match(/\[[\s\S]*\]/);
  if (!jsonMatch) {
    console.error('Could not find JSON array in Claude response.');
    console.log('Raw response:', result.slice(0, 500));
    process.exit(1);
  }

  const cleaned = JSON.parse(jsonMatch[0]);
  const backupPath = join(PROJECT_DIR, 'timeline-raw.json');
  writeFileSync(backupPath, readFileSync(timelinePath));
  writeFileSync(timelinePath, JSON.stringify(cleaned, null, 2));
  console.log(`Cleaned timeline: ${cleaned.length} words (raw backup: timeline-raw.json)`);
  console.log('Reload the web UI to see updated timeline.');
} catch (e) {
  console.error('Error running Claude:', e.message);
  console.log('\nAlternative: manually edit project/timeline.json');
  process.exit(1);
}
