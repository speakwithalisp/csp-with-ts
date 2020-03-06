import React, { useState, useCallback, useEffect } from 'react';
import './App.css';
import { go, chan, timeout, IChan } from "./channels";

const myChan = chan<string | boolean>();
myChan['name'] = "myChan";

function makeFakeReq(c: IChan<string>, query: string): void {
  const rand = 200 + Math.random() * 2000;
  go`<! ${timeout(rand)}; >!${c} ${function* () { yield query; c.close(); }}`;
}

function callQueries(...queries: string[]): IChan<string> {
  const chann = chan<string>();
  queries.forEach(query => { makeFakeReq(chann, query) });
  return chann;
}

export default function App() {
  const [winner, setWinner] = useState<string>();
  useEffect(() =>
    go`<! ${myChan} ${function* () {
      while (true) {
        const win = yield; if (typeof win === 'boolean') { setWinner("timed out"); } else { setWinner(win); }
      }
    }
      }`
    , []);
  const handler = useCallback(() => {
    // const c1 = chan();
    // const c2 = chan();
    // return go`>! ${myChan} ${callQueries("shooby", "mooby")}} `;
    return go`>! ${myChan} ?: ${[callQueries("booby", "scooby"), callQueries("shooby", "mooby", "mcN00by"), timeout(1000)]} `;
  }
    , []);
  return (<div>
    <button onClick={handler}>make request</button>
    <p>Res:{winner}</p>
  </div>);
}



// const App = () => {
//   return (
//     <div className="App">
//       <header className="App-header">
//         <img src={logo} className="App-logo" alt="logo" />
//         <p>
//           Edit <code>src/App.tsx</code> and save to reload.
//         </p>
//         <a
//           className="App-link"
//           href="https://reactjs.org"
//           target="_blank"
//           rel="noopener noreferrer"
//         >
//           Learn React
//         </a>
//       </header>
//     </div>
//   );
// }
// 
// export default App;
