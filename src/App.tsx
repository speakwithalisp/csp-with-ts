import React, { useState, useCallback, useEffect, memo, MouseEvent, Props, Dispatch, SetStateAction, MemoExoticComponent, FunctionComponent } from 'react';
import './App.css';
import { chan, IChan, IChanValue } from './csp/impl/channels';
import { putAsync } from './csp/impl/processEvents';
import { go, timeout, IAltsArgs } from './csp/impl/go';

// const myChan = chan<string | boolean>();
// function fakeQuery(ch: IChan<string>, query: string) {
//   const randInt: number = 400 + Math.random() * 2000;
//   go`<!${timeout(randInt)}; >! ${ch} ${function* () { yield query; ch.close(); }}`;
// }
// 
// function createQueries(...queries: string[]): IChan<string> {
//   const ch = chan<string>();
//   queries.forEach((query: string) => { fakeQuery(ch, query); });
//   return ch;
// }
// 
// export default function App() {
//   const [winner, setWinner] = useState<string>("");
//   useEffect(() => go`<! ${myChan} ${function* () { while (true) { setWinner(yield); } }}`, []);
//   const raceQueries = useCallback(() => {
//     go`?: ${[timeout(1000), createQueries("booby", "shooby"), createQueries("n00by", "l00by")]} ${function (val) { if (typeof val === 'boolean') { putAsync(myChan, "too bad, so saaad!"); } else { putAsync(myChan, val); } }}`;
//   }, []);
//   return (<div><p>Winner says: {winner}</p><button onClick={raceQueries}>Click it aaho</button></div>);
// };
// 


interface Point { x: number; y: number; };
const WIDTH: number = 80; const HEIGHT: number = 35; const SCALE = 50; const DELTA = 0.01;
const myChan = chan<Point>();

function euclid(p1: Point, p2: Point): number {
  return (p1.x - p2.x) ** 2 + (p1.y - p2.y) ** 2;
}

function listenForDrag(ch: IChan<Point>) {
  return go`<! ${ch} ${function* () { let final: Point, state: Point; final = yield; while (true) { state = yield; if (euclid(state, final) > 50) { final = state; putAsync(myChan, final); } }; }}`;
}

function emitClickDrag() {
  const ch = chan<Point>(2);
  const goBlock = listenForDrag(ch);
  return { channel: ch, process: goBlock };
}

export interface IClickDragProps extends Props<MemoExoticComponent<FunctionComponent<{}>>> {
  setListener: Dispatch<SetStateAction<{ channel: IChan<Point>; process: () => void; } | undefined>>;
  setCursor: Dispatch<SetStateAction<'grab' | 'grabbing'>>;
  cursor: 'grab' | 'grabbing';
  // drag: (e: MouseEvent) => void;
};

const ClickDrag = memo(({ setListener, cursor, setCursor }: IClickDragProps) => {
  const [dim, setDim] = useState<Point>({ x: 30, y: 30 });
  useEffect(() => go`<! ${myChan} ${function* () { while (true) { setDim(yield); } }
    } `, []);
  const clickHandler = useCallback((e: MouseEvent) => {
    e.stopPropagation();
    const tentative = emitClickDrag();
    setListener(tentative);
    go<boolean | Point>`?: ${[timeout(200), tentative.channel] as IAltsArgs[]} ${function (val: IChanValue<boolean | Point>) {
      if (typeof val === 'boolean') {
        setCursor('grab');
        tentative.channel.close();
        tentative.process();
      }
    }}`;
    // takeAsync(interim).then(val => { console.log(val); if ((typeof val === 'boolean')) { tentative.channel.close(); tentative.process(); }});
  }, []);
  return (<rect
    cursor={cursor}
    x={dim.x}
    y={dim.y}
    transform={`translate(-${WIDTH / 2},-${HEIGHT / 2})`}
    width={WIDTH}
    height={HEIGHT}
    fill="green"
    onMouseDown={clickHandler}
    onClick={e => e.stopPropagation()}
  />);
});

export default function App() {
  const [listener, setListener] = useState<{ channel: IChan<Point>; process: () => void; }>();
  const [cursor, setCursor] = useState<'grab' | 'grabbing'>('grab');
  const drag = useCallback((e: MouseEvent) => {
    if (listener && !listener.channel.closed) {
      setCursor('grabbing');
      putAsync(listener.channel, { x: e.clientX, y: e.clientY });
    }
  }, [listener]);
  const unClick = useCallback((_: MouseEvent) => {
    if (listener && !listener.channel.closed) {
      setCursor('grab');
      listener.channel.close();
      listener.process();
    }
  }, [listener]);
  const clickHandler = useCallback((e: MouseEvent) => {
    if (!(listener && !listener.channel.closed)) {
      putAsync(myChan, { x: e.clientX, y: e.clientY });
    }
  }, [listener]);
  return (<div>
    <svg
      cursor="move"
      fill="whitesmoke"
      width={WIDTH * SCALE}
      height={HEIGHT * SCALE}
      onClick={clickHandler}
      onMouseUp={unClick}
      onMouseMove={drag}
    >
      <ClickDrag
        setListener={setListener}
        cursor={cursor}
        setCursor={setCursor}
      />
    </svg>
  </div>);
}
