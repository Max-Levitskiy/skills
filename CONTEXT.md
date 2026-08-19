# max-skills

A marketplace of Claude Code plugins, plus the standards they share. The vocabulary
below is the language those standards are written in — use these words, and avoid the
ones marked.

## Language

### Configuration

**Layer**:
One ordered source a component's settings are merged from. Later layers override
earlier ones.
_Avoid_: Scope, level, tier

**Global layer**:
A user's defaults across every project.
_Avoid_: User config, home config

**Repo layer**:
Settings the whole team shares for one repository. Committed.
_Avoid_: Project config, shared config

**User-repo layer**:
One user's own settings for one repository, held on the user's side rather than in the
repository, so they apply to every checkout of it.
_Avoid_: Per-repo override, global override

**Local layer**:
One user's settings for one checkout. Never committed.
_Avoid_: Personal config, machine config

**Credential reference**:
A description of where a secret can be fetched from. Never the secret itself.
_Avoid_: Credential, secret, token

### Repositories

**Repo root**:
The main checkout of a repository — the one a worktree resolves back to. Never a
worktree.
_Avoid_: Repo path, workspace, project directory

**Worktree**:
An additional checkout of a repository, sharing its history. Never registered, never
identified separately from its repo root.
_Avoid_: Branch checkout, clone

**Repo identity**:
The stable name for a repository, independent of where it sits on any disk. Derived
from the repository's origin; minted only when there is no origin to derive from.
_Avoid_: Repo ID, repo key, repo name

**Alias**:
A short name a human chose for a repository, so they can name it in conversation
instead of typing a path.
_Avoid_: Nickname, label, shortname

### The registry

**Repo registry**:
The user's global index mapping repo identity to where that repository sits on this
machine. Locations only — never settings, never anything derivable from visiting the
repository.
_Avoid_: Registry (unqualified — the harness's plugin registry is a different thing),
repo list, index

**Registering**:
Adding a repository to the repo registry. One step inside repo-onboarding, never a
synonym for it.
_Avoid_: Onboarding a repo, adding a repo

**Unreachable**:
The state of a registry entry whose repository cannot be resolved right now — moved,
deleted, or its git metadata broken. A repository that is merely missing a given
component's settings is not unreachable; it is simply not set up for that component.
_Avoid_: Stale, broken, orphaned

**Fan-out**:
Running one component once, against every registered repository that resolves valid
settings for it.
_Avoid_: Bulk run, multi-repo run, batch

### Onboarding

**User-onboarding**:
Establishing a user's global settings and credential references. No repository
involved.
_Avoid_: Setup, first-run, install

**Repo-onboarding**:
Establishing one repository's settings for a component. Includes registering it.
_Avoid_: Onboarding, repo setup
