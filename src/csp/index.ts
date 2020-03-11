import { IStream as IStreamInternal } from './impl/constants';
import { IChan as IntChan, IChanValue as IntChanV } from './impl/channels';
import { IAltsArgs as IAA } from './impl/go';
export { chan } from './impl/channels';
export { putAsync, takeAsync } from './impl/processEvents';
export { go, timeout } from './impl/go';
export { dropping, fixed, sliding } from './impl/buffers';

export type IStream = IStreamInternal;
export type IChan<T extends IStream = IStream, S extends IStream = T> = IntChan<T, S>;
export type IChanValue<T extends IStream> = IntChanV<T>;
export type IAltsArgs<T extends IStream = IStream, S extends IStream = T> = IAA<T, S>;
