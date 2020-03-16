import { BufferType, fixed } from './buffers';
import { IChan, IChanValue } from './interfaces';
import { IStream, CLOSED } from './constants';
import { CSP } from './service';
import { IXForm, isReduced, ITransducer } from './utils';
import { queueFlushChannel } from './scheduler';
//
//          IMPORTANT
//     ,----
//     | change all instances of setTimeout (except sleep)
//     | to setImmediate.
//     | Let Babel handle browser support
//     | checking
//     `----


class NoXChannel<T extends IStream> implements IChan<T> {
    buffer: BufferType<T>;
    altFlag: boolean;
    private _closed: boolean;
    private _lastVal: IChanValue<T>;

    constructor(buf: BufferType<T>) {
        this.buffer = buf;
        this._closed = false;
        this._lastVal = CLOSED;
        this.altFlag = false;
    }
    get hasXForm() { return false; }
    count() {
        return this.buffer.count();
    }
    isFull() { return this.buffer.isFull(); }
    close() {
        if (!this._closed) {
            this._closed = true;
            if (CSP().has(this)) {
                setImmediate(queueFlushChannel, this);
            }
        }
    }
    get closed() { return this._closed; }

    add(val: IChanValue<T>) {
        this.buffer.add(val as IChanValue<T>);
    }
    remove() {
        const ret: IChanValue<T> | undefined = this.buffer.remove();
        if (!this.buffer.count() && ret !== undefined) { this._lastVal = ret; }
        if (this._closed && !this.buffer.count() && !this.altFlag) { return CLOSED; }
        return ret === undefined ? CLOSED as IChanValue<T> : ret;
    }
    last() {
        if (this.buffer.last() !== undefined) { return this.buffer.last()!; }
        else if (!this.count() && (this._lastVal !== null) && this._closed && this.altFlag) {
            // if (alt && isClosed && isChan(lastVal)) { return lastVal.last(); }
            return this._lastVal;
        }
        return CLOSED as IChanValue<T>;
    }
}


// function to add the given xform to the side-effecty one where the buffer is mutated.
function addTransformer<T extends IStream, S extends IStream>(transducer: ITransducer<IChanValue<T>, IChanValue<S>, BufferType<S>>): IXForm<BufferType<S>, IChanValue<T>> {
    // The base transformer object to use with transducers
    const baseTransformer: IXForm<BufferType<S>, IChanValue<S>> = {
        '@@transducer/init': () => {
            throw new Error('init not available');
        },

        '@@transducer/result': (v: BufferType<S>) => v,

        '@@transducer/step': (buffer: BufferType<S>, input: IChanValue<S>) => {
            buffer.add(input);
            return buffer;
        },
    }
    return transducer(baseTransformer);
};

function defaultExceptionHandler(err: Error): typeof CLOSED {
    console.log('error in channel transformer', err.stack); // eslint-disable-line
    return CLOSED;
}

function handleEx<T extends IStream>(
    buf: BufferType<T>,
    e: Error,
    exHandler?: Function,
): BufferType<T> {
    const def = (exHandler || defaultExceptionHandler)(e);

    if (def !== CLOSED) {
        buf.add(def);
    }

    return buf;
}

function handleException<T extends IStream, S extends IStream>(exHandler?: Function): ITransducer<IChanValue<T>, IChanValue<T>, BufferType<S>> {
    return (xform: IXForm<BufferType<S>, IChanValue<T>>): IXForm<BufferType<S>, IChanValue<T>> => (
        {
            '@@transducer/init': xform['@@transducer/init'],
            '@@transducer/step': (buffer: BufferType<S>, input: IChanValue<T>) => {
                try {
                    return xform['@@transducer/step'](buffer, input);
                } catch (e) {
                    return handleEx(buffer, e, exHandler);
                }
            },
            '@@transducer/result': (buffer: BufferType<S>) => {
                try {
                    return xform['@@transducer/result'](buffer);
                } catch (e) {
                    return handleEx(buffer, e, exHandler);
                }
            },
        });
}

class XChannel<T extends IStream, Q extends IStream = T> implements IChan<T, Q> {
    buffer: BufferType<Q>;
    altFlag: boolean;
    private xform: IXForm<BufferType<Q>, IChanValue<T>>;
    private _closed: boolean;
    private _lastVal: IChanValue<Q>;

    constructor(buf: BufferType<Q>, xform: IXForm<BufferType<Q>, IChanValue<T>>) {
        this.buffer = buf;
        this.xform = xform;
        this._closed = false;
        this._lastVal = CLOSED;
        this.altFlag = false;
    }
    get hasXForm() { return true; }
    isFull() { return this.buffer.isFull(); }
    count() {
        return this.buffer.count();
    }
    close() {
        if (!this._closed) {
            this._closed = true;
            if (CSP().has(this)) {
                setImmediate(queueFlushChannel, this);
            }
        }
    }
    get closed() { return this._closed; }

    add(val: IChanValue<T>) {
        const closed: boolean = isReduced(this.xform['@@transducer/step'](this.buffer, val));
        if (isReduced(closed)) { this.close(); }
    }
    remove() {
        const ret: IChanValue<Q> | undefined = this.buffer.remove() as IChanValue<Q>;
        if (!this.buffer.count() && ret !== undefined) { this._lastVal = ret; }
        if (this._closed && !this.buffer.count() && !this.altFlag) { return CLOSED; }
        return ret === undefined ? CLOSED as IChanValue<Q> : ret;
    }
    last() {
        if (this.buffer.last() !== undefined) { return this.buffer.last()!; }
        else if (!this.count() && (this._lastVal !== null) && this._closed && this.altFlag) {
            // if (alt && isClosed && isChan(lastVal)) { return lastVal.last(); }
            return this._lastVal;
        }
        return CLOSED as IChanValue<Q>;
    }
}

export function chan<T extends IStream, Q extends IStream = T>(buf?: number | BufferType<Q> | BufferType<T>, xform?: ITransducer<IChanValue<T>, IChanValue<Q>, BufferType<Q>>, exHandler?: Function): IChan<T> | IChan<T, Q> {
    if (xform === undefined) {
        const buffer = buf === undefined ? fixed<T>(1) : typeof buf === 'number' && buf > 0 ? fixed<T>(buf) : buf as BufferType<T>;
        return new NoXChannel<T>(buffer);
    }
    const newXForm: IXForm<BufferType<Q>, IChanValue<T>> = addTransformer(xform);
    const buffer = buf === undefined ? fixed<Q>(1) : typeof buf === 'number' && buf > 0 ? fixed<Q>(buf) : buf as BufferType<Q>;
    return new XChannel<T, Q>(buffer, handleException<T, Q>(exHandler)(newXForm)) as IChan<T, Q>;
}

export function isChan<T extends IStream, Q extends IStream = T>(obj: any): obj is IChan<T, Q> {
    if (obj instanceof XChannel) { return true; }
    else if (obj instanceof NoXChannel) { return true; }
    return false;
}
