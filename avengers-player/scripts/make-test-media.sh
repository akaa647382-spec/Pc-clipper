#!/usr/bin/env bash
# Generates the small clips the automated tests play (git-ignored, re-created on demand).
set -euo pipefail
out="$(cd "$(dirname "$0")/.." && pwd)/tests/media"
mkdir -p "$out"
ff() { ffmpeg -hide_banner -loglevel error -y "$@"; }

# Main clip: a burned-in running clock so screenshots show the film position, plus a tone.
if [[ ! -f "$out/movie.mp4" ]]; then
  ff -f lavfi -i "testsrc2=size=1280x720:rate=24,format=yuv420p" -f lavfi -i "sine=frequency=330:sample_rate=48000" \
     -t 200 -c:v libx264 -preset ultrafast -crf 30 -g 48 -c:a aac -b:a 96k -movflags +faststart "$out/movie.mp4"
fi
# Sound the player cannot decode (Dolby Digital): must be detected.
if [[ ! -f "$out/dolby.mp4" ]]; then
  ff -f lavfi -i "testsrc2=size=640x360:rate=24,format=yuv420p" -f lavfi -i "sine=frequency=440:sample_rate=48000" \
     -t 30 -c:v libx264 -preset ultrafast -crf 32 -g 48 -c:a ac3 -b:a 192k "$out/dolby.mp4"
fi
# No sound track at all.
if [[ ! -f "$out/silent.mp4" ]]; then
  ff -f lavfi -i "testsrc2=size=640x360:rate=24,format=yuv420p" -t 30 -c:v libx264 -preset ultrafast -crf 32 -g 48 -an "$out/silent.mp4"
fi
# A subtitle file with the movie's name (picked up automatically) and one in a legacy encoding.
if [[ ! -f "$out/movie.srt" ]]; then
  : > "$out/movie.srt"
  for i in $(seq 0 39); do
    s=$((i * 5)); e=$((s + 4))
    printf '%d\n%02d:%02d:%02d,000 --> %02d:%02d:%02d,000\nLine %d at %d seconds\n\n' \
      $((i + 1)) $((s / 3600)) $((s % 3600 / 60)) $((s % 60)) $((e / 3600)) $((e % 3600 / 60)) $((e % 60)) $((i + 1)) "$s" >> "$out/movie.srt"
  done
fi
if [[ ! -f "$out/other.vtt" ]]; then
  printf 'WEBVTT\n\n00:00:00.000 --> 00:03:00.000\n<i>Other</i> subtitle track\n' > "$out/other.vtt"
fi
ls -la "$out"
