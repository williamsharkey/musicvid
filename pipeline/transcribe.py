#!/usr/bin/env python3
"""
Transcribe audio to word-level timestamps using faster-whisper.
Outputs timeline.json into the project directory.

Usage:
  python3 pipeline/transcribe.py [audio_file]

If no audio file is given, reads from project/audio.mp3.

Requirements:
  pip install faster-whisper
"""
import json
import sys
import os

def main():
    project_dir = os.path.join(os.path.dirname(os.path.dirname(__file__)), 'project')
    audio_path = sys.argv[1] if len(sys.argv) > 1 else os.path.join(project_dir, 'audio.mp3')

    if not os.path.exists(audio_path):
        # Try .wav
        audio_path = os.path.join(project_dir, 'audio.wav')
    if not os.path.exists(audio_path):
        print(f"Error: no audio file found at {audio_path}")
        print("Upload audio via the web UI first.")
        sys.exit(1)

    print(f"Transcribing: {audio_path}")
    print("Loading Whisper model (this may take a moment on first run)...")
    sys.stdout.flush()

    try:
        from faster_whisper import WhisperModel
    except ImportError:
        print("faster-whisper not installed. Install with:")
        print("  pip install faster-whisper")
        sys.exit(1)

    # Use base model, CPU compute (use "cuda" if you have GPU)
    model = WhisperModel("base", device="cpu", compute_type="int8")

    print("Transcribing audio...")
    sys.stdout.flush()

    segments, info = model.transcribe(audio_path, word_timestamps=True)

    # Extract word-level timestamps
    timeline = []
    for segment in segments:
        if segment.words:
            for word_info in segment.words:
                timeline.append({
                    "word": word_info.word.strip(),
                    "start": round(word_info.start, 3),
                    "end": round(word_info.end, 3)
                })
        print(f"  Processed segment: {segment.start:.1f}s - {segment.end:.1f}s")
        sys.stdout.flush()

    out_path = os.path.join(project_dir, 'timeline.json')
    with open(out_path, 'w') as f:
        json.dump(timeline, f, indent=2)

    print(f"Wrote {len(timeline)} words to {out_path}")
    print(f"Detected language: {info.language} (probability: {info.language_probability:.2f})")
    print("Transcription complete!")

if __name__ == '__main__':
    main()
