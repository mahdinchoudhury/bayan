#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")/.."
output="${1:-dist}"
mkdir -p "$output/Bayan.app/Contents/MacOS" "$output/Bayan.app/Contents/Resources" work/swift-cache
swiftc -module-cache-path work/swift-cache -O -framework AppKit -framework WebKit apps/bayan-macos/main.swift -o "$output/Bayan.app/Contents/MacOS/Bayan"
cp -R apps/bayan-macos/Web "$output/Bayan.app/Contents/Resources/"
cat > "$output/Bayan.app/Contents/Info.plist" <<'PLIST'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>CFBundleExecutable</key><string>Bayan</string>
<key>CFBundleIdentifier</key><string>app.bayan.reader.preview</string>
<key>CFBundleName</key><string>Bayan</string>
<key>CFBundleDisplayName</key><string>Bayan</string>
<key>CFBundleShortVersionString</key><string>0.1.0</string>
<key>CFBundleVersion</key><string>1</string>
<key>LSMinimumSystemVersion</key><string>13.0</string>
<key>NSHighResolutionCapable</key><true/>
<key>NSAppTransportSecurity</key><dict><key>NSAllowsLocalNetworking</key><true/></dict>
</dict></plist>
PLIST
codesign --force --sign - "$output/Bayan.app"
echo "Built $output/Bayan.app"
