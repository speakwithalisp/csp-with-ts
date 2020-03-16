// Make fake thread
export function* makeFakeThread() { yield; };

// Transducer interface
export declare interface Reduced<A = any> {
    ['@@transducer/value']: A;
    ['@@transducer/reduced']: true;
};
export declare interface IXForm<A = any, B = any> {
    ['@@transducer/init'](): A;
    ['@@transducer/result'](acc: A): A;
    ['@@transducer/step'](acc: A, x: B): A | Reduced<A>;
};

export type ITransducer<A = any, B = any, C = any> = (r: IXForm<C, B>) => IXForm<C, A>;

export function isReduced<A = any>(val: any): val is Reduced<A> {
    return val && val['@@transducer/reduced'];
}
