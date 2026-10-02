#!/bin/sh
set -eu
cd "$(dirname "$0")/.."
mkdir -p assets/icon.iconset
magick -background none assets/icon.svg assets/icon.iconset/master.png
for size in 16 32 128 256 512; do
  magick assets/icon.iconset/master.png -resize "${size}x${size}" "assets/icon.iconset/icon_${size}x${size}.png"
  double=$((size * 2))
  magick assets/icon.iconset/master.png -resize "${double}x${double}" "assets/icon.iconset/icon_${size}x${size}@2x.png"
done
rm assets/icon.iconset/master.png
iconutil -c icns assets/icon.iconset -o assets/icon.icns
rm -rf assets/icon.iconset
