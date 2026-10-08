// TYPE-ONLY: dynamic choice in the owner's style (closures + effects; no state-threading vocabulary).
// Two additions only: guard(cond, op) = Hoare's guarded alternative / Go's nil-channel case;
// alts(() => arms) = arms recomputed every time the loop reaches the alts (Go: "All channels are evaluated" each select).
interface Chan<In, Out = In> { readonly __in?: (x: In) => void; readonly __out?: () => Out }
declare function chan<T>(n?: number): Chan<T>;
interface Op { readonly __op: true }
interface Sink<T> { readonly __sink?: (v: T) => void }
interface Source<T> { readonly __src?: () => T }
type Kill = () => void;
declare function sink<T>(fn: (value: T, done: () => void) => void): Sink<T>;
declare function source<T>(fn: (done: () => void) => T): Source<T>;
declare function take<T>(ch: Chan<any, T>): Op;
declare function take<T>(ch: Chan<any, T>, s: Sink<T>): Op;
declare function put<T>(ch: Chan<T, any>, s: Source<T>): Op;
declare function timeout(ms: number): Chan<void, never>;
declare function go(...ops: Op[]): Kill;
declare function loop(...ops: Op[]): Kill;
declare function alts(...arms: Op[]): Op;
declare function alts(arms: () => Op[]): Op;                       // NEW: re-evaluated each time it's reached
declare function guard(cond: () => boolean, op: Op): Op;            // NEW: arm takes part only while cond() is true
declare function putAsync<T>(ch: Chan<T, any>, v: T): void;

// 1. Debounce: the timer arm exists only while a value is pending, and is replaced on every keystroke.
function debounce<T>(input: Chan<any, T>, out: Chan<T, any>, ms: number): Kill {
  let pending: T | undefined; let timer: Chan<void, never> | undefined;
  return loop(alts(() => [
    take(input, sink(v => { pending = v; timer = timeout(ms); })),
    ...(timer ? [take(timer, sink((_v, done) => { putAsync(out, pending!); timer = undefined; done(); }))] : []),
  ]));
}

// 2. Latest-wins typeahead (switch-latest): each query gets its own reply channel; only the newest is listened to,
//    so a stale response can't be delivered: it is simply no longer in the alts set.
type Results = string[];
declare function search(q: string): Chan<Results>;                 // a "generator: function that returns a channel"
function typeahead(queries: Chan<string>, render: (r: Results) => void): Kill {
  let current: Chan<Results> | undefined;
  return loop(alts(() => [
    take(queries, sink(q => { current = search(q); })),
    ...(current ? [take(current, sink((r, done) => { render(r); current = undefined; done(); }))] : []),
  ]));
}

// 3. Dynamic fan-in: sources join at runtime over a control channel (channels as values); closed sources drop out.
function fanIn<T>(control: Chan<Chan<T>>, out: Chan<T, any>): Kill {
  const sources = new Set<Chan<T>>();
  return loop(alts(() => [
    take(control, sink(ch => { sources.add(ch); })),
    ...[...sources].map(s => take(s, sink(v => putAsync(out, v)))),   // closed arm → removed (Phase 3 rule)
  ]));
}

// 4. Bounded pending queue (Ajmani's loop): fetch only while below the limit, send only while non-empty.
function boundedRelay<T>(input: Chan<T>, out: Chan<T, any>, max: number): Kill {
  const pending: T[] = [];
  return loop(alts(
    guard(() => pending.length < max, take(input, sink(v => { pending.push(v); }))),
    guard(() => pending.length > 0, put(out, source(() => pending.shift()!))),
  ));
}

// 5. Gesture: which arms exist depends on the phase (each phase = a set of guarded arms).
function drag(down: Chan<MouseEvent>, move: Chan<MouseEvent>, up: Chan<MouseEvent>, setPos: (x: number) => void): Kill {
  let dragging = false;
  return loop(alts(
    guard(() => !dragging, take(down, sink(() => { dragging = true; }))),
    guard(() => dragging, take(move, sink(e => setPos(e.clientX)))),
    guard(() => dragging, take(up, sink(() => { dragging = false; }))),
  ));
}

// ✗ mistakes
const nums = chan<number>();
loop(alts(() => [take(nums, sink((s: string) => {}))]));
guard(() => 'yes', take(nums));
