#!/usr/bin/env bash
set -euo pipefail

case "${1:-}" in
  '')
    if [[ $(uname -s) == Darwin ]]; then
      exec say -f /dev/stdin
    fi
    exec espeak-ng --stdin
    ;;
  --laptop)
    exec 3<>/dev/tcp/127.0.0.1/4714
    clip=$(mktemp -d)
    trap 'rm -f -- "$clip/speech.wav"; rmdir -- "$clip"' EXIT
    if [[ $(uname -s) == Darwin ]]; then
      say -o "$clip/speech.wav" --file-format=WAVE --data-format=LEI16@22050 -f /dev/stdin
    else
      espeak-ng --stdin -w "$clip/speech.wav"
    fi
    printf 'play %s wav\n' "$(wc -c < "$clip/speech.wav" | tr -d '[:space:]')" >&3
    cat "$clip/speech.wav" >&3
    if ! read -r played <&3 || [[ $played != done ]]; then
      echo 'The laptop listener did not acknowledge the clip.' >&2
      exit 1
    fi
    ;;
  *)
    echo 'Usage: bash speak.sh [--laptop] < narration.txt' >&2
    exit 2
    ;;
esac
