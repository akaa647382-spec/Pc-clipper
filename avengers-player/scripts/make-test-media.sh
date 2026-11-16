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
# Two tiny clips with the real lengths of the film, to test recognising the cut and the real
# snap point three hours in: the 2019 original (3:01:11) and the 2026 Encore re-release (about 3:05).
long_clip() {   # name seconds
  if [[ ! -f "$out/$1" ]]; then
    ff -f lavfi -i "testsrc2=size=160x90:rate=6,format=yuv420p" -f lavfi -i "sine=frequency=220:sample_rate=22050" \
       -t "$2" -c:v libx264 -preset ultrafast -crf 38 -g 12 -c:a aac -b:a 24k -movflags +faststart "$out/$1"
  fi
}
long_clip original-length.mp4 10871
long_clip encore-length.mp4 11110
# Movies with sound in several languages. English must play, whatever the file flags as its main
# track. The tracks differ in bitrate so a test can tell which one is being decoded.
LV=(-f lavfi -i "testsrc2=size=640x360:rate=24,format=yuv420p")
HIN=(-f lavfi -i "sine=frequency=440:sample_rate=48000")
ENG=(-f lavfi -i "sine=frequency=880:sample_rate=48000")
LX=(-c:v libx264 -preset ultrafast -crf 32 -g 48)
# Hindi first and flagged as the main track, English second; the player can decode both.
if [[ ! -f "$out/lang-dual.mkv" ]]; then
  ff "${LV[@]}" "${HIN[@]}" "${ENG[@]}" -t 150 -map 0:v -map 1:a -map 2:a "${LX[@]}" \
     -c:a:0 aac -ac:a:0 2 -b:a:0 192k -c:a:1 aac -ac:a:1 1 -b:a:1 48k \
     -metadata:s:a:0 language=hin -metadata:s:a:0 title="Hindi 2.0" -metadata:s:a:1 language=eng -metadata:s:a:1 title="English" \
     -disposition:a:0 default -disposition:a:1 0 "$out/lang-dual.mkv"
fi
# The shape of a real file that went wrong: Dolby Digital Plus Hindi 5.1 flagged as the main track,
# Dolby Digital English after it, English subtitles. The player can decode neither sound track.
if [[ ! -f "$out/lang-dolby.mkv" ]]; then
  printf '1\n00:00:01,000 --> 00:00:04,000\nI am Iron Man.\n\n2\n00:00:05,000 --> 00:02:20,000\nEmbedded English subtitles\n' > "$out/lang-dolby.tmp.srt"
  ff "${LV[@]}" "${HIN[@]}" "${ENG[@]}" -i "$out/lang-dolby.tmp.srt" -t 150 -map 0:v -map 1:a -map 2:a -map 3:s "${LX[@]}" \
     -c:a:0 eac3 -ac:a:0 6 -b:a:0 640k -c:a:1 ac3 -ac:a:1 2 -b:a:1 192k -c:s srt \
     -metadata:s:a:0 language=hin -metadata:s:a:0 title="Org Hindi DDP 5.1" -metadata:s:a:1 language=eng -metadata:s:a:1 title="English DD 2.0" \
     -metadata:s:s:0 language=eng -disposition:a:0 default -disposition:a:1 0 "$out/lang-dolby.mkv"
  rm -f "$out/lang-dolby.tmp.srt"
fi
# A dub the player can decode (flagged as main) and the English original in Dolby Digital.
if [[ ! -f "$out/lang-mixed.mkv" ]]; then
  ff "${LV[@]}" "${HIN[@]}" "${ENG[@]}" -t 40 -map 0:v -map 1:a -map 2:a "${LX[@]}" \
     -c:a:0 aac -ac:a:0 2 -b:a:0 192k -c:a:1 ac3 -ac:a:1 2 -b:a:1 192k \
     -metadata:s:a:0 language=hin -metadata:s:a:1 language=eng -disposition:a:0 default -disposition:a:1 0 "$out/lang-mixed.mkv"
fi
# Hindi only: what an earlier "Fix the sound" produced from such a file.
if [[ ! -f "$out/lang-hindi.mp4" ]]; then
  ff "${LV[@]}" "${HIN[@]}" -t 40 -map 0:v -map 1:a "${LX[@]}" -c:a aac -ac 2 -b:a 192k -metadata:s:a:0 language=hin "$out/lang-hindi.mp4"
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
