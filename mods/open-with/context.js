// Target capture adapter derived from CacaoRick/herdr-open-vscode (MIT).
// Modified by oh-my-herdr to use the machine-aware target selector; see LICENSE.open-vscode.
import { focused, panes, spaces } from "herdr";
import { selectTarget } from "./target.js";
export { resolveTarget } from "./target.js";

export function captureTarget() {
  return selectTarget(focused(), spaces(), panes());
}
