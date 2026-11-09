import { focused, panes, spaces } from "herdr";
import { selectTarget } from "./target.js";
export { resolveTarget } from "./target.js";

export function captureTarget() {
  return selectTarget(focused(), spaces(), panes());
}
