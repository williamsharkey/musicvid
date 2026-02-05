# Initial Request - Auto Music Video Generator

## Original Request (verbatim)

Want to create an auto music video generator. Workflow:

1. List songs on my Suno account
2. Select a song
3. Pass lyrics and style and song title to Claude Opus on command line to generate a prompt for Flux 2 Pro or another image generator model
4. Generate variations using github.com/crosshj/parascene
5. After each generation I accept it or refine my request to Claude to generate different prompts
6. When satisfied, that image becomes consistent style reference for keyframes
7. Find a tool to take audio from the Suno song and transcribe the exact position in time of every word
8. Then Claude cleans the timing chart up with knowledge of the input lyrics
9. Human can annotate, highlight parts of song to add notes (e.g., "if the intro sounds like a sitar raga, I would add that because it wouldn't be in the lyrics")
10. Then the timeline and lyrics and style reference image is fed into Claude and Claude generates a music video storyboard arc
11. User can accept or provide feedback
12. Once accepted, Claude chops up the length of the timeline into sections of 6 seconds or less (max time that Grok Imagine can generate)
13. User can approve or suggest updates to each scene
14. Those scene descriptions are turned into Flux 2 Pro art prompts, careful to be consistent with the reference art and other art prompts
15. The prompts are fed into parascene.crosshj.com and the images collected
16. User reviews and accepts each keyframe or provides an update
17. When all keyframes are generated, the user saves them and processes them into 6 second Grok Imagine videos
18. Those videos are then copied back to this computer, where this system stitches them together with hardcuts or fades depending on how much excess time is provided with the cuts
19. The final sequence is stitched together with ffmpeg or something to produce a perfectly synced music video

## Editing UI

Barebones. A web server with a websocket connection. A single long scrollable line of text for selecting parts:

```
|----bird flyover----|---people dance--|
```

With divs for each part. Units can be seconds or sliced up by quarter notes if you know the tempo.

## Key External Services/Tools

- **Suno** - Song source (audio + lyrics)
- **Claude Opus** - Prompt generation, storyboard, timing cleanup
- **Flux 2 Pro** - Image generation (via Parascene)
- **Parascene** (parascene.crosshj.com / github.com/crosshj/parascene) - Image generation interface
- **Grok Imagine** - 6-second video generation from keyframes
- **ffmpeg** - Final video stitching
- **Whisper or similar** - Word-level audio transcription/timing
