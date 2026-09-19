# Project scoping: bootstrapping and classification

Read this when no projects are configured yet, or when `bun "$F" project undecided`
returns series that need judging.

## If no projects are configured

Don't invent rules from nothing, and don't silently return everything when the user clearly meant one project. Look at the actual data first, then propose:

```bash
bun "$F" notes list --since 60 --all --all-meetings
```

Recurring titles cluster a workspace fast — the handful of titles that repeat weekly usually *are* the projects. Suggest a starting config from what's actually there: a couple of literal title keywords per stream, plus an attendee domain when an external organisation is involved. Concrete beats clever; a plain client or product name matches more reliably than a carefully engineered regex, and the user can see at a glance whether it's right.

Write it into the config's `projects` block (see `../config.example.json`) and set `defaultProject`.

## Classifying what the rules can't decide

The matcher runs cheapest-first: a remembered verdict for the calendar series (free), then title rules (free), then attendee rules (free). Anything left over is *undecided* — and that's where you come in:

```bash
bun "$F" project undecided --since 30
```

This lists **series, not occurrences** — a daily standup appears once, not thirty times.

For each one, work in three steps. The third is not optional:

**1. Read it.** Fetch the summary of one occurrence — `recap <id>` is usually plenty. Judge from what was actually discussed, not the title: if the title were decisive, a Tier-1 rule would have caught it already.

**2. Check whether it's a stream or a one-off.** How many occurrences the series has, and whether sibling meetings look related, changes the right answer. A recurring series that keeps landing in the queue wants a *title rule* so it self-sorts; a genuine one-off just wants a verdict.

**3. Ask the user, with a recommendation.** Present what you found and what you'd do, then let them decide. Give them the shape:

> *&lt;title&gt;* (&lt;date&gt;, &lt;N&gt; occurrences in the window) — &lt;one line on what was actually discussed&gt;. &lt;How it relates, or fails to relate, to the configured projects&gt;.
> Recommend: **&lt;verdict&gt;**. Alternatives: &lt;the other reasonable options&gt;.

Offer the full range, not a yes/no. A meeting fitting no configured project may deserve **its own new project** rather than `none` — often the right answer when the user recognises a stream of work you simply haven't been told about. Batch the questions when several series are pending.

Only once they answer, record it — from the repo the user is working in, since the verdict lands in *that* repo's config:

```bash
bun "$F" project classify <series-key> <project|none> --why "<the reasoning, in a sentence>"
```

**Never record a verdict the user hasn't agreed to.** It writes to the committed repo config: durable, shared with teammates, and shaping every future query. A wrong one is invisible precisely because it stops appearing in the undecided queue — so leaving something undecided is strictly safer than guessing. Ask even when the answer looks obvious; the user knows things about their own projects that no meeting summary contains.
