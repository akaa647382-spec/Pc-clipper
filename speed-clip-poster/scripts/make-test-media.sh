#!/usr/bin/env bash
# Makes the clips the tests use, in tests/fixtures/media (not committed).
set -euo pipefail
D="$(dirname "$0")/../tests/fixtures/media"
mkdir -p "$D"
q=(-hide_banner -loglevel error -y)
# A normal clip: moving picture, sound, 20 s, 720p.
ffmpeg "${q[@]}" -f lavfi -i "testsrc2=s=1280x720:r=30:d=20" -f lavfi -i "sine=f=440:d=20,volume=0.3" -c:v libx264 -preset veryfast -crf 32 -c:a aac -shortest "$D/good.mp4"
# The same clip re-encoded smaller: must count as a repeat.
ffmpeg "${q[@]}" -i "$D/good.mp4" -vf scale=640:360 -c:v libx264 -preset ultrafast -crf 30 -c:a aac "$D/good-reencoded.mp4"
# A different clip.
ffmpeg "${q[@]}" -f lavfi -i "mandelbrot=s=1280x720:r=30,trim=duration=15" -f lavfi -i "sine=f=660:d=15,volume=0.3" -c:v libx264 -preset veryfast -crf 34 -c:a aac -shortest "$D/other.mp4"
# Self-promo text on screen.
ffmpeg "${q[@]}" -f lavfi -i "testsrc2=s=1280x720:r=30:d=12" -f lavfi -i "sine=f=300:d=12,volume=0.3" -vf "drawbox=x=0:y=280:w=1280:h=140:color=black:t=fill,drawtext=text='FOLLOW ME @clipzking ON TIKTOK':fontcolor=white:fontsize=56:x=60:y=320" -c:v libx264 -preset veryfast -crf 32 -c:a aac -shortest "$D/promo.mp4"
# Black and silent.
ffmpeg "${q[@]}" -f lavfi -i "color=c=black:s=1280x720:r=30:d=20" -f lavfi -i "anullsrc=r=48000:cl=stereo" -c:v libx264 -preset ultrafast -c:a aac -t 20 "$D/dead.mp4"
# Too big for 10 MB: noisy 1080p at a high bit rate, 30 s.
ffmpeg "${q[@]}" -f lavfi -i "life=s=480x270:mold=10:r=30:ratio=0.1:death_color=#C83232:life_color=#00ff00,scale=1920:1080:flags=neighbor,noise=alls=30:allf=t,trim=duration=30" -f lavfi -i "sine=f=500:d=30,volume=0.3" -c:v libx264 -preset ultrafast -b:v 8M -c:a aac -shortest "$D/big.mp4"
# An MKV.
ffmpeg "${q[@]}" -i "$D/other.mp4" -c copy "$D/other.mkv"
ls -la "$D"
