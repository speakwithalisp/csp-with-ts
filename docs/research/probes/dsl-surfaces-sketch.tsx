// TYPE-ONLY sketches of alternative DSL surfaces. Each ends with deliberate mistakes.
interface Chan<In, Out = In> { readonly __in?: (x: In) => void; readonly __out?: () => Out }
declare function chan<T>(): Chan<T>;
interface Op<R> { readonly __r?: R }
declare function take<T>(ch: Chan<any, T>): Op<T>;
declare function sleep(ms: number): Op<void>;
declare function go(...ops: Op<unknown>[]): void;
type Point = { x: number; y: number };
const mouse = chan<MouseEvent>(), points = chan<Point>(), names = chan<string>();
const toPoint = (e: MouseEvent): Point => ({ x: e.clientX, y: e.clientY });

// ── A. pipe-first (ramda / fp-ts / Effect style): operators are free functions ──
declare function pipe<A, B>(a: A, f: (a: A) => B): B;
declare function pipe<A, B, C>(a: A, f: (a: A) => B, g: (b: B) => C): B extends never ? never : C;
declare function pipe<A, B, C, D>(a: A, f: (a: A) => B, g: (b: B) => C, h: (c: C) => D): D;
declare function map<A, B>(f: (a: A) => B): (op: Op<A>) => Op<B>;
declare function into<A>(ch: Chan<A, any>): (op: Op<A>) => Op<boolean>;
go(pipe(take(mouse), map(toPoint), into(points)));
go(pipe(take(mouse), map(toPoint), into(names)));                    // ✗ Point into string chan

// ── B. the template kept, but every interpolation is a self-typed Op ──
declare function goT(strings: TemplateStringsArray, ...ops: Op<unknown>[]): void;
declare function each<T>(op: Op<T>, f: (v: T) => void): Op<void>;
goT`${sleep(500)}; ${each(take(mouse), e => e.clientX)}`;
goT`${each(take(names), (e: MouseEvent) => e.clientX)}`;              // ✗ MouseEvent sink on string chan

// ── C. s-expressions as data (Lisp-flavoured, serialisable) ──
type Form = readonly ['<!', Chan<any, any>, ((v: any) => void)?] | readonly ['sleep', number] | readonly ['do', ...Form[]];
type TakeForm<T> = readonly ['<!', Chan<any, T>, ((v: T) => void)?];
declare function sx<T>(f: TakeForm<T>): TakeForm<T>;
declare function goS(...forms: Form[]): void;
goS(['sleep', 500], sx(['<!', mouse, e => e.clientX]));
goS(sx(['<!', names, (e: MouseEvent) => e.clientX]));                // ✗ (only with the sx() helper)
goS(['<!', names, (e: MouseEvent) => e.clientX]);                    //   NOT caught: raw tuples erase T

// ── D. JSX with a custom factory (no React): behaviours are components ──
declare namespace JSX { type Element = Op<unknown>; interface ElementChildrenAttribute { children: {} } }
declare function h(tag: any, props: any, ...children: any[]): Op<unknown>;
declare function Take<T>(p: { from: Chan<any, T>; each: (v: T) => void }): Op<void>;
declare function Sleep(p: { ms: number }): Op<void>;
declare function Loop(p: { children: Op<unknown> | Op<unknown>[] }): Op<void>;
const Drag = ({ out }: { out: Chan<Point> }) => <Loop><Sleep ms={16} /><Take from={mouse} each={e => toPoint(e)} /></Loop>;
go(<Drag out={points} />);
go(<Take from={names} each={(e: MouseEvent) => e.clientX} />);       // ✗ MouseEvent handler on string chan

// ── E. statechart (gesture-shaped): states → transitions on channel events ──
type On<S extends string> = <T>(op: Op<T>, next: (v: T) => S) => readonly [Op<T>, (v: T) => S];
declare function states<const S extends readonly string[]>(...names: S): {
  machine(initial: S[number], def: (on: On<S[number]>) => Record<S[number], ReadonlyArray<readonly [Op<any>, (v: any) => S[number]]>>): Op<void>;
};
go(states('idle', 'dragging').machine('idle', on => ({
  idle: [on(take(mouse), e => (e.type === 'mousedown' ? 'dragging' : 'idle'))],
  dragging: [on(take(mouse), e => (e.type === 'mouseup' ? 'idle' : 'dragging')), on(sleep(5000), () => 'idle')],
})));
go(states('idle', 'dragging').machine('idle', on => ({ idle: [on(take(mouse), () => 'dragin')], dragging: [] })));   // ✗ unknown state name
