#!/usr/bin/env bash
# download-amd64.sh — save the Linux amd64 gasoline binary to your Downloads
# folder. Uses scp, which for extPlatform files hands off to the browser's
# native downloader so you get the real 28 MB binary from GitHub Releases,
# not the in-memory stub.
#
# run:   ./download-amd64.sh

echo "fetching gasoline-linux-amd64..."
scp visitor@gasoline.network:/home/visitor/gasoline-linux-amd64 ./gasoline-linux-amd64
echo "done — check your Downloads folder."
echo "next steps on a Linux box:"
echo "  chmod +x gasoline-linux-amd64"
echo "  ./gasoline-linux-amd64 operator --config /etc/gasoline/config.yaml"
