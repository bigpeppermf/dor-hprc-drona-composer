import React from "react";
import ReactDOM from "react-dom";
import EnvironmentBuilder from "./EnvironmentBuilder";

const root = document.getElementById("builder-root");
if (root) {
  ReactDOM.render(<EnvironmentBuilder />, root);
}
