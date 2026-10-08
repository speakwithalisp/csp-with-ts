# csp-with-ts through a CSP lens

Status: **research only**, no library code changed. This is a second pass over the library and core.async, made
at the owner's request after noting that the first pass ([`2026-10-inspection.md`](2026-10-inspection.md)) had
inspected the code without measuring it against CSP's own ideas and idioms, and that the DSL discussion had drifted
from them. New probes are in [`probes/`](probes/README.md). Every claim below is either quoted from a source or
measured, and labelled as such.

## Sources read

| Source | How obtained |
|---|---|
| C.A.R. Hoare, *Communicating Sequential Processes*, CACM 21(8), 1978 | PDF from the Papers We Love repository |
| C.A.R. Hoare, *Communicating Sequential Processes* (book), 1985, electronic edition 2004 | Same repository |
| Effective Go: "Concurrency", "Channels", "Channels of channels"; Go FAQ: "Why build concurrency on the ideas of CSP?" | `golang/website` sources |
| Rob Pike, *Go Concurrency Patterns* (Google I/O 2012); *Concurrency is not Parallelism* (2012); Sameer Ajmani, *Advanced Go Concurrency Patterns* (2013) | `golang/website` talk slides |
| Go blog, *Pipelines and cancellation*; *Context* | `golang/website` sources |
| Rich Hickey, *Clojure core.async Channels*, Strange Loop 2013 (transcript); *Transducers* (transcript) | `matthiasn/talk-transcripts` |
| core.async `doc/rationale.md`, `doc/flow.md`, `doc/flow-guide.md`; CLJS sources (`channels.cljs`, `dispatch.cljs`, `timers.cljs`, `async.cljs`) | `clojure/core.async` clone |

---

## 1. What CSP is, in its own words

**Hoare 1978**, the essential proposals (quoted from §1):

1. "Dijkstra's guarded commands are adopted … as the sole means of introducing and controlling nondeterminism."
2. "A parallel command … specifies concurrent execution of its constituent sequential commands (processes). All the
   processes start simultaneously, and the parallel command ends only when they are all finished. They may not
   communicate with each other by updating global variables."
3. "Simple forms of input and output command are introduced."
4. Communication happens when each process names the other. "**There is no automatic buffering**: In general, an
   input or output command is delayed until the other process is ready with the corresponding output or input."
5. "Input commands may appear in guards … If several input guards of a set of alternatives have ready
   destinations, **only one is selected and the others have no effect**; but the choice between them is arbitrary."
6. "A repetitive command may have input guards. **If all the sources named by them have terminated, then the
   repetitive command also terminates.**"
7. Pattern matching on message structure (to accept only messages of the expected shape).

**From the paper's discussion (§7):**
- **7.4 Automatic buffering, rejected:** "when buffering is required on a particular channel, it can readily be
  specified using the given primitives". Buffers are *processes* (§5.1 builds a bounded buffer as a process).
- **7.6 Fairness:** a language need not promise fairness, but an implementation "should ensure that an output
  command is not delayed unreasonably often". "Even an operating system should be designed to bring itself to an
  orderly conclusion reasonably soon after it inputs a message instructing it to do so. Otherwise, the only way to
  stop it is to 'crash' it."
- **7.7 Functional coroutines** (contrast with Kahn–MacQueen process networks): there, "output commands are
  automatically buffered to any required degree. **The output of one process can be automatically fanned out to
  any number of processes … which can consume it at differing rates.**" Hoare calls these "natural consequences
  of the difference between the more abstract applicative (or functional) approach … and the more
  machine-oriented imperative (or procedural) approach, which is taken by communicating sequential processes."
- **7.8 Output guards:** proposed as a natural extension (Go and core.async have them).
- **7.9 Repetitive command with input guards:** automatic termination is "an extremely powerful and convenient
  feature", but "the dangers of convenient facilities are notorious … may tempt the programmer to write them
  without making adequate plans for their termination".

**Hoare 1985 (book):**
- "communication is synchronised; if buffering is required on a channel, this is achieved by interposing a
  buffer process between the two processes."
- "channels are used for communication in only one direction and between only two processes."
- Concurrency: shared events "require simultaneous participation" of every process that has them in its alphabet.
  That is **multiway synchronisation**, CSP's own form of one-to-many.
- **Pipes, §4.4:** `P >> Q` is **the chaining operator**. It joins `P`'s output to `Q`'s input and conceals the
  connecting channel, and is associative: `(P >> Q) >> R`. It is valid only if "the connected channels are capable
  of transmitting the same kind of message", i.e. typed. "The chaining operator connects two processes by just one
  channel; and so it introduces no risk of deadlock."

**Go:**
- FAQ: Go's primitives "derive from a different part of the family tree whose main contribution is the powerful
  notion of channels as first class objects."
- Effective Go: "Unbuffered channels combine communication … with synchronization". "Only one goroutine has access
  to the value at any given time." Go's model "can also be seen as **a type-safe generalization of Unix pipes**."
- Pike, 2012: "Channels both communicate and synchronize." On buffering: "Buffering removes synchronization. … more
  subtle to reason about." Patterns: "**Generator: function that returns a channel**", "Channels as a handle on a
  service", "Restoring sequencing: send a channel on a channel".
- Timeouts, two deliberate patterns: `time.After` *inside* the loop is a per-message timeout; "Create the timer
  **once, outside the loop**, to time out the entire conversation."
- `select`: "All channels are evaluated. Selection blocks until one communication can proceed … If multiple can
  proceed, select chooses pseudo-randomly. A default clause … executes immediately if no channel is ready." Nil
  channels block forever, which is used to switch cases off (Ajmani 2013).
- Ajmani 2013, the *for-select loop*: "The cases interact via local state in `loop`."
- Go blog: "stages close their outbound channels when all the send operations are done"; closing a `done` channel
  "is effectively a broadcast signal".

**Rich Hickey (Strange Loop 2013; core.async rationale):**
- The problem: event callbacks force you to "break your logic up into little pieces so that those pieces of logic
  can live inside handlers", which leads to **shared "place" state** between the fragments. Rx "only handle[s] a
  very narrow set of cases … composable transformations on a single event chain. But if you really are trying to
  make a state machine that has multiple sources and sinks of events, you cannot just get it out of something like
  filter and map composition primitives."
- `go` blocks: "We want the semantics of threads and the semantics of _blocking_ … because it allows us to write
  **linear code**." The rationale says the inversion of control is "encapsulated by the mechanism, and you are left
  with straightforward sequential code".
- Channels: "Queue-like … Multi-writer, multi-reader … By default, they are unbuffered", meaning "synchronous
  rendezvous". "Unbuffered == rendezvous." Unbounded buffers: "a recipe for a broken program … You _need_ to make a
  decision here."
- Choice: "**One and only one op will complete** … it is going to tell you which channel actually succeeded and
  what the value was."
- Timeouts: "Just channels … closes after msecs … Timeout channels can be shared" ("create a timeout once and say:
  I am going to try all this stuff in a loop for three seconds").
- Edges: `put!`/`take!` "can be used from outside of Go blocks"; "_Friends don't let friends put logic in
  handlers_."
- "Flow state" (a conveyor belt) versus "place state" (a coat hook): channels expose only flow state.
- "What You Get: … Coherent, linear logic. **Recursion vs mutation** …"
- Rationale: "**The value of values** … it is always safe and efficient to put a Clojure data structure on a
  channel". Actors "still couple the producer with the consumer".
- Transducers talk: "the channel constructor now optionally takes a transducer, and it will transduce everything
  that flows through". Value transformation belongs on the channel, not in a separate operator vocabulary.

---

## 2. The library measured against CSP

| CSP principle | Source | This library | Verdict |
|---|---|---|---|
| Sequential processes with linear code inside | Hoare (1); Hickey "linear code" | Generators give real sequential code inside a process; `;` is sequential composition; `eval` nests a sub-process | ✅ **Faithful.** Generators are a legitimate inversion-of-control mechanism (core.async needs a macro for this; JS has it natively) |
| Parallel composition that ends when all parts finish | Hoare (2) | No `[P ‖ Q]`. `go` is fire-and-forget like Go's `go` statement; there's no join | ⚠️ Gap. A `par`/join operation would be the structured form |
| Communication synchronises (rendezvous), unbuffered by default | Hoare (4), 7.4; Effective Go; Hickey | **No unbuffered channels.** Default is `fixed(1)`; `chan(0)` builds a broken channel | ❌ **The largest deviation.** A put completes before anyone has received, so channels can't be used for coordination ("stay here until somebody is ready for me") |
| Channels are FIFO queues | Hickey "queue-like"; Hoare 1985 `BUFFER` "behaves like a queue" | **Measured:** 10 puts waiting on a full `chan(1)`, taken one at a time, arrive as `0, 9, 8, 7, 6, 5, 4, 3, 2`. **LIFO, and the second put is always lost** ([`p17b.js`](probes/p17b.js)). Also earlier: a value stranded in the buffer while newer ones bypass it (`p13`), and parked takers served LIFO (`p1`) | ❌ **Core correctness bug**, beyond the bugs in the first pass |
| Bounded buffering; no silent unbounded growth | Hickey | Buffers *are* bounded and puts wait correctly (`p16`). But 1,100 waiting puts raised no error (limit 1,024), and only 12 of them were ever delivered (`p17`) | ⚠️ The bound is right; the overflow handling silently drops |
| Choice: exactly one alternative completes; others have no effect | Hoare (5); Hickey "one and only one" | **Measured:** with both arms ready, both values are consumed and one is lost (`p14`) | ❌ Violates the defining property of choice |
| Choice is fair, or at least random | Hoare 7.6; Go select; core.async default | Fixed order; the winner is the *last* finished event | ⚠️ |
| Output guards (puts in alts) | Hoare 7.8; Go; core.async | Supported (`[ch, val]` arms) | ✅ |
| Choice reports which channel won | core.async `alts!` → `[val port]` | Only the value is forwarded | ⚠️ Missing |
| A loop over input ends when its sources terminate | Hoare (6) and 7.9; Go `range`; core.async `go-loop` nil check | **Measured:** `loop` over a closed channel stalls silently (`p3`) | ❌ Neither terminates nor errors. Hoare's 7.9 warning applies directly |
| Timeouts are channels that close; shareable; per-iteration vs whole-conversation are both expressible | Pike; Hickey; core.async `timers.cljs` | `timeout` *puts* `true`; an untaken timeout stays open past its deadline (`p11`); inside `loop` it's evaluated once (`p4`) | ❌ Wrong mechanism (put vs close). The loop issue is really "the DSL can only express the whole-conversation timeout" |
| Only the sender closes; closing is a broadcast signal | Go blog; Go idiom | `close()` available to anyone; close wakes all parked takers | ✅ Consistent with Go |
| Communication is one-to-one (or all-party multiway sync) | Hoare 1985; Hoare 7.7 | **Broadcast to whoever is parked at the moment** | ⚠️ Not CSP: see §3 |
| Channels are first-class and can be sent (mobility) | Go FAQ; Effective Go "Channels of channels"; Pike | Channel values are **spliced** (ordered flatten), not delivered; request/reply needs a wrapper object; already-closed inner channel loses values (`p15`) | ⚠️ Bespoke. ❌ for the closed-inner bug |
| Value transformation lives on the channel | Hickey, transducers | Transducers on channels supported ✅, but `reduced` doesn't close and there's no completion step | ⚠️ |
| Values sent are not mutated afterwards | Hickey "value of values"; Effective Go "only one goroutine has access" | Plain JS objects (mutable) | ⚠️ Needs a stated convention (dev-mode `Object.freeze`, or "ownership passes with the value") |
| Edges bridge callbacks into channels with no logic in handlers | Hickey | `putAsync` / `takeAsync` | ✅ |
| Termination by communication, not by crashing | Hoare 7.6; Go `context.Done()` | `kill()` (unbound `this` bug aside) | ⚠️ Pragmatic for UI unmount, but not CSP. Rationale: kill exists for component unmount; within the network, processes stop by communication |

---

## 3. Broadcast, re-evaluated with the sources

The first pass called broadcast "a legitimate primitive elsewhere (Effection, RxJS, `BroadcastChannel`)". The CSP
sources sharpen that:

- **Hoare names this exact design and sets it aside.** §7.7 describes Kahn–MacQueen networks, where "the output of
  one process can be automatically fanned out to any number of processes … which can consume it at differing
  rates", and attributes it to the *functional* approach, as opposed to CSP's *imperative* one. So the owner's
  broadcast isn't an arbitrary deviation. It's the dataflow / Kahn-process-network design, grafted onto CSP
  channels.
- **CSP's own one-to-many is multiway synchronisation** (1985): an event shared by several processes happens only
  when **all** of them take part at the same moment. Membership is fixed (the alphabets), and the sender waits for
  the slowest.
- **This library's version** is neither. Membership is "whoever happens to be parked at the instant of the put",
  so the outcome depends on timing (`p1b`, `p13`).

**Two principled ways to keep broadcast, both easier to defend than the current one:**
1. **CSP multiway:** a broadcast channel with *registered* members, where a put completes only when every member
   has taken it. Deterministic, backpressure from the slowest member. Closest to Hoare.
2. **Kahn / `mult`:** each registered member gets its own buffer; the source never waits for a slow member beyond
   its buffer. Closest to core.async `mult` and core.async.flow's "every connection will get every message".

Either way, membership is explicit, and plain channels keep one-to-one CSP semantics.

---

## 4. The DSL discussion, re-evaluated (where the first pass drifted)

1. **`sink(fn)` per operation risks "logic in handlers".** One callback per `take` is exactly the fragmentation
   Hickey's talk is about. A process whose logic spans several channels (a gesture: down → moves → up) ends up
   split across several sinks that have to share mutable "place" state through closures. CSP's answer is
   **one sequential process with local state**: core.async's `go-loop` with `recur` bindings ("recursion vs
   mutation"), Go's for-select loop where "the cases interact via local state", and core.async.flow's
   `transform(state, input, msg) → [state', outputs]`.
   **Implication:** let state travel through the operations. A loop holds a state value, every handler receives it
   and returns the next one, and ending the loop is the handler choosing not to continue (the `recur` analogue).
   This replaces both `stop()` and `STOP` with the CSP idiom, keeps the handler a pure function (testable, like
   flow's step functions), and keeps a gesture's logic in one place.
2. **Operations returning channels: CSP-idiomatic.** Pike's "Generator: function that returns a channel" and
   core.async's `go` (which "immediately returns a channel") back this. The owner's instinct was right.
3. **`pipe` for value transformations: dropped (owner).** CSP and core.async put value transformation *on the
   channel* (transducers), not in a separate operator vocabulary. The owner reached the same conclusion
   independently.
4. **Naming the threading helper.** The owner wants something like Clojure's `->`/`->>` to flatten nested calls,
   renamed so it isn't confused with Ramda/RxJS `pipe`. Two separate ideas:
   - **Hoare's `>>` ("the chaining operator")** composes *processes*: `P >> Q` hides the channel between them,
     is associative and requires matching message types. That's a genuine CSP construct, and the strongest
     candidate for a **`chain`** that wires stages together.
   - **Syntactic threading** (`->`) flattens nesting. With operations as variadic arguments, nesting is shallow
     (`loop(alts(a, b, c))` is two levels), so check whether real examples need it before adding it. If they do,
     avoid the name `thread` (it reads as a concurrency term); `nest` or `wrap` are neutral.
5. **Timeouts:** following Go and Hickey, the DSL should be able to express *both* the whole-conversation timeout
   (a `timeout` channel created once and shared, closing at its deadline) and the per-iteration one (a `sleep`
   step, or a timeout created per iteration). What looked like a bug is that only the first could be expressed.
6. **Kill:** keep it (owner) for React unmount. Document that inside the network, processes end by communication
   (closing inputs, a `done` channel), as Hoare 7.6 and Go's `context` recommend.

---

## 5. New findings from this pass

| # | Finding | Evidence |
|---|---|---|
| C1 | Puts waiting on a full channel are delivered **LIFO**, and the **second put is always lost** (sequential takers, so broadcast isn't involved) | [`p17b.js`](probes/p17b.js): `[0, 9, 8, 7, 6, 5, 4, 3, 2, TIMEOUT]` |
| C2 | More than 64 waiting puts: most are silently lost (70 → 5 delivered; 1,100 → 12 delivered, plus 16 `null`/`undefined`); no error at the 1,024 limit | [`p17_pending.js`](probes/p17_pending.js), consistent with the `MAX_DIRTY` cleanup finding |
| C3 | No unbuffered (rendezvous) channels at all; default `fixed(1)` | Read: `channels.ts:177` |
| C4 | Buffers are correctly bounded; puts wait when full | [`p16_bounded.js`](probes/p16_bounded.js) |

## 6. Priority after this pass (for the owner to decide)

> Superseded by [`2026-10-roadmap.md`](2026-10-roadmap.md).

1. **FIFO and no lost puts (C1, C2)**, plus the earlier stranding and LIFO findings. A channel that reorders or
   drops breaks the first guarantee a channel makes.
2. **Choice: exactly one completes** (the alts double-consumption).
3. **Loops end when their inputs close** (Hoare's distributed termination).
4. **Timeouts close at their deadline.**
5. **Rendezvous channels** (`chan()` unbuffered), the defining CSP property. It's a bigger change to the queue
   logic; at minimum, document the deviation.
6. Broadcast as an explicit construct (§3); state threaded through loops (§4.1).

## 7. Sources (additional to the main doc)

- Hoare 1978 and Hoare 1985: `papers-we-love/papers-we-love`, `processes/communicating-sequential-processes-paper.pdf`
  and `processes/communicating-sequential-processes.pdf`
- `golang/website`: `_content/doc/effective_go.html`, `_content/doc/faq.md`, `_content/talks/2012/concurrency.slide`,
  `_content/talks/2012/waza.slide`, `_content/talks/2013/advconc.slide`, `_content/blog/pipelines.md`,
  `_content/blog/context.md`
- `matthiasn/talk-transcripts`: `Hickey_Rich/CoreAsync-mostly-text.md`, `Hickey_Rich/Transducers-mostly-text.md`
- `clojure/core.async`: `doc/rationale.md`, `doc/flow.md`, `doc/flow-guide.md`, `src/main/clojure/cljs/core/async/**`
