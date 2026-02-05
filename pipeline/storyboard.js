#!/usr/bin/env node
/**
 * Generate a storyboard arc using Claude.
 * Takes lyrics, timeline, style, and annotations to produce scene descriptions.
 *
 * Usage: node pipeline/storyboard.js
 */
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { execSync } from 'child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_DIR = join(__dirname, '..', 'project');

function loadJson(name, fallback) {
  const f = join(PROJECT_DIR, name);
  return existsSync(f) ? JSON.parse(readFileSync(f, 'utf-8')) : fallback;
}

const project = loadJson('project.json', {});
const timeline = loadJson('timeline.json', []);
const annotations = loadJson('annotations.json', []);
const existingScenes = loadJson('scenes.json', []);

const duration = project.duration || (timeline.length ? timeline[timeline.length - 1].end : 180);

// Check for style anchor
const styleAnchorPrompt = project.stylePrompt || '';
const hasStyleAnchor = !!styleAnchorPrompt || !!project.styleAnchorImage;

const prompt = `You are creating a music video storyboard for:
Title: ${project.title || 'Untitled'}
Artist: ${project.artist || 'Unknown'}
Style/Genre: ${project.style || 'cinematic'}
Duration: ${duration} seconds

${styleAnchorPrompt ? `VISUAL STYLE ANCHOR (use this as the consistent visual reference for all scenes):
${styleAnchorPrompt}
` : ''}
LYRICS:
${project.lyrics || '(instrumental)'}

WORD TIMELINE (first/last few entries for context):
${JSON.stringify(timeline.slice(0, 10), null, 2)}
...
${JSON.stringify(timeline.slice(-10), null, 2)}

USER ANNOTATIONS:
${annotations.length ? JSON.stringify(annotations, null, 2) : '(none)'}

${existingScenes.length ? `EXISTING SCENES (user may have already edited some):
${JSON.stringify(existingScenes.slice(0, 5), null, 2)}` : ''}

Create a complete storyboard as a JSON array of scene objects. Each scene should have:
- "label": short name (max 30 chars)
- "description": visual description of what happens
- "start": start time in seconds
- "end": end time in seconds
- "status": "pending"
- "prompt": "" (will be filled later)
- "annotation": "" (empty unless carrying forward user annotations)
- "transition": "cut" or "fade"

Guidelines:
- Create 10-30 scenes depending on song length
- Follow a narrative arc: establish → build → climax → resolve
- Match scene changes to musical structure (verses, choruses, bridges)
- Each scene should be 4-12 seconds
- Describe visuals that match the mood and lyrics
- Consider the style/genre for visual aesthetics
- Use "fade" transitions between major sections, "cut" within sections

Output ONLY valid JSON array, no explanation.`;

console.log('Generating storyboard with Claude...');

try {
  const result = execSync(
    `echo ${JSON.stringify(prompt)} | claude --print`,
    { encoding: 'utf-8', maxBuffer: 10 * 1024 * 1024, timeout: 120000 }
  );

  const jsonMatch = result.match(/\[[\s\S]*\]/);
  if (!jsonMatch) {
    console.error('Could not parse Claude response as JSON array');
    console.log('Response:', result.slice(0, 500));
    process.exit(1);
  }

  const scenes = JSON.parse(jsonMatch[0]);
  writeFileSync(join(PROJECT_DIR, 'scenes.json'), JSON.stringify(scenes, null, 2));
  console.log(`Generated ${scenes.length} scenes. Reload web UI to review.`);
} catch (e) {
  console.error('Error:', e.message);
  process.exit(1);
}
