# MusicVid - Auto Music Video Generator

## Architecture

```
┌─────────────────────────────────────────────────────┐
│                   Web UI (browser)                   │
│  ┌───────────────────────────────────────────────┐  │
│  │  Scrollable Timeline Editor                    │  │
│  │  |--intro raga--|--verse 1--|--chorus--|--...  │  │
│  │  Click to select, annotate, approve segments   │  │
│  └───────────────────────────────────────────────┘  │
│            ▲ WebSocket ▼                             │
├─────────────────────────────────────────────────────┤
│                 Node.js Server                       │
│  ┌─────────┐ ┌──────────┐ ┌────────────────────┐   │
│  │ Express  │ │ WS Hub   │ │ Pipeline Engine    │   │
│  │ (static) │ │ (events) │ │ (stage runner)     │   │
│  └─────────┘ └──────────┘ └────────────────────┘   │
│                      │                               │
│  ┌─────────────────────────────────────────────┐    │
│  │              Pipeline Stages                 │    │
│  │  1. song-loader     (Suno fetch/import)      │    │
│  │  2. transcriber     (Whisper word timing)    │    │
│  │  3. style-ref       (Claude → Flux prompt)   │    │
│  │  4. storyboard      (Claude arc generation)  │    │
│  │  5. scene-slicer    (≤6s segments)           │    │
│  │  6. keyframe-gen    (Flux prompts → images)  │    │
│  │  7. video-gen       (Grok Imagine dispatch)  │    │
│  │  8. stitcher        (ffmpeg assembly)        │    │
│  └─────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────┘
```

## Pipeline Stages Detail

### Stage 1: Song Loader
- Input: Suno song URL or local audio file + lyrics text
- Output: `project.json` with song metadata, audio path, raw lyrics
- For MVP: manual paste of lyrics + drag-drop audio file
- Future: Suno API integration if available

### Stage 2: Transcriber (Word-Level Timing)
- Tool: OpenAI Whisper (`whisper` CLI or `openai-whisper` Python package)
- Input: audio file
- Output: word-level timestamps JSON
- Then Claude reconciles Whisper output against known lyrics (fixes misheard words, aligns timing)
- Output: `timeline.json` — array of `{ word, start, end }` entries

### Stage 3: Style Reference
- Claude Opus generates Flux 2 Pro prompts from song title + style + lyrics mood
- User sends prompts to Parascene (parascene.crosshj.com) manually or via automation
- Images collected in `project/style-refs/`
- User picks one as the canonical style reference
- Accept/refine loop via WebSocket UI

### Stage 4: Storyboard
- Input: timeline, lyrics, annotations, style reference image description
- Claude generates a narrative arc: intro → build → climax → resolution
- Maps visual scenes to timeline sections
- User reviews/edits in timeline UI
- Output: `storyboard.json` with scene descriptions mapped to time ranges

### Stage 5: Scene Slicer
- Chops storyboard into segments of ≤6 seconds (Grok Imagine max)
- Tries to align cuts with musical beats/phrases
- Each segment gets: time range, scene description, transition type (hard cut / fade)
- Output: `scenes.json`

### Stage 6: Keyframe Prompt Generation
- Claude generates Flux 2 Pro art prompts for each scene
- Prompts maintain consistency with style reference and each other
- Include style anchors: color palette, art style, character descriptions
- User reviews each prompt in timeline UI
- Output: `keyframe-prompts.json`

### Stage 7: Image Generation
- Prompts sent to Parascene for Flux 2 Pro generation
- Images stored in `project/keyframes/`
- User reviews each keyframe, accepts or requests regeneration
- When all approved → ready for video generation

### Stage 8: Video Generation (Grok Imagine)
- Each keyframe + scene description → 6s video clip
- Manual step: user uploads to Grok Imagine
- Generated videos copied back to `project/clips/`
- Future: automate via API if available

### Stage 9: Stitching
- ffmpeg assembles clips in sequence
- Transitions: hard cut (default) or crossfade
- Crossfade duration based on excess clip length beyond segment time
- Audio track overlaid from original song
- Output: final `.mp4` music video

## Project State

All project state lives in a single `project/` directory:

```
project/
  project.json          # song metadata, stage progress
  audio.mp3             # source audio
  lyrics.txt            # raw lyrics
  timeline.json         # word-level timestamps
  annotations.json      # user annotations on timeline
  storyboard.json       # scene descriptions + time ranges
  scenes.json           # ≤6s segments with transitions
  style-refs/           # candidate style reference images
  keyframes/            # approved keyframe images
  keyframe-prompts.json # Flux prompts per scene
  clips/                # generated video clips
  output/               # final stitched video
```

## UI Design

Barebones single-page app. One long horizontal scrollable timeline.

```
┌──────────────────────────────────────────────────────────┐
│ ◀ ════════════════════════════════════════════════════ ▶  │
│ |--sitar raga intro--|--birds fly--|--verse 1 walk--|    │
│ |  0:00 - 0:08       | 0:08-0:14  | 0:14-0:26      |   │
│                                                          │
│  [+ Add Annotation]   [Generate Storyboard]              │
│                                                          │
│ ┌─ Selected Segment ───────────────────────────────────┐ │
│ │ Scene: "birds fly"  (0:08 - 0:14)                    │ │
│ │ Description: Flock of birds against sunset...        │ │
│ │ Prompt: "cinematic wide shot, flock of..."           │ │
│ │ [Approve] [Regenerate] [Edit]                        │ │
│ │ ┌────────┐                                           │ │
│ │ │ keyframe│                                          │ │
│ │ │ preview │                                          │ │
│ │ └────────┘                                           │ │
│ └──────────────────────────────────────────────────────┘ │
└──────────────────────────────────────────────────────────┘
```

Each segment div is a clickable/draggable block. Width proportional to duration.
Color-coded by stage completion status.

## Tech Stack

- **Server**: Node.js, Express, ws (WebSocket)
- **UI**: Vanilla HTML/CSS/JS (no framework — keep it barebones)
- **AI**: Claude API (via `claude` CLI or Anthropic SDK)
- **Transcription**: OpenAI Whisper (Python, word-level timestamps)
- **Image Gen**: Flux 2 Pro via Parascene
- **Video Gen**: Grok Imagine (manual for now)
- **Stitching**: ffmpeg
- **State**: JSON files on disk

## MVP Scope (Phase 1)

1. Manual song import (paste lyrics + drop audio file)
2. Whisper transcription + Claude timing cleanup
3. Timeline editor UI with annotation support
4. Claude storyboard generation
5. Scene slicing to ≤6s segments
6. Keyframe prompt generation
7. Manual image collection workflow
8. ffmpeg stitching with hardcut/crossfade
