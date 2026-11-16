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
# What the snap looks like to the app: the picture bursts into white. flash_expr <second> gives a
# blend expression that leaves the frame at <second> untouched, brightens the following frames,
# is white all over from <second>+0.167 for about a second and has faded 1.7 s after <second>.
flash_expr() { echo "A+(B-A)*clip((T-$1)/0.1666,0,1)*clip(($1+1.7-T)/0.7,0,1)"; }

# A short clip with such a flash beginning right after 1:41.5 (the frame at 1:41.542 is the first
# brighter one, 1:41.667 the first white one), and the same thing as a wide picture with black bars.
if [[ ! -f "$out/snap-scene.mp4" ]]; then
  ff -f lavfi -i "testsrc2=size=640x360:rate=24,format=yuv420p" -f lavfi -i "color=white:size=640x360:rate=24,format=yuv420p" \
     -f lavfi -i "sine=frequency=330:sample_rate=48000" \
     -filter_complex "[0:v][1:v]blend=all_expr='$(flash_expr 101.5)'[v]" -map "[v]" -map 2:a -t 160 \
     -c:v libx264 -preset ultrafast -crf 30 -g 48 -c:a aac -b:a 96k -movflags +faststart "$out/snap-scene.mp4"
fi
if [[ ! -f "$out/snap-wide.mp4" ]]; then
  ff -f lavfi -i "testsrc2=size=640x268:rate=24,format=yuv420p" -f lavfi -i "color=white:size=640x268:rate=24,format=yuv420p" \
     -f lavfi -i "sine=frequency=330:sample_rate=48000" \
     -filter_complex "[0:v][1:v]blend=all_expr='$(flash_expr 21.5)',pad=640:360:0:46:black[v]" -map "[v]" -map 2:a -t 40 \
     -c:v libx264 -preset ultrafast -crf 30 -g 48 -c:a aac -b:a 96k -movflags +faststart "$out/snap-wide.mp4"
fi

# The same scene with subtitles inside the file: the line before the snap ends at 1:40.6, just
# under a second before the flash begins.
if [[ ! -f "$out/snap-subs.mkv" ]]; then
  printf '1\n00:01:33,000 --> 00:01:35,000\nI am... inevitable.\n\n2\n00:01:36,500 --> 00:01:37,400\nAnd I...\n\n3\n00:01:37,600 --> 00:01:38,300\nam...\n\n4\n00:01:39,100 --> 00:01:40,600\n<i>Iron Man.</i>\n\n5\n00:02:20,000 --> 00:02:22,000\nMr. Stark?\n' > "$out/snap-subs.tmp.srt"
  ff -i "$out/snap-scene.mp4" -i "$out/snap-subs.tmp.srt" -map 0 -map 1 -c copy -c:s srt -metadata:s:s:0 language=eng "$out/snap-subs.mkv"
  rm -f "$out/snap-subs.tmp.srt"
fi

# Tiny clips with the real lengths of the film, to test recognising the cut and finding the snap
# three hours in: ENDGAME (3:01:11), ENCORE (3:01:36) and a longer copy (3:05:10). Each has the
# flash of a snap: a second and a half after 2:30:30 in the 3:01:11 and 3:05:10 clips, and 25 s
# later than that in the 3:01:36 clip (as if its extra 25 s came before the film).
long_clip() {   # name seconds second-of-the-flash
  if [[ ! -f "$out/$1" ]]; then
    ff -f lavfi -i "testsrc2=size=160x90:rate=6,format=yuv420p" -f lavfi -i "color=white:size=160x90:rate=6,format=yuv420p" \
       -f lavfi -i "sine=frequency=220:sample_rate=22050" \
       -filter_complex "[0:v][1:v]blend=all_expr='$(flash_expr "$3")'[v]" -map "[v]" -map 2:a \
       -t "$2" -c:v libx264 -preset ultrafast -crf 38 -g 12 -c:a aac -b:a 24k -movflags +faststart "$out/$1"
  fi
}
long_clip original-length.mp4 10871 9031.5
long_clip encore-length.mp4 11110 9031.5
long_clip encore-short.mp4 10896 9056.5
# The ENCORE clip with English subtitles inside: "Iron Man." goes off screen at 2:30:55.75, just under a
# second before the flash. (And a forced-only English track first, which must not be the one read.)
if [[ ! -f "$out/encore-subs.mkv" ]]; then
  printf '1\n02:30:20,000 --> 02:30:22,000\nI am... inevitable.\n\n2\n02:30:47,800 --> 02:30:49,300\nAnd I...\n\n3\n02:30:51,000 --> 02:30:52,100\nam...\n\n4\n02:30:54,250 --> 02:30:55,750\nIron Man.\n' > "$out/encore-subs.tmp.srt"
  printf '1\n02:10:00,000 --> 02:10:02,000\n[SIGN: NEW YORK]\n' > "$out/encore-forced.tmp.srt"
  ff -i "$out/encore-short.mp4" -i "$out/encore-forced.tmp.srt" -i "$out/encore-subs.tmp.srt" -map 0 -map 1 -map 2 -c copy -c:s srt \
     -metadata:s:s:0 language=eng -disposition:s:0 forced -metadata:s:s:1 language=eng "$out/encore-subs.mkv"
  rm -f "$out/encore-subs.tmp.srt" "$out/encore-forced.tmp.srt"
fi
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
# "Talking" films for the subtitle sync: synthetic voices that speak exactly when the lines of
# talk.srt say so, over music and effects. talk.mp4 is stereo; talk-51.mkv has the voices only in
# the centre channel (drowned out in a mix-down) and the right subtitles inside the file;
# talk-long.mp4 is half an hour, long enough to be listened to in stretches. The other .srt files
# are the same lines made for other copies of the film: see scripts/make-talk.mjs.
if [[ ! -f "$out/talk.mp4" || ! -f "$out/talk-51.mkv" || ! -f "$out/talk-long.mp4" || ! -f "$out/talk-early.srt" ]]; then
  node "$(dirname "$0")/make-talk.mjs" "$out"
  ff -f lavfi -i "testsrc2=size=320x180:rate=24,format=yuv420p" -i "$out/talk.wav" -t 240 \
     -c:v libx264 -preset ultrafast -crf 34 -g 48 -c:a aac -b:a 96k -ar 48000 -movflags +faststart "$out/talk.mp4"
  ff -f lavfi -i "testsrc2=size=320x180:rate=24,format=yuv420p" -i "$out/talk51.wav" -i "$out/talk.srt" -t 240 -map 0:v -map 1:a -map 2:s \
     -c:v libx264 -preset ultrafast -crf 34 -g 48 -c:a aac -b:a 256k -ar 48000 -c:s srt \
     -metadata:s:a:0 language=eng -metadata:s:s:0 language=eng "$out/talk-51.mkv"
  ff -f lavfi -i "testsrc2=size=160x90:rate=6,format=yuv420p" -i "$out/talk-long.wav" -t 1800 \
     -c:v libx264 -preset ultrafast -crf 38 -g 12 -c:a aac -b:a 48k -movflags +faststart "$out/talk-long.mp4"
  rm -f "$out/talk.wav" "$out/talk51.wav" "$out/talk-long.wav"
fi
ls -la "$out"
