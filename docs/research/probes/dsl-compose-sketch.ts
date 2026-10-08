// TYPE-LEVEL SKETCH ONLY — names are placeholders
interface Chan<In, Out = In> { readonly __in?: (x: In) => void; readonly __out?: () => Out }
declare function chan<T>(): Chan<T>;
declare function chan<A, B>(buf: number, xf: (x: A) => B): Chan<A, B>;

// ── 1. value level: steps (core.async.flow "step-fn" / transducer) ──────────
declare const SKIP: unique symbol; declare const STOP: unique symbol;
type Ctl = { readonly i: number; stop(): void };
type Step<A, B> = (a: A, ctl: Ctl) => B | typeof SKIP | typeof STOP;
declare function step<A, B>(f: Step<A, B>): Step<A, B>;
declare function comp<A, B, C>(f: Step<A, B>, g: Step<B, C>): Step<A, C>;
declare function comp<A, B, C, D>(f: Step<A, B>, g: Step<B, C>, h: Step<C, D>): Step<A, D>;

// ── 2. operation level: Op<R> is an immutable description; R = value it produces ──
interface Op<R> {
  map<S>(f: Step<R, S>): Op<S>;          // transform the result
  then<S>(f: (r: R) => Op<S>): Op<S>;    // dependent next op (e.g. reply on a channel carried in the value)
  into(ch: Chan<R, any>): Op<boolean>;   // put the result
  each(f: (r: R, ctl: Ctl) => void): Op<void>; // = convert(fn): terminal sink
}
declare function take<T>(ch: Chan<any, T>): Op<T>;            // ends the enclosing loop when ch closes
declare function put<T>(ch: Chan<T, any>, v: T): Op<boolean>;
declare function sleep(ms: number): Op<void>;                 // armed when reached → re-armed every iteration
declare function alts<A, B>(a: Op<A>, b: Op<B>): Op<A | B>;
declare function seq(...ops: Op<unknown>[]): Op<void>;
declare function loop(...ops: Op<unknown>[]): Op<void>;
declare function spawn(op: Op<unknown>): Op<void>;            // fork a child, killed with the parent

// ── 3. process level: stages (Go pipeline stage / flow process), wired with chain ──
type Stage<A, B> = (inp: Chan<any, A>, out: Chan<B, any>) => Op<void>;
declare function chain<A, B, C>(s1: Stage<A, B>, s2: Stage<B, C>): Stage<A, C>;
declare function fanOut<A, B>(n: number, s: Stage<A, B>): Stage<A, B>;
interface Proc { kill(): void; readonly done: Chan<never, never> }
declare function go(op: Op<unknown>): Proc;

// ── usage ───────────────────────────────────────────────────────────────────
type Point = { x: number; y: number };
const toPoint = step((e: MouseEvent) => ({ x: e.clientX, y: e.clientY }));
const inBox = step((p: Point) => (p.x < 300 ? p : SKIP));
const untilUp = step((e: MouseEvent, ctl) => (e.type === 'mouseup' ? STOP : e));

// reusable behaviour = a value; each go() instantiates fresh state
const dragging: Stage<MouseEvent, Point> = (inp, out) => loop(take(inp).map(comp(untilUp, toPoint, inBox)).into(out));
const throttle = <T>(ms: number): Stage<T, T> => (inp, out) => loop(take(inp).into(out), sleep(ms));

const mouse = chan<MouseEvent>(), points = chan<Point>(), points2 = chan<Point>();
const pipeline = chain(dragging, throttle<Point>(16));
const a = go(pipeline(mouse, points));      // same recipe…
const b = go(pipeline(mouse, points2));     // …second independent instance

go(loop(alts(take(points), sleep(200).map(() => null)).each(p => { /* render or reset */ })));

// request/reply via .then (channel carried in the value)
type Req = { q: string; reply: Chan<number> };
const reqs = chan<Req>();
go(loop(take(reqs).then(r => put(r.reply, r.q.length))));

// ── mistakes the compiler must catch ───────────────────────────────────────
const keys = chan<KeyboardEvent>();
const bad1 = go(loop(take(keys).into(points)));                                          // KeyboardEvent into Point chan
const bad2 = chain(dragging, throttle<string>(16));                                     // Point → string stage
go(loop(take(reqs).then(r => put(r.reply, r.q))));                                      // string into number reply
