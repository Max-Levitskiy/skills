# report

Lead with the verdict, because that is what was asked. Then:

- the path walked through the graph
- what the change touches, what risk you investigated, how it resolved
- a table of gates you ran: command and result
- for each changed package, what CI ran on it and what no check ran
- a table of review findings: finding, outcome, commit or reason
- every gap: a skipped gate, a test you could not run, a failure you could not explain
- what was said, attributed to the account and any signature: `@x posted, signed "automated triage"`. "Your comment", "@x's comment" or "@x says" claims an author you cannot see
- anything unrelated you tripped over, labelled unrelated, so it does not count against the PR
- the merge SHA, or the auto-merge and what it waits on
