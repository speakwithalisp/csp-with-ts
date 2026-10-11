// Type tests for src/dsl/types.ts. Valid usage must compile; every `@ts-expect-error` line must fail to compile.
import { IChan } from '../../src/impl/interfaces';
import { GoFn, LoopFn, PutFn, SinkFn, SourceFn, TakeFn } from '../../src/dsl/types';

declare const go: GoFn, loop: LoopFn, take: TakeFn, put: PutFn, sink: SinkFn, source: SourceFn;
declare const strings: IChan<string>, numbers: IChan<number>, ready: IChan<boolean>;
declare const points: IChan<MouseEvent, { x: number; y: number }>;   // transducer channel: put MouseEvent, take point
declare function setState(n: number): void;

// value types are inferred from the channel
const kill: () => void = go(take(strings, sink((v, done) => { if (v === 'stop') done(); else setState(v.length); })));
kill();
go(take(ready), put(numbers, source(() => 42)));                                   // bare take, then a put
loop(take(points, sink(p => setState(p.x + p.y))));                                // take side of a transducer channel
go(put(points, source((done): MouseEvent => { done(); return new MouseEvent('move'); })));  // put side

// @ts-expect-error a number sink on a string channel
go(take(strings, sink((v: number) => setState(v))));
// @ts-expect-error a string source into a number channel
go(put(numbers, source(() => 'x')));
// @ts-expect-error the put side of a transducer channel takes the input type, not the output type
go(put(points, source(() => ({ x: 1, y: 2 }))));
// @ts-expect-error go takes operations, not channels
go(strings);
