import { layout } from "herdr";

function findNode(node, id) {
  if (node?.id === id) return node;
  for (const child of node?.children ?? []) {
    const found = findNode(child, id);
    if (found) return found;
  }
  return null;
}

// Layout ids belong to the layout, never to the feature.
export function panelBinding(binding) {
  if (!binding?.panel || !binding.stack || !binding.child) return null;
  const panel = findNode(layout(), binding.panel);
  const stack = findNode(panel, binding.stack);
  const child = stack?.children?.find((node) => node.id === binding.child);
  return stack?.type === "stack" && child ? { panel, stack, child } : null;
}

