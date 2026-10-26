---
name: remote-audio
description: Set up a laptop to hear /ml-voice:read when Claude Code runs on a remote box reached over SSH (herdr, a plain ssh session, a dev server, WSL on another PC). Use when the voice pane says no speaker is reachable, when the person asks to hear the reader on their laptop or remotely, or when sound plays on the wrong machine.
---

# /ml-voice:remote-audio

Claude Code plays sound only on the machine it runs on. When that is a box the person reaches over
SSH, the laptop in front of them hears nothing. The fix needs no SSH from the box back to the
laptop. The laptop's own SSH connection carries a `RemoteForward 4714 localhost:4714`, and a small
listener on the laptop (`remote/listen.pl`, Perl, only on 127.0.0.1) plays each clip the box sends.
The voice pane then offers "♪ laptop (SSH) ⇄" and plays there.

You run on the remote box; the laptop is out of your reach. The person runs one line there.

## 1. Check whether it already works

```sh
bash -c 'exec 3<>/dev/tcp/127.0.0.1/4714 && echo ping >&3 && read -t 2 -r said <&3 && [ "$said" = pong ]' && echo works
```

`works`: tell the person it is set up, and that `/ml-voice:read` plays on the laptop. Stop here.

Otherwise, `ss -tln | grep ':4714 '` (or `lsof -nP -iTCP:4714 -sTCP:LISTEN`) tells the two
failures apart. A port that listens means the forward is up but the laptop's listener is not
running: the setup line below starts it. No port means the forward is missing: step 2.

## 2. Find the laptop's name for this box

The forward goes in the laptop's `~/.ssh/config`, under the `Host` entry the laptop uses to reach
this box, the name it passes to `ssh` or to `herdr --remote` / `herdr machine add`. Nothing on the
box knows that name, so ask the person for it. To help them find it, give this box's address
(`hostname`, and the server side of `$SSH_CONNECTION`). A name with no entry of its own gets a new
one.

## 3. Give the person one line to run on the laptop

The plugin root is two folders above this skill's base directory. Fill in both values and hand
over the line exactly:

```sh
ssh <host> cat <plugin root>/remote/laptop-setup.sh | sh -s <host> <plugin root>
```

The line fetches the installer through the laptop's own SSH access to this box. The installer then:

- copies the listener to `~/.ml-voice/listen.pl`;
- keeps it running with launchd on macOS, or a systemd user service on Linux;
- adds `RemoteForward 4714 localhost:4714` to `<host>` in `~/.ssh/config`. The original file is
  kept as `~/.ssh/config.bak-ml-voice`, and a symlinked config stays a symlink.

Running it again changes nothing that is already in place. Say what the line changes on the laptop
before the person runs it. A Windows laptop is not supported: it has neither Perl nor a player.

If you can reach the laptop yourself (the person names an SSH host for it that works from here),
offer to run the same steps there, and run them only after the person says yes.

## 4. Reconnect and verify

Forwards come up only on a new connection. The person reconnects: in herdr, reconnect the machine;
with plain ssh, log in again. Then run step 1's check again. If it fails:

- **No port on the box:** the connection that came up did not use the edited `Host` entry (another
  name, or an IP typed directly). Ask again which name the laptop connects with.
- **Port listens, no pong:** the laptop's listener is not running. On macOS look at
  `~/.ml-voice/listen.log` and `launchctl print gui/$(id -u)/dev.ml-voice.listener`; on Linux,
  `systemctl --user status ml-voice-listener`.
- **"remote port forwarding failed" when connecting:** another connection already holds 4714 on
  the box. The person closes the old connection.

When it works, `/ml-voice:read` plays on the laptop. Pressing `o` in the voice pane, or clicking
the output name, switches between the laptop and this machine when both can play.
