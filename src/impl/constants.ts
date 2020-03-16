export const MAX_DIRTY = 64;
export const CLOSED = null;
export const MAX_QUEUE_SIZE = 1024;
export enum InstructionPutStates {
    NO_PUT_DEFAULT,
    NO_PUT_CHAN_FULL,
    DONE,
    NOT_DONE
};

export enum InstructionTakeStates {
    CHAN_VALUE_CLOSED,
    CHAN_VALUE_OPEN,
    DONE,
    NOT_DONE,
    NO_TAKE_CHAN_EMPTY,
    NO_TAKE_DEFAULT
};

export enum ProcessEvents {
    PUT,
    TAKE,
    SLEEP
};

export enum InstrTypes {
    CALLBACK,
    GENERAL
};

export type IStream = string | number | boolean | object;
