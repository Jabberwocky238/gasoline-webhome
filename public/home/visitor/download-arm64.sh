#!/usr/bin/env bash
# download-arm64.sh — save the Linux arm64 gasoline binary.
# Uses scp, which delegates extPlatform files to the browser's native
# downloader so the real bytes stream from GitHub Releases.
#
# run:   ./download-arm64.sh

echo "fetching gasoline-linux-arm64..."
scp visitor@gasoline.network:/home/visitor/gasoline-linux-arm64 ./gasoline-linux-arm64
echo "done — check your Downloads folder."
echo "next steps on a Linux box:"
echo "  chmod +x gasoline-linux-arm64"
echo "  ./gasoline-linux-arm64 operator --config /etc/gasoline/config.yaml"
