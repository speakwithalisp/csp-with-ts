// Type definitions for csp.
// Project: csp
// Definitions by: Shounak Bhattacharya <https://github.com/speakwithalisp>
import { IStream } from './impl/constants';
import { BufferType, DroppingBuffer, SlidingBuffer, FixedBuffer } from './impl/buffers';
import { IChan, IChanValue, IAltsArgs, IGoordinator } from './impl/interfaces';
import { ITransducer, Reduced } from './impl/utils';

declare type IGoArgs<T extends IStream, S extends IStream = T> = IChan<T, S> | (() => Generator<any, any, any>) | IAltsArgs<T, S>[] | (() => boolean) | ((val: IChanValue<T>) => any);


declare function isReduced<A = any>(val: any): val is Reduced<A>;
declare function chan<T extends IStream, Q extends IStream = T>(buf?: number | BufferType<Q> | BufferType<T>, xform?: ITransducer<IChanValue<T>, IChanValue<Q>, BufferType<Q>>, exHandler?: Function): IChan<T> | IChan<T, Q>;
declare function isChan<T extends IStream, Q extends IStream = T>(obj: any): obj is IChan<T, Q>;
declare function CSP(): IGoordinator;
declare function dropping<T extends IStream = IStream>(n: number): DroppingBuffer<T>;
declare function sliding<T extends IStream = IStream>(n: number): SlidingBuffer<T>;
declare function fixed<T extends IStream = IStream>(n: number): FixedBuffer<T>;
declare function putAsync<T extends IStream = IStream, S extends IStream = T>(ch: IChan<T, S>, val: T, close?: boolean, cb?: () => any | void): void;
declare function takeAsync<T extends IStream, S extends IStream = T>(ch: IChan<T, S>): Promise<IChanValue<S>>;
declare function go<T extends IStream = IStream, S extends IStream = IStream>(strings: TemplateStringsArray, ...args: IGoArgs<T, S>[]): () => void;
declare function timeout(msec: number): IChan<boolean>;
