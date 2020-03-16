// Type definitions for csp.
// Project: csp
// Definitions by: Shounak Bhattacharya <https://github.com/speakwithalisp>
import { IStream as IStreamInternal } from './impl/constants';
import { BufferType as BT, DroppingBuffer, SlidingBuffer, FixedBuffer } from './impl/buffers';
import { IChan as IntChan, IChanValue as IntChanV, IAltsArgs as IAA, IGoordinator } from './impl/interfaces';
import { ITransducer as IT, Reduced as R, IXForm as IX } from './impl/utils';

export type BufferType<T extends IStream> = BT<T>;
export type ITransducer<A = any, B = any, C = any> = IT<A, B, C>;
export type IXForm<A = any, B = any> = IX<A, B>;
export type Reduced<A = any> = R<A>;
export type IStream = IStreamInternal;
export type IChan<T extends IStream = IStream, S extends IStream = T> = IntChan<T, S>;
export type IChanValue<T extends IStream> = IntChanV<T>;
export type IAltsArgs<T extends IStream = IStream, S extends IStream = T> = IAA<T, S>;
export type IGoArgs<T extends IStream, S extends IStream = T> = IChan<T, S> | (() => Generator<any, any, any>) | IAltsArgs<T, S>[] | (() => boolean) | ((val: IChanValue<T>) => any);

export function chan<T extends IStream, Q extends IStream = T>(buf?: number | BufferType<Q> | BufferType<T>, xform?: ITransducer<IChanValue<T>, IChanValue<Q>, BufferType<Q>>, exHandler?: Function): IChan<T> | IChan<T, Q>;

export function isChan<T extends IStream, Q extends IStream = T>(obj: any): obj is IChan<T, Q>;
export function CSP(): IGoordinator;
export function dropping<T extends IStream = IStream>(n: number): DroppingBuffer<T>;
export function sliding<T extends IStream = IStream>(n: number): SlidingBuffer<T>;
export function fixed<T extends IStream = IStream>(n: number): FixedBuffer<T>;
export function putAsync<T extends IStream = IStream, S extends IStream = T>(ch: IChan<T, S>, val: T, close?: boolean, cb?: () => any | void): void;
export function takeAsync<T extends IStream, S extends IStream = T>(ch: IChan<T, S>): Promise<IChanValue<S>>;
export function go<T extends IStream = IStream, S extends IStream = IStream>(strings: TemplateStringsArray, ...args: IGoArgs<T, S>[]): () => void;
export function timeout(msec: number): IChan<boolean>;
