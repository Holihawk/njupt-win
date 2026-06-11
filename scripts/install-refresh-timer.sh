#!/usr/bin/env bash
set -euo pipefail

repo_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
unit_dir="${XDG_CONFIG_HOME:-$HOME/.config}/systemd/user"
npm_path="$(readlink -f "$(command -v npm)")"
node_bin="$(dirname "$(readlink -f "$(command -v node)")")"

mkdir -p "$unit_dir" "$repo_dir/data"
sed "s|WorkingDirectory=%h/njupt-win|WorkingDirectory=$repo_dir|; s|%h/njupt-win/data/notice-refresh.lock|$repo_dir/data/notice-refresh.lock|; s| npm run refresh:notices| $npm_path run refresh:notices|" \
  "$repo_dir/deploy/systemd/njupt-notice-refresh.service" > "$unit_dir/njupt-notice-refresh.service"
printf '\nEnvironment=PATH=%s:/usr/local/bin:/usr/bin:/bin\n' "$node_bin" >> "$unit_dir/njupt-notice-refresh.service"
install -m 0644 "$repo_dir/deploy/systemd/njupt-notice-refresh.timer" "$unit_dir/njupt-notice-refresh.timer"

systemctl --user daemon-reload
systemctl --user enable --now njupt-notice-refresh.timer
loginctl enable-linger "$USER" 2>/dev/null || true
systemctl --user list-timers njupt-notice-refresh.timer
