import { IChanValue, Instruction, IStream, InstrTypes } from './channels';
const MAX_QUEUE_SIZE = 1024;
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

export class RingBuffer<T extends IStream, Q extends IChanValue<T> | Instruction<T, InstrTypes> = IChanValue<T>> implements Iterable<Q> {
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

export function ring<T extends IStream, Q extends IChanValue<T> | Instruction<T, InstrTypes> = IChanValue<T>>(n: number): RingBuffer<T, Q> {
    if (n <= 0) {
        throw new Error("Can't create a ring buffer of size 0");
    }

    return new RingBuffer<T, Q>(0, 0, 0, new Array(n));
}

/**
 * Returns a buffer that is considered "full" when it reaches size n,
 * but still accepts additional items, effectively allow overflowing.
 * The overflowing behavior is useful for supporting "expanding"
 * transducers, where we want to check if a buffer is full before
 * running the transduced step function, while still allowing a
 * transduced step to expand into multiple "essence" steps.
 */
export class FixedBuffer<T extends IStream, Q extends IChanValue<T> | Instruction<T, InstrTypes> = IChanValue<T>> implements Iterable<Q> {
    type: string;
    buffer: RingBuffer<T, Q>;
    n: number;

    constructor(buffer: RingBuffer<T, Q>, n: number, type: string) {
        this.buffer = buffer;
        this.n = n;
        this.type = type;
    }

    *[Symbol.iterator]() { yield* this.buffer; }

    isFull(): boolean {
        return this.buffer.length === this.n;
    }

    remove(): Q | undefined {
        return this.buffer.pop();
    }

    last(): Q | undefined {
        return this.buffer.last();
    }

    add(item: Q | undefined): void {
        this.buffer.unboundedUnshift(item);
    }

    closeBuffer(): void { }

    count(): number {
        return this.buffer.length;
    }
}

export function fixed<T extends IStream, Q extends IChanValue<T> | Instruction<T, InstrTypes> = IChanValue<T>>(n: number, type?: string): FixedBuffer<T, Q> {
    return new FixedBuffer<T, Q>(ring(n), n, type || 'primitive');
}

export class DroppingBuffer<T extends IStream, Q extends IChanValue<T> | Instruction<T, InstrTypes> = IChanValue<T>> {
    buffer: RingBuffer<T, Q>;
    n: number;

    constructor(buffer: RingBuffer<T, Q>, n: number) {
        this.buffer = buffer;
        this.n = n;
    }

    isFull(): boolean {
        return false;
    }

    remove(): IChanValue<T> | Instruction<T, InstrTypes> | undefined {
        return this.buffer.pop();
    }

    add(item: Q | undefined): void {
        if (this.buffer.length !== this.n) {
            this.buffer.unshift(item);
        }
    }

    closeBuffer(): void { }

    count(): number {
        return this.buffer.length;
    }
}

export function dropping<T extends IStream, Q extends IChanValue<T> | Instruction<T, InstrTypes> = IChanValue<T>>(n: number): DroppingBuffer<T, Q> {
    return new DroppingBuffer<T, Q>(ring<T, Q>(n), n);
}

export class SlidingBuffer<T extends IStream, Q extends IChanValue<T> | Instruction<T, InstrTypes> = IChanValue<T>> {
    buffer: RingBuffer<T, Q>;
    n: number;

    constructor(buffer: RingBuffer<T, Q>, n: number) {
        this.buffer = buffer;
        this.n = n;
    }

    isFull(): boolean {
        return false;
    }

    remove(): Q | undefined {
        return this.buffer.pop();
    }

    add(item: Q): void {
        if (this.buffer.length === this.n) {
            this.remove();
        }
        this.buffer.unshift(item);
    }

    closeBuffer(): void { }

    count(): number {
        return this.buffer.length;
    }
}

export function sliding<T extends IStream, Q extends IChanValue<T> | Instruction<T, InstrTypes> = IChanValue<T>>(n: number): SlidingBuffer<T, Q> {
    return new SlidingBuffer<T, Q>(ring<T, Q>(n), n);
}

export class PromiseBuffer<T extends IStream, Q extends IChanValue<T> | Instruction<T, InstrTypes> = IChanValue<T>> {
    value: Promise<Q> | undefined | null;

    static NO_VALUE = undefined;
    static isUndelivered = (value: any): boolean => PromiseBuffer.NO_VALUE === value;

    constructor(value?: Promise<Q>) {
        this.value = value;
    }

    isFull(): boolean {
        return false;
    }

    remove(): Promise<Q> | undefined | null {
        return this.value;
    }

    add(item: Promise<Q>): void {
        if (PromiseBuffer.isUndelivered(this.value)) {
            this.value = item;
        }
    }

    closeBuffer(): void {
        if (PromiseBuffer.isUndelivered(this.value)) {
            this.value = null;
        }
    }

    count(): number {
        return PromiseBuffer.isUndelivered(this.value) ? 0 : 1;
    }
}

export function promise<T extends IStream, Q extends IChanValue<T> | Instruction<T, InstrTypes> = IChanValue<T>>(): PromiseBuffer<T, Q> {
    return new PromiseBuffer<T, Q>();
}

export type BufferType<T extends IStream, Q extends IChanValue<T> | Instruction<T, InstrTypes> = IChanValue<T>> =
    FixedBuffer<T, Q>
    | DroppingBuffer<T, Q>
    | SlidingBuffer<T, Q>
    | PromiseBuffer<T, Q>;
