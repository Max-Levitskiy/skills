# Configure or extend Herdr

Distinguish this repository's coding-agent skills/plugins from native Herdr executable
plugins. Reading Markdown does not install hooks/MCP servers/authentication/runtime code.

## Find a setting

Default-config prints defaults; config check validates the selected file.
HERDR_CONFIG_PATH can override it. Status identifies a server, not permission to rewrite
global settings. Preserve unrelated keys. Reload-config changes the server; some settings
need restart and can affect all panes.

Filter the canonical structured reference by exact key rather than loading the 210 keys
observed in 0.9.3:

```bash
curl -fsSL https://raw.githubusercontent.com/herdrdev/herdr/v0.9.3/docs/next/website/src/data/config-reference.json |
  jq --arg key 'ui.sidebar_width' '.sections[].keys[] | select(.key == $key)'
```

Use installed channel/revision sources; stable llms.txt and preview index differ.
Do not store captured manuals in the skill.

| Task | Config/docs family |
| --- | --- |
| Keyboard/prefix/indexed jumps/copy mode/custom commands | keybindings; keyboard |
| Mouse/sidebar rows/agent order/window titles | UI/sidebar; configuration |
| Headless size/scrollback/shell defaults | server/terminal |
| Theme/graphics/cursor/IME/input-source | theme/experimental; Windows support |
| Toasts/notifications/sounds | notifications/sound; notification show |
| Worktree roots/trust/agent restore/history | worktrees/session/experimental |
| SSH/recovery | remote; connecting-machines |
| Channels/update/manifests | update/channel; server manifests |

Show notification, channel set, update, reset-keys/reload change state; perform the
requested changes only. Completion scripts can be printed without installing shell config.
Keyboard/mobile/UI details are task routes, not mandatory delegation prerequisites.

## Native Herdr plugins

Plugin help covers install/uninstall/link/unlink/enable/disable/list/config-dir/action/log/
pane. Review herdr-plugin.toml and command argv before installing/linking: build/runtime
commands run as the user with inherited environment, without a Herdr sandbox.
Manifests declare actions/startup/event hooks/panes/link handlers/keybindings.
Windows plugins are preview/platform-dependent; pin revisions when requested.

Context provides target IDs and HERDR_BIN_PATH. Store user config under
HERDR_PLUGIN_CONFIG_DIR and durable runtime state under HERDR_PLUGIN_STATE_DIR;
managed source checkout is not durable user storage. No v1 managed storage API exists.
Plugin cwd is its directory, not necessarily the user's repository.

Feature inventory and maintenance sources:
https://herdr.dev/docs/configuration/ and https://herdr.dev/llms.txt.
Plugin authoring/marketplace:
https://herdr.dev/docs/plugins/ and https://herdr.dev/docs/marketplace/.
Install/requirements/update managers/completions/platform limits:
https://herdr.dev/docs/install/ and https://herdr.dev/docs/windows-beta/.
