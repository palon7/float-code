import React from "react";
import { render } from "ink";
import { App } from "./app.js";
import { parseConfig } from "./config.js";

const config = parseConfig(process.argv.slice(2));
const clearRef = { current: () => {} };
const instance = render(
  <App
    wsUrl={config.wsUrl}
    httpUrl={config.httpUrl}
    token={config.token}
    clearScreen={() => clearRef.current()}
  />,
);
clearRef.current = () => {
  instance.clear();
  process.stdout.write("\x1B[2J\x1B[H");
};
