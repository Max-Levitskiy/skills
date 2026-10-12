// Claude Code only: the mod. It stays thin (docs/spec.md, p.7): the helper works out what the mod
// shows, and the mod calls it and renders the answer. For now it checks the host's version at
// session start; the start line, the menu, the run line and the live view join it later.

import type { Register } from 'claude-code'

import { CLAUDE_CODE_MINIMUM, isOlder } from '../src/version'

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const { version, base } = await $.session.version()
    if (isOlder(base ?? version, CLAUDE_CODE_MINIMUM)) {
      $.ui.log(`ml-workflow needs Claude Code ${CLAUDE_CODE_MINIMUM} or later; this is ${version}. Run: claude update`)
    }
    return next(e)
  })
}
