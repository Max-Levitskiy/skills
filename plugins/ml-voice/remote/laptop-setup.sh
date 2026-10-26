#!/bin/sh
# Sets up a laptop to hear ml-voice from a remote box. Run on the laptop, which
# fetches this script and the listener over its own SSH access to the box:
#
#   ssh <host> cat <plugin root>/remote/laptop-setup.sh | sh -s <host> <plugin root>
#
# It installs listen.pl in ~/.ml-voice, keeps it running with launchd (macOS) or
# a systemd user service (Linux), and adds "RemoteForward 4714 localhost:4714"
# to <host>'s entry in ~/.ssh/config (a copy of the old file is kept). Running it
# again changes nothing that is already in place.
set -eu

host=${1:?usage: laptop-setup.sh <ssh host of the remote box> <plugin root>}
root=${2:?usage: laptop-setup.sh <ssh host of the remote box> <plugin root>}
port=${3:-4714}
dir=$HOME/.ml-voice

mkdir -p "$dir"
# -n: this script arrives on stdin, and ssh would read the rest of it.
ssh -n "$host" cat "$root/remote/listen.pl" > "$dir/listen.pl.new"
mv "$dir/listen.pl.new" "$dir/listen.pl"
chmod +x "$dir/listen.pl"

case $(uname -s) in
Darwin)
  plist=$HOME/Library/LaunchAgents/dev.ml-voice.listener.plist
  mkdir -p "$(dirname "$plist")"
  cat > "$plist" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>dev.ml-voice.listener</string>
  <key>ProgramArguments</key><array><string>/usr/bin/perl</string><string>$dir/listen.pl</string><string>$port</string></array>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>StandardErrorPath</key><string>$dir/listen.log</string>
</dict>
</plist>
EOF
  launchctl bootout "gui/$(id -u)" "$plist" 2>/dev/null || true
  launchctl bootstrap "gui/$(id -u)" "$plist"
  ;;
*)
  unit=$HOME/.config/systemd/user/ml-voice-listener.service
  mkdir -p "$(dirname "$unit")"
  cat > "$unit" <<EOF
[Unit]
Description=ml-voice laptop listener

[Service]
ExecStart=/usr/bin/perl $dir/listen.pl $port
Restart=always

[Install]
WantedBy=default.target
EOF
  systemctl --user daemon-reload
  systemctl --user enable ml-voice-listener >/dev/null
  systemctl --user restart ml-voice-listener
  ;;
esac

# The forward goes in the host's own entry, so only connections to that box carry it.
config=$HOME/.ssh/config
forward="RemoteForward $port localhost:$port"
mkdir -p "$HOME/.ssh"
touch "$config"
if awk -v host="$host" -v forward="$forward" '
  /^[ \t]*[Hh]ost[ \t]/ { inside = 0; for (i = 2; i <= NF; i++) if ($i == host) inside = 1 }
  inside && index($0, forward) { found = 1 }
  END { exit !found }' "$config"; then
  echo "~/.ssh/config already forwards port $port for $host."
else
  # The first copy is the file as it was before ml-voice touched it.
  [ -e "$config.bak-ml-voice" ] || cp "$config" "$config.bak-ml-voice"
  awk -v host="$host" -v forward="$forward" '
    { print }
    !done && /^[ \t]*[Hh]ost[ \t]/ { for (i = 2; i <= NF; i++) if ($i == host) { print "  " forward; done = 1 } }
    END { if (!done) printf "\nHost %s\n  %s\n", host, forward }' "$config" > "$config.new"
  # Written in place: a config that is a symlink (chezmoi, stow) stays one.
  cat "$config.new" > "$config"
  rm -f "$config.new"
  echo "Added \"$forward\" to $host in ~/.ssh/config (old copy: ~/.ssh/config.bak-ml-voice)."
fi

echo "The listener is running. Reconnect to $host (herdr or ssh) so the forward comes up."
