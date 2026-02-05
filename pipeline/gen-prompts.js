#!/usr/bin/env node
/**
 * Generate Flux 2 Pro art prompts for each scene using Claude.
 * Ensures consistency with style reference and across all scenes.
 *
 * Usage: node pipeline/gen-prompts.js
 */
import { readFileSync, writeFileSync, existsSync, readdirSync } from 'fs';
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
const scenes = loadJson('scenes.json', []);

if (!scenes.length) {
  console.error('No scenes found. Run storyboard.js first.');
  process.exit(1);
}

// Check for style reference description
const styleRefDir = join(PROJECT_DIR, 'style-refs');
const styleRefs = existsSync(styleRefDir) ? readdirSync(styleRefDir) : [];

const prompt = `You are generating Flux 2 Pro image generation prompts for a music video.

SONG: "${project.title || 'Untitled'}" by ${project.artist || 'Unknown'}
STYLE: ${project.style || 'cinematic'}
${styleRefs.length ? `STYLE REFERENCE FILES: ${styleRefs.join(', ')}` : ''}

SCENES TO PROMPT:
${JSON.stringify(scenes.map((s, i) => ({
  idx: i,
  label: s.label,
  description: s.description,
  annotation: s.annotation,
  start: s.start,
  end: s.end
})), null, 2)}

For each scene, create a detailed Flux 2 Pro image prompt. Requirements:
- Maintain consistent visual style across ALL prompts
- Include style anchors in every prompt (color palette, art style, lighting)
- Be specific about composition, camera angle, lighting, colors
- Reference the same characters/elements consistently
- Prompts should be 1-3 sentences, vivid and specific
- Don't use negative prompts (Flux doesn't use them)

Output a JSON array where each element is:
{
  "sceneIdx": <number>,
  "prompt": "<the art prompt>"
}

Output ONLY valid JSON array.`;

console.log(`Generating prompts for ${scenes.length} scenes...`);

try {
  const result = execSync(
    `echo ${JSON.stringify(prompt)} | claude --print`,
    { encoding: 'utf-8', maxBuffer: 10 * 1024 * 1024, timeout: 180000 }
  );

  const jsonMatch = result.match(/\[[\s\S]*\]/);
  if (!jsonMatch) {
    console.error('Could not parse response');
    process.exit(1);
  }

  const prompts = JSON.parse(jsonMatch[0]);

  // Merge prompts into scenes
  for (const p of prompts) {
    if (scenes[p.sceneIdx]) {
      scenes[p.sceneIdx].prompt = p.prompt;
      scenes[p.sceneIdx].status = 'prompted';
    }
  }

  writeFileSync(join(PROJECT_DIR, 'scenes.json'), JSON.stringify(scenes, null, 2));
  writeFileSync(join(PROJECT_DIR, 'keyframe-prompts.json'), JSON.stringify(prompts, null, 2));
  console.log(`Generated ${prompts.length} prompts. Reload web UI to review.`);
} catch (e) {
  console.error('Error:', e.message);
  process.exit(1);
}
