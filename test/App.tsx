import React, { useState, useCallback, useEffect, memo, MouseEvent, Props, Dispatch, SetStateAction, MemoExoticComponent, FunctionComponent } from 'react';
import './App.css';
import { filter, compose, map } from 'ramda';
import { go, timeout, IAltsArgs, chan, IChan, IChanValue, putAsync, sliding } from '../lib/bundle';

interface Point { x: number; y: number; };
const WIDTH: number = 80; const HEIGHT: number = 35; const SCALE = 50; const DELTA = 0.01;

// const decideClick = compose(take(2), partial(mapAccum((acc: number, v: MouseEvent): [number, MouseEvent] => [acc >= 0 ? acc - v.timeStamp : acc + v.timeStamp, v]), [0]));
const myChan = chan<MouseEvent, Point>(sliding(2), compose(map((ev: MouseEvent): Point => ({ x: ev.clientX, y: ev.clientY })) as any, filter((val: Point) => euclid(val, { x: 150, y: 150 } as Point) < 10000) as any));

function euclid(p1: Point, p2: Point): number {
  return (p1.x - p2.x) ** 2 + (p1.y - p2.y) ** 2;
}

function listenForDrag(ch: IChan<MouseEvent>) {
  return go`<! ${ch} ${function* () { let state: MouseEvent; while (true) { state = yield; if (state.type === 'mouseup') { break; } else { putAsync<MouseEvent, Point>(myChan as IChan<MouseEvent, Point>, state); } } ch.close(); }}`;
}

function emitClickDrag() {
  const ch = chan<MouseEvent>();
  go<boolean | MouseEvent>`?: ${[timeout(200), ch] as IAltsArgs[]} ${function (val: IChanValue<boolean | MouseEvent>) {
    if (typeof val === 'boolean' || (val! as MouseEvent).type === 'mouseup') {
      ch.close();
    }
  }}`;
  const goBlock = listenForDrag(ch);
  return { channel: ch, process: goBlock };
}

function listenForOutsideClick() {
  const ch = chan<MouseEvent>(1, compose(filter((ev: MouseEvent) => ['click', 'mouseup'].includes(ev.type)) as any));
  const goBlock = go<boolean | MouseEvent>`?: ${[timeout(200), ch] as IAltsArgs[]} ${function (val: IChanValue<boolean | MouseEvent>) { console.log('errrr'); if (typeof val !== 'boolean') { putAsync(myChan as IChan<MouseEvent, Point>, val as MouseEvent); } }}`;
  return { channel: ch, process: goBlock };
}

export interface IClickDragProps extends Props<MemoExoticComponent<FunctionComponent<{}>>> {
  setListener: Dispatch<SetStateAction<{ channel: IChan<MouseEvent>; process: () => void; } | null>>;
  cursor: 'grab' | 'grabbing';
  // drag: (e: MouseEvent) => void;
};

const ClickDrag = memo(({ setListener, cursor }: IClickDragProps) => {
  const [dim, setDim] = useState<Point>({ x: 150, y: 100 });
  useEffect(() => go<MouseEvent, Point>`<! ${myChan as IChan<MouseEvent, Point>} ${function* () { while (true) { setDim(yield); } }
    } `, []);
  const clickHandler = useCallback((e: MouseEvent) => {
    e.stopPropagation();
    const tentative = emitClickDrag();
    setListener(tentative);
  }, []);
  return (<rect
    cursor={cursor}
    x={dim.x}
    y={dim.y}
    transform={`translate(-${WIDTH / 2}, -${HEIGHT / 2})`}
    width={WIDTH}
    height={HEIGHT}
    fill="green"
    onMouseDown={clickHandler}
  />);
});

export default function App() {
  const [listener, setListener] = useState<{ channel: IChan<MouseEvent>; process: () => void; } | null>(null);
  const [cursor, setCursor] = useState<'grab' | 'grabbing'>('grab');
  const drag = useCallback((e: MouseEvent) => {
    const clone = { ...e };
    if (listener && !listener.channel.closed) {
      setCursor('grabbing');
      putAsync(listener.channel, clone);
    }
  }, [listener]);
  console.log(listener);
  const unClick = useCallback((e: MouseEvent) => {
    console.log(listener);
    if (listener && !listener.channel.closed) {
      const clone = { ...e };
      putAsync(listener.channel, clone, false, () => { listener.process(); setListener(null); setCursor('grab'); });
    }
  }, [listener]);
  const clickHandler = useCallback((e: MouseEvent) => {
    e.stopPropagation();
    setListener(listenForOutsideClick());
  }, []);
  return (<div>
    <svg
      cursor="move"
      fill="whitesmoke"
      width={WIDTH * SCALE}
      height={HEIGHT * SCALE}
      onMouseDown={clickHandler}
      onMouseUp={unClick}
      onMouseMove={drag}
    >
      <ClickDrag
        setListener={setListener}
        cursor={cursor}
      />
    </svg>
  </div>);
}
