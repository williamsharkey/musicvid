#!/usr/bin/env node
/**
 * Generate a style reference prompt using Claude.
 * Takes song metadata and generates a Flux 2 Pro prompt
 * for creating the visual style reference image.
 *
 * Usage: node pipeline/style-ref.js
 *
 * The generated prompt should be used with Parascene (parascene.crosshj.com)
 * to create candidate style reference images.
 */
import { readFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { execSync } from 'child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_DIR = join(__dirname, '..', 'project');

const projectPath = join(PROJECT_DIR, 'project.json');
if (!existsSync(projectPath)) {
  console.error('No project.json. Set up the project in the web UI first.');
  process.exit(1);
}

const project = JSON.parse(readFileSync(projectPath, 'utf-8'));

const prompt = `Generate a single Flux 2 Pro image generation prompt that establishes the visual style for a music video.

Song: "${project.title || 'Untitled'}"
Artist: ${project.artist || 'Unknown'}
Style/Genre: ${project.style || 'cinematic'}
Lyrics excerpt:
${(project.lyrics || '').slice(0, 500)}

Create a prompt that captures:
- The overall mood and atmosphere of the song
- A specific art style (e.g., oil painting, digital art, watercolor, photorealistic)
- Color palette that matches the emotional tone
- Lighting style
- Level of detail and texture

The prompt should be 2-4 sentences. It will serve as the style anchor for all subsequent keyframe prompts.
Output ONLY the prompt text, nothing else.`;

console.log('Generating style reference prompt with Claude...\n');

try {
  const result = execSync(
    `echo ${JSON.stringify(prompt)} | claude --print`,
    { encoding: 'utf-8', maxBuffer: 10 * 1024 * 1024, timeout: 60000 }
  );

  console.log('=== STYLE REFERENCE PROMPT ===\n');
  console.log(result.trim());
  console.log('\n==============================');
  console.log('\nCopy this prompt to parascene.crosshj.com to generate style reference images.');
  console.log('Save your chosen reference image to: project/style-refs/');
} catch (e) {
  console.error('Error:', e.message);
  process.exit(1);
}
