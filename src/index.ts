import { IStream as IStreamInternal } from './impl/constants';
import { BufferType as BT, DroppingBuffer as DB, SlidingBuffer as SB, FixedBuffer as FB } from './impl/buffers';
import { IChan as IntChan, IChanValue as IntChanV, IAltsArgs as IAA, IGoordinator } from './impl/interfaces';
import { CSP as csp } from './impl/service';
import { register } from './impl/process';
import { ITransducer as IT, Reduced as R, IXForm as IX } from './impl/utils';


export declare type BufferType<T extends IStream> = BT<T>;
export declare type FixedBuffer<T extends IStream> = FB<T>;
export declare type SlidingBuffer<T extends IStream> = SB<T>;
export declare type DroppingBuffer<T extends IStream> = DB<T>;
export declare type ITransducer<A = any, B = any, C = any> = IT<A, B, C>;
export declare type IXForm<A = any, B = any> = IX<A, B>;
export declare type Reduced<A = any> = R<A>;
export declare type IStream = IStreamInternal;
export declare type IChan<T extends IStream = IStream, S extends IStream = T> = IntChan<T, S>;
export declare type IChanValue<T extends IStream> = IntChanV<T>;
export declare type IAltsArgs<T extends IStream = IStream, S extends IStream = T> = IAA<T, S>;
export declare type IGoArgs<T extends IStream, S extends IStream = T> = IChan<T, S> | (() => Generator<any, any, any>) | IAltsArgs<T, S>[] | (() => boolean) | ((val: IChanValue<T>) => any);

export { isReduced } from './impl/utils';
export { dropping, fixed, sliding } from './impl/buffers';
export { chan, isChan } from './impl/channels';
export { putAsync, takeAsync } from './impl/processEvents';
export { go, timeout } from './impl/go';
export function CSP(): IGoordinator { return csp(register); }
