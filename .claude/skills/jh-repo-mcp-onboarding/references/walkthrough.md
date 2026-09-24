# The guided walkthrough

## Read this part before you start

A tour is not a document. The strong pull, when someone says "walk me through
this codebase," is to produce a comprehensive written guide — every stage, every
file, every invariant, checkpoint questions with the answers helpfully supplied
below. Resist that. A guide they scroll past teaches nothing; the thing that
actually installs understanding is the back-and-forth, because that's where you
find out what didn't land.

So the shape of this is: **one stage per message. End with a question. Stop
talking.** Do not write stage 2 until they have answered stage 1. Do not append
answers to your own checkpoint questions — a question you answer yourself is
just a rhetorical device, and it costs you the only diagnostic signal you get.

Concretely, each stage message should be:

- short enough to read in under a minute — a few paragraphs, not a chapter
- anchored on **one** file they open themselves, with a specific thing to look at
- ended by a real question, then nothing else

If they answer well, move on and go faster. If they answer partially, fill the
gap and re-ask in a different form. If they answer wrong, that's the whole
value of the exercise — that misconception was going to reach the code
eventually, and you found it in minute six instead.

**The escape hatch.** Some people genuinely want the document — they're
skimming before a meeting, they learn by reading, they're returning to refresh.
Offer it in your opening message ("I can walk you through it interactively, or
just dump the whole thing as a written guide — which do you want?"), and if
they pick the document, give them the document: cover the same stages in one
pass, no checkpoints. Don't force Socratic method on someone who asked for a
reference. But default to interactive when they haven't said.

**Resuming.** This spans days for most people. When someone comes back, ask
where they left off rather than restarting, and open with a one-line recap of
the previous stage's point.

---

## When it goes off-script

It will. The stages below are a default path, not a track, and the single most
common way this fails is a guide who keeps steering back to stage 3 while the
learner is trying to ask something else. **The tour serves them; the moment it
stops being what they need, drop it.** You can always say "want to come back to
the tour after, or are we done with it?"

Read what kind of departure it is before responding — they need different
things:

**They challenge the architecture.** "This canonical-gate thing is massively
over-engineered — why not just fix the Solr index?" Take it seriously, because
it's a good question and a newcomer asking it is doing their job. Do not
defend reflexively. Give the honest answer *including the cost*: yes, it's an
extra round trip per result; the index is owned by another team and its
access-control fields have drifted before; and the failure mode being bought
off is publishing a withdrawn thesis, which is unrecoverable in a way that
latency isn't. Then point them at the ADR — several of this repo's twelve record
roads not taken, and reading one is a better answer than anything you'll
improvise. If they're actually right about something, say so; "that's a live
question, here's where it was argued" is a fine answer, and pretending the
design is beyond question teaches them not to question it.

**They want to skip ahead.** "Forget setup, I'm debugging a pagination bug, how
does federation work?" Then they aren't on a tour, they're on a task. Switch to
the architecture route in `references/architecture.md`, answer the real
question, and offer the tour later. Insisting on stage order here is pure
ceremony.

**They're impatient with the format.** "This is taking forever, just tell me."
Believe them and switch to the written reference in one pass. Don't negotiate,
and don't make them feel bad for asking — some people learn by reading, and the
staged version is a default, not a diagnosis.

**They rabbit-hole.** A deep tangential question at stage 1 — "wait, how does
Dataverse versioning actually work?" Answer briefly, say it's a stage-4 topic
or a `docs/spike/` topic, and offer to come back. But if the tangent turns out
to *be* their job, follow it and abandon the tour — a person who's about to
work on the Dataverse adapter should be reading the Dataverse adapter.

**They give a confident wrong answer.** Correct it plainly, immediately, and
without softening it into "sort of, but also…". Politeness that leaves a
misconception intact is the most expensive thing you can do here, because the
misconception is going into the code. Name what's wrong, say what's true, point
at the file that settles it, and move on without belaboring it.

**They go quiet or give up on a question.** "idk", "sure", "makes sense." That's
usually the question's fault, not theirs — it was too abstract, or it assumed
something you hadn't given them yet. Don't just supply the answer and continue.
Ask a smaller version, or make it concrete against a file they're already
looking at, or just ask what part is unclear.

**They ask something the code can't answer.** "Who do I ask for Solr access?",
"Why is this a priority?" Say you don't know and suggest who might. Guessing at
team logistics is worse than useless.

One thing that does not bend: if they push back on an *invariant* — proposing
something that would weaken the disclosure guarantee — engage with the reasoning
but don't concede the point to be agreeable. That's the one place where being
easy to persuade is a real liability.

### After pushback, hand the thread back — don't quiz

The "end every stage with a question" habit has one failure mode worth naming:
applying it mechanically right after someone has challenged you. If they've just
argued the architecture is over-engineered and you close with "so here's a
question for *you* — what's wrong with this other proposal?", it lands as being
tested rather than heard, however good the question is.

Those are two different moves. A **checkpoint question** belongs at the end of a
stage you just taught. **Handing the thread back** belongs at the end of a
disagreement, and it sounds like "does that land, or do you still think it's the
wrong call?" — which invites them to keep disagreeing. Use the second one after
pushback. If they're satisfied, the next stage's checkpoint is right there
waiting; you've lost nothing by not stacking them.

---

## The opening message

Short, but not a menu. Someone who said "give me the tour" should get the
beginning of a tour, not a form to fill in — deliver real orientation, mention
the written-doc alternative in passing rather than blocking on it, and end on
one question that actually changes what you do next. Roughly this much:

> This is a read-only MCP server that gives an AI assistant one search interface
> over two Johns Hopkins repositories: JScholarship (theses and articles, running
> DSpace) and JHRDR (research datasets, running Dataverse). Different platforms,
> different metadata, different notions of "published" — the server hides all of
> that behind one federated search.
>
> The whole architecture is shaped by one constraint: it must never disclose a
> record that isn't public, and never let a client infer that a non-public
> record exists. Almost everything that looks over-engineered is downstream of
> that.
>
> There are five stages I'd take you through, and I'll go one at a time with a
> question at the end of each so we catch anything that doesn't land — say the
> word if you'd rather I just wrote the whole thing up as a doc instead.
>
> Starting point: is this checked out and running on your machine yet, or are
> you reading it cold? That changes where we begin.

Then **stop.** Two things about that last question: it's one question, not a
questionnaire, and it's the one whose answer actually changes your next move.
If they've already told you their background — most people do, unprompted, in
the message that started this — don't ask again; use it. A person who has built
MCP servers doesn't need stage 3's protocol explanation, and a person who has
never seen an institutional repository needs more of stage 1.

If the repo is already running, skip straight past stage 0's install steps to
the `bun run dev` moment, which is the part that teaches something.

---

## Stage 0 — Get it running

Do this before any architecture talk. A broken toolchain discovered on day three
is a bad day; discovered in minute two it's just a step. And the failure modes
here teach the design better than prose does.

Have them run:

```bash
bun install --frozen-lockfile
bun run typecheck
bun test
```

Two things worth saying while that runs: `bun install --frozen-lockfile` is the
real command (`bun ci` doesn't exist in the pinned Bun 1.2.15),
and `bun run typecheck` is not redundant with the build — Bun's bundler strips
types without checking them.

Then have them start it:

```bash
bun run dev
```

**It will exit immediately**, listing every missing environment variable at
once. Let that happen before you explain it — the surprise is the teaching
moment. Then: this service fails closed and fails loud, and it reports *all*
the config problems rather than the first one, because a deploy that fails four
times in a row on four different variables wastes an afternoon.

A minimal local set, if they want the process to actually stay up:

```bash
ENVIRONMENT=stage BUILD_VERSION=dev BUILD_COMMIT=local \
JSCHOLARSHIP_SOLR_URL=http://localhost:8983/solr/search \
JSCHOLARSHIP_API_URL=http://localhost:8080/server/api \
JSCHOLARSHIP_PUBLIC_URL=https://jscholarship.library.jhu.edu \
ALLOWED_HOSTS=localhost \
bun run dev
```

With nothing behind it, `GET /health/live` returns OK and `GET /health/ready`
returns 503. Have them hit both. (Leaving the JHRDR variables unset is normal —
that adapter is only constructed when all three of its URLs are present, so the
server runs single-repository.)

**End the message here, with:** liveness passes but readiness doesn't — what do
you think readiness is waiting for?

*(The answer, for you: Solr schema validation. A task that can't confirm the
deployed index still has the fields the profiles require never takes traffic.
Don't hand them this; it's a guessable question and the guess is the point.)*

---

## Stage 1 — The problem, and the vocabulary

Two Johns Hopkins repositories, independently operated. JScholarship is the
institutional repository — theses, articles, reports — on DSpace. JHRDR is the
research data repository — datasets — on Dataverse. A researcher asking "what
has Hopkins published on X, and is there data I can reuse?" should not have to
know that any of that is true.

Then the constraint, stated plainly: the service must never disclose a record
that isn't public — withdrawn theses, embargoed datasets, drafts, restricted
deposits — and must never let a client *infer* one exists.

Point them at `CONTEXT.md` and have them read it now, not later. It's the domain
glossary, it's short, and the terms are used precisely throughout the code and
specs. The one distinction to draw their attention to: a **Candidate** is a Solr
hit that hasn't been validated and is never returned to anyone; a
**SearchResult** is what a Candidate becomes after it passes the canonical gate.

**End with:** why do you think that distinction gets two separate words in the
glossary, rather than both just being called "results"?

---

## Stage 2 — The central move

This is the stage that matters. If they only retain one thing, this is it, and
it's worth spending two exchanges here rather than rushing to stage 3.

Lead with the claim:

> **Solr finds candidates. The canonical API decides truth.**

Every search hits a private Solr collection — fast, good relevance, faceting.
But nothing Solr returns is trusted. Every candidate is re-fetched through the
platform's own public API, as an anonymous caller, and one that fails that fetch
is silently dropped. No Solr-sourced metadata ever reaches a client.

**Ask why before you explain why.** "That's an extra network round trip per
result. Why would you pay that?" Let them think. Then: the Solr indexes are
internal, they lag the platforms, and their copies of access-control fields have
drifted from what the platforms actually enforce. Solr is a fast index, not an
authority on who may see what. Making it the authority means eventually
publishing a withdrawn thesis.

Have them open **`src/adapters/canonicalize.ts`** — it's about 80 lines — and
find the line that drops a failed candidate:

```ts
if (item === null) { omissions += 1; continue; }
```

That line is what the whole architecture exists to protect. Worth noting how
unremarkable it looks, which is exactly why the surrounding structure has to
make it hard to bypass.

**End with:** a teammate proposes returning the Solr title directly to save the
round trip — "we already confirmed the record exists, we're just avoiding a
second fetch for a field we already have." What's wrong with that?

*(For you: it reintroduces Solr as a source of returned data. The record's
existence and its metadata's freshness are different claims — the title in Solr
may be from before a correction, or from a version that was later withdrawn.
Also, once one field is allowed through, the boundary stops being checkable.)*

### If that lands, follow with the layers

Only after they've engaged with the gate. Four layers, each with a distinct job
— ask them to guess what each is for before you say:

1. **Immutable public filters** in the repository profile, so most non-public
   records never become candidates. Cheap, and no client input can weaken them.
2. **Field allowlists**, so there's no raw Solr passthrough — no escape hatch
   around layer 1.
3. **The canonical gate** — the authority.
4. **Indistinguishable not-found**, so even the *shape* of a failure leaks
   nothing.

Good file to open here: `config/repositories/jscholarship-profile.ts`. It's
concrete and readable, and seeing the immutable filters as literal data makes
the point better than describing them.

---

## Stage 3 — What a client actually sees

Five tools — `search_items`, `get_item`, `list_facets`, `find_related_items`,
`explain_search` — two resource templates under `jhu-repo://`, and two prompts.
If they're new to MCP, that's the moment for a two-minute explanation: it's a
protocol for exposing tools and data to a model, this server speaks it over
stateless HTTP, and the model on the other end is the consumer.

The load-bearing fact: **this list is closed.** `src/mcp/registry.ts` holds it as
a static table, every schema is `additionalProperties: false`, there's no
dynamic tool creation, and `test/integration/excluded-capabilities.test.ts`
exists specifically to fail if the surface grows. Adding a tool means updating
the spec first. That friction is deliberate — every tool is new attack surface
against the disclosure guarantee.

Two design notes, if there's appetite:

- **The host model does the synthesis** (ADR-009). The server returns structured
  citation-ready records; it doesn't summarize or embed an LLM. That's what keeps
  the disclosure guarantee testable.
- **The transport is stateless** (ADR-006). `POST /mcp` only, no session id — so
  any Fargate task serves any request, which is why pagination state has to live
  in the cursor.

Have them read `src/mcp/tools/search-items.ts` end to end. It's the best single
file for the tool layer's job, and it contains the question below.

**End with:** the fan-out across repositories uses `Promise.allSettled`, not
`Promise.all`. What behavior would change if you swapped it?

*(For you: one repository being down would fail the whole search instead of
returning a partial result with a warning. Partial-with-a-warning is the right
answer for a discovery tool — half an answer beats none.)*

---

## Stage 4 — Federation and pagination

Two independent Solr instances whose relevance scores are **not comparable** —
different corpora, different boosts, different similarity configs. So the system
never compares them. Each adapter reports only its ordinal rank, and
`src/federation/index.ts` merges by reciprocal-rank fusion: `weight / (60 + rank)`.

The detail worth dwelling on is the tie-break: it alternates between
repositories, with the next preferred source carried in the cursor. Ask why
alternating rather than a fixed preference — a fixed tie-break quietly favors
one repository page after page, which in a federated discovery tool is an
invisible thumb on the scale.

Then the cursor: opaque, versioned, base64url, carrying per-repository offsets
plus a hash of the query that produced it. When the hash doesn't match, the
server **resets to page 1 with a warning instead of erroring** (ADR-012).

That one is worth stopping on, because it generalizes: the consumer here is a
language model, and an error at a pagination boundary reliably produces a retry
loop, while a reset plus an honest warning produces a model that continues and
tells the user what happened. Designing error semantics for a model consumer
rather than a human one recurs throughout this codebase — once they can see it
here, they'll spot it elsewhere.

**End with:** the canonical gate drops candidates, so a page of 10 candidates
might yield 7 records. The gate is careful to resolve them in rank order. What
would break if it didn't?

*(For you: cursor arithmetic. `nextOffset = offset + consumed` is only correct if
the consumed candidates form a prefix of the rank order — out of order, pages
would silently skip or repeat records.)*

---

## Stage 5 — Their first change

Don't end on theory. Offer a concrete first change and let them pick:

1. **Add a property test** for an invariant that lacks one (`test/property/`,
   ≥100 generated cases via `fast-check`). Lowest risk, and it forces them to
   state an invariant precisely.
2. **Fix a real rough edge** — declare `zod-to-json-schema` in `package.json`,
   wire `TIMEOUT_API_MS` through to the platform clients, or URL-validate the
   JHRDR env vars. Each is small, genuinely broken, and drags them through a
   module. (`references/architecture.md` has the full list; verify it's still
   true before promising it.)
3. **Pick up open spec work** from `.kiro/specs/jscholarship-jhrdr-mcp/tasks.md`
   — tasks 20, 21, 25, and 26 are the ones still open.

Then walk the loop once with them: `bun test`, `bun run typecheck`,
`bun run lint`, a changelog fragment via `bun run changelog:new`, and a PR
description citing requirement and task numbers. Getting that rhythm right on
the first change is most of what "knowing a codebase" turns out to mean.

---

## Closing the tour

When they're done, ask them to state the four or five invariants back without
looking. Not as a quiz — as the actual exit criterion. Someone who can say
"Solr finds, the canonical API decides; filters and allowlists are immutable;
not-found is indistinguishable; scores are never compared across repositories;
everything fails closed" can be trusted with the code. Someone who can recite
the directory tree but not those cannot, and more tour won't fix it — go back to
stage 2.
