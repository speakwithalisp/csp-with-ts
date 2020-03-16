import { IChanValue, Instruction } from './interfaces';
import { IStream, InstrTypes, MAX_QUEUE_SIZE } from './constants';
function acopy<T extends IStream>(
    src: Array<IChanValue<T> | undefined> | Array<Instruction<T, InstrTypes> | undefined>,
    srcStart: number,
    dest: Array<IChanValue<T> | undefined> | Array<Instruction<T, InstrTypes> | undefined>,
    destStart: number,
    len: number
): void {
    for (let count = 0; count < len; count += 1) {
        dest[destStart + count] = src[srcStart + count];
    }
}

export class RingBuffer<T extends IStream, S extends IStream = T, Q extends IChanValue<T> | Instruction<T, InstrTypes, S> = IChanValue<T>> implements Iterable<Q> {
    head: number;
    tail: number;
    length: number;
    arr: Array<Q | undefined>;

    constructor(head: number, tail: number, length: number, arr: Array<Q>) {
        this.head = head;
        this.tail = tail;
        this.length = length;
        this.arr = arr;
    }

    *[Symbol.iterator]() {
        if (this.length !== 0 || this.tail !== this.head) {
            let i: number = this.head - 1;
            if (this.tail < this.head) {
                for (; i >= 0; i -= 1) {
                    if (this.arr[i] !== undefined) {
                        yield this.arr[i]!;
                    }
                }
            }
            else if (this.tail > this.head) {
                for (; i >= 0; i -= 1) {
                    if (this.arr[i] !== undefined) {
                        yield this.arr[i]!;
                    }
                }
                for (i = this.length - 1; i >= this.tail; i -= 1) {
                    if (this.arr[i] !== undefined) {
                        yield this.arr[i]!;
                    }
                }
            }
        }
    }

    pop(): Q | undefined {
        if (this.length !== 0) {
            const elem = this.arr[this.tail];
            this.arr[this.tail] = undefined;
            this.tail = (this.tail + 1) % this.arr.length;
            this.length -= 1;
            return elem;
        }
        return undefined;
    }

    last(): Q | undefined {
        if (this.length !== 0) {
            return this.arr[this.tail];
        }
        return undefined;
    }
    unshift(element: Q | undefined): void {
        this.arr[this.head] = element;
        this.head = (this.head + 1) % this.arr.length;
        this.length += 1;
    }
    unboundedUnshift(element: Q | undefined): void {
        if (this.length >= MAX_QUEUE_SIZE) {
            throw new Error(
                `No more than ${MAX_QUEUE_SIZE} pending puts are allowed on a single channel.`
            );
        }
        if (this.length + 1 === this.arr.length) {
            this.resize();
        }
        this.unshift(element);
    }

    resize(down?: boolean): void {
        const newArrSize = down ? this.length + 1 : this.arr.length * 2;
        const newArr = new Array(newArrSize);

        if (this.tail < this.head) {
            acopy(this.arr, this.tail, newArr, 0, this.length);
            this.tail = 0;
            this.head = this.length;
            this.arr = newArr;
        } else if (this.tail > this.head) {
            acopy(this.arr, this.tail, newArr, 0, this.arr.length - this.tail);
            acopy(this.arr, 0, newArr, this.arr.length - this.tail, this.head);
            this.tail = 0;
            this.head = this.length;
            this.arr = newArr;
        } else if (this.tail === this.head) {
            this.tail = 0;
            this.head = 0;
            this.arr = newArr;
        }
    }

    cleanup(predicate: Function): void {
        const len: number = this.length;
        let i: number = this.length - 1;
        for (; i >= 0; i -= 1) {
            const value = this.pop();
            if (predicate(value, i)) {
                this.unshift(value);
            }
        }
        if (this.length < len) { this.resize(true); }
    }
}

export function ring<T extends IStream, S extends IStream = T, Q extends IChanValue<T> | Instruction<T, InstrTypes, S> = IChanValue<T>>(n: number): RingBuffer<T, S, Q> {
    if (n <= 0) {
        throw new Error("Can't create a ring buffer of size 0");
    }

    return new RingBuffer<T, S, Q>(0, 0, 0, new Array(n));
}

/**
 * Returns a buffer that is considered "full" when it reaches size n,
 * but still accepts additional items, effectively allow overflowing.
 * The overflowing behavior is useful for supporting "expanding"
 * transducers, where we want to check if a buffer is full before
 * running the transduced step function, while still allowing a
 * transduced step to expand into multiple "essence" steps.
 */
export class FixedBuffer<T extends IStream> implements Iterable<IChanValue<T>> {
    buffer: RingBuffer<T>;
    n: number;

    constructor(buffer: RingBuffer<T>, n: number) {
        this.buffer = buffer;
        this.n = n;
    }

    *[Symbol.iterator]() { yield* this.buffer; }

    isFull(): boolean {
        return this.buffer.length === this.n;
    }

    remove(): IChanValue<T> | undefined {
        return this.buffer.pop();
    }

    last(): IChanValue<T> | undefined {
        return this.buffer.last();
    }

    add(item: IChanValue<T> | undefined): void {
        this.buffer.unboundedUnshift(item);
    }

    closeBuffer(): void { }

    count(): number {
        return this.buffer.length;
    }
}

export function fixed<T extends IStream>(n: number): FixedBuffer<T> {
    return new FixedBuffer<T>(ring<T>(n), n);
}

export class DroppingBuffer<T extends IStream> implements Iterable<IChanValue<T>> {
    buffer: RingBuffer<T>;
    n: number;

    constructor(buffer: RingBuffer<T>, n: number) {
        this.buffer = buffer;
        this.n = n;
    }

    *[Symbol.iterator]() { yield* this.buffer; }

    isFull(): boolean {
        return false;
    }

    remove(): IChanValue<T> | undefined {
        return this.buffer.pop();
    }

    last(): IChanValue<T> | undefined {
        return this.buffer.last();
    }
    add(item: IChanValue<T> | undefined): void {
        if (this.buffer.length !== this.n) {
            this.buffer.unshift(item);
        }
    }

    closeBuffer(): void { }

    count(): number {
        return this.buffer.length;
    }
}

export function dropping<T extends IStream>(n: number): DroppingBuffer<T> {
    return new DroppingBuffer<T>(ring<T>(n), n);
}

export class SlidingBuffer<T extends IStream> implements Iterable<IChanValue<T>> {
    buffer: RingBuffer<T>;
    n: number;

    constructor(buffer: RingBuffer<T>, n: number) {
        this.buffer = buffer;
        this.n = n;
    }

    *[Symbol.iterator]() { yield* this.buffer; }

    isFull(): boolean {
        return false;
    }

    remove(): IChanValue<T> | undefined {
        return this.buffer.pop();
    }

    add(item: IChanValue<T>): void {
        if (this.buffer.length === this.n) {
            this.remove();
        }
        this.buffer.unshift(item);
    }

    last(): IChanValue<T> | undefined {
        return this.buffer.last();
    }
    closeBuffer(): void { }

    count(): number {
        return this.buffer.length;
    }
}

export function sliding<T extends IStream>(n: number): SlidingBuffer<T> {
    return new SlidingBuffer<T>(ring<T>(n), n);
}

// class PromiseBuffer<T extends IStream>  {
//     value: Promise<IChanValue<T>> | undefined | null;

//     static NO_VALUE = undefined;
//     static isUndelivered = (value: any): boolean => PromiseBuffer.NO_VALUE === value;

//     constructor(value?: Promise<IChanValue<T>>) {
//         this.value = value;
//     }

//     isFull(): boolean {
//         return false;
//     }

//     remove(): Promise<IChanValue<T>> | undefined | null {
//         return this.value;
//     }

//     add(item: Promise<IChanValue<T>>): void {
//         if (PromiseBuffer.isUndelivered(this.value)) {
//             this.value = item;
//         }
//     }

//     last(): Promise<IChanValue<T>> | null {
//         if (PromiseBuffer.isUndelivered(this.value)) { return CLOSED; }
//         return this.value === undefined ? CLOSED : this.value;
//     }
//     closeBuffer(): void {
//         if (PromiseBuffer.isUndelivered(this.value)) {
//             this.value = null;
//         }
//     }

//     count(): number {
//         return PromiseBuffer.isUndelivered(this.value) ? 0 : 1;
//     }
// }

// function promise<T extends IStream>(): PromiseBuffer<T> {
//     return new PromiseBuffer<T>();
// }

export declare type BufferType<T extends IStream> =
    FixedBuffer<T>
    | DroppingBuffer<T>
    | SlidingBuffer<T>;
// | PromiseBuffer<T, Q>;
