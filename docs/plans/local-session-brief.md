# Brief for a local Claude Code session

You are Claude Code on the owner's machine, continuing work that was done in a cloud session on branch
`claude/testability-and-dispatcher`. The owner should not have to explain anything: this file, `CLAUDE.md` and the
docs it points to hold the context. If something here conflicts with your own memory, trust this file and the repo,
and report the conflict (step 3). If something is ambiguous, ask the owner a short question; do not guess on design.

The session has three parts, in order: **check and investigate** (steps 1-3), **plan** (step 4, then stop for
approval), **execute** (step 5). Finish with the **report** (step 6) whatever happens, including if you stop early.

## 1. Setup checks

1. `git fetch origin` and check out `claude/testability-and-dispatcher`; pull it. If checkout is blocked by a local
   untracked `CLAUDE.md`, stop and ask the owner (suggest renaming theirs to `CLAUDE.local.md`, which is not committed).
2. Record, without changing anything: `git status`, `git stash list`, `git log --oneline origin/master..master`
   (unpushed local master commits), and other local branches with unpushed commits. Known: the owner's
   setImmediate to setTimeout change and `sleep()` rewrite (the `0.7.0-alpha.2` version bump) is commit `828730e` on
   the local-only branch `obsolete/legacy-change-of-timer`; leave it alone. Never push, rebase or reset `master`.
3. Use Node >= 22.12 with its own npm 10 (check `node -v` and `npm -v` first). If the default Node is older and must
   stay (the owner's machine keeps Node 14 for another codebase), install Node 22 into a scratch prefix and put it
   first on `PATH` for this session only; never switch the global Node. `npm ci` deletes `node_modules` before it
   installs, so run it only under the right npm. Then the gates: `npm test`, `npm run test:drivers`, `npm run test:types`, `npm run build`.
   Expected (as of 573c8a9): 58 passed + 19 expected failures on each driver, no unhandled errors, clean typecheck and build.
   If a gate fails, stop, put the output in the report, and do not "fix" it without the owner.

## 2. Reading order

1. `CLAUDE.md` (commands and rules).
2. `docs/plans/handoff-2026-10.md` (what is done, findings, who does what, the owner's latest answers in section 8).
3. `docs/plans/decision-workbook.md` (every open decision; the owner's answers, if any, are on the **Answer:** lines).
   Turn answered items into specs and decision records before other work.
4. `docs/plans/gaps-to-complete-csp.md` (what a complete CSP still needs, with spec IDs).
5. `docs/tests/SPEC-LEDGER.md` (every spec, its status, sign-off).
6. Background on branch `research/csp-inspection`. Read it without checking it out onto this branch, e.g.
   `git show origin/research/csp-inspection:docs/plans/open-design-decisions.md`. Most useful:
   `docs/plans/open-design-decisions.md` (D1-D10 decided, O1-O6 open), `docs/plans/alts-design.md`,
   `docs/research/2026-10-roadmap.md`, `docs/plans/test-strategy.md`, `docs/plans/typing-and-lifecycle.md`
   and `docs/plans/async-core-investigation.md` (these two came from an earlier local session, possibly yours).
7. Skim `src/` and `test/` only as needed for steps 3-4.

## 3. Memory investigation

Inventory everything you remember or load about this project: project and user `CLAUDE.md` files,
`CLAUDE.local.md`, the files `/memory` lists, any auto-memory for this project under `~/.claude/projects/`, and plan
files from earlier sessions. For each item, classify it:

- **Still valid**: agrees with the docs.
- **Superseded**: the docs record a later decision. Cite the doc and decision ID (for example D5 vs the owner's newer
  answer on the template DSL in handoff section 8).
- **Conflict**: the docs and memory disagree and neither clearly wins. List it as a question for the owner.
- **Private**: anything about the owner's CV, employer, customers, or production code. Never copy it into the repo
  (the repo is public). It may go in the report, which is not committed.
- **Unknown to the docs**: something you know that the docs do not mention (for example work done locally, unpushed
  commits, decisions made in an earlier local session). This matters most: list it in full.

Do not edit or delete memory files. Propose edits in the report; the owner decides.

## 4. Planning pass (then stop for approval)

Write or update `docs/plans/phase-1-plan.md`. Phase 1 (channel core) is the **owner's** code; the plan is a guide
for them, not something you implement. For each item, give: the spec IDs it flips, the code location
(file:line), your root-cause reading after looking at the code, the suggested change in plain words, risks, and
which other specs could break. Items: C1/C2 FIFO waiting puts and takers, C4 `MAX_DIRTY` dropping puts, C5 overflow
error at 1,024, C3/C15 bug 1 (registry entry deleted in `flush` while `loops.ts` still reads it), C14 splicing an
already-closed inner channel, C16 put-then-take on the same buffered channel in one process, M1. Suggest an order.

Also list the Claude-side work you propose for step 5, in order, with a done-when for each. The default proposal
below was **done** in the first local session (commits `0cd7701`, `672476c`, `573c8a9`). Next proposals come from the
owner's answers in `docs/plans/decision-workbook.md` (each answered item lists the specs it unblocks). One check the cloud session could not do
(no GitHub access): read core.async's `clojure/core/async/impl/channels.clj` (`close!`, `take!`) and record what
happens to puts that are waiting when a channel closes, for workbook item W-S3. Original
proposal, for reference:

1. Specs (as `it.fails` with `knownBug: 'not implemented'`) for missing features from the gap list: rendezvous
   R1-R3, non-blocking alts A5, put arms A6, closed-arm semantics A7 (only where the expected behaviour is already
   decided; otherwise write the question, not the spec), close-with-pending-puts C17, and `loopUntil` as passing characterisation specs (K-specs, not `it.fails`).
2. T6: A/B performance harness (tinybench per driver, interleaved; Vitest 5 has no `bench`) and the memory suite in `test/memory/`
   (`--expose-gc`), report under `docs/perf/`, including Node MessageChannel start-up and exit cost.
3. Seeded-driver exploration (many seeds over C1-C4, A1-A4, print failing seeds); informational, not a gate.

Show the plan to the owner and wait for "go" (they may cut or reorder). Do not start step 5 without it.

## 5. Execution pass

- Work only on `claude/testability-and-dispatcher`. One commit per item, message ending with the attribution lines
  your harness gives you. Run all four gates before every commit. Push after each green commit. If `git push` fails (for example no SSH key in
  the session), keep committing locally, and put "not pushed: owner must run `git push origin
  claude/testability-and-dispatcher`" at the top of the report and of the chat summary.
- Never change owner-task code (Phase 1-3 behaviour in `src/impl/processQueue.ts`, `channels.ts`, `go.ts`,
  `process.ts`, `loops.ts`) unless the owner asks for that specific change. Tests, harnesses, docs, and
  mechanical changes are yours.
- Writing a spec changes the ledger: run `npm run specs` and commit the regenerated ledger. Never sign off specs.
- Do not decide open questions (O1-O6, the one-taker mode, typing plan, template DSL migration form). If a task
  needs one, stop that task and add it to the report.
- Do not open pull requests, merge to master, publish, or change the npm version.

## 6. Report back

Write `docs/private/local-report.md` (gitignored; check with `git check-ignore -v` before writing). The owner will
upload it to the cloud session. Plain sentences, these sections:

1. Setup: branch and commit, gate results (counts per driver), anything that failed.
2. Local-only state: unpushed master commits (hash, subject, one-line summary of the diff), other unpushed branches,
   stashes, untracked files that look important.
3. Memory investigation: the classified list from step 3, with proposed memory edits.
4. Plan: link to `docs/plans/phase-1-plan.md` and a summary of what the owner approved, cut or changed.
5. Executed: each commit (hash, one line), and new spec IDs.
6. Not done and why; blockers; questions for the owner and for the cloud session.
7. Anything in this brief that turned out wrong or unclear.

Also give the owner a five-line summary in chat. Keep private items (section 3 "Private") out of chat summaries that
might be pasted elsewhere; they belong only in the report file.
