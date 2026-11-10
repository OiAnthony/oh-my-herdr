// Git paths use '/', but a backslash is a valid filename character on POSIX.
const windowsPath = path => /^[A-Za-z]:[\\/]/.test(path) || path.startsWith("\\\\");
const directory = (path, windows) => (windows ? path.replace(/\\/g, "/") : path).replace(/\/+$/, "");

export function diffPath({ root, file }, base = root) {
  const windows = windowsPath(root), repo = directory(root, windows), from = directory(base, windows);
  const absolute = `${repo}/${file.path}`;
  const comparable = value => windows ? value.toLowerCase() : value;
  return comparable(absolute).startsWith(comparable(from) + "/")
    ? absolute.slice(from.length + 1) : file.path;
}

// The title base is independent of the repository used to read the diff.
export async function diffTitle(diff, exec) {
  if (!diff.titleCwd || directory(diff.titleCwd, windowsPath(diff.root)) === directory(diff.root, windowsPath(diff.root))) return diffPath(diff);
  let base = diff.titleCwd;
  try {
    const result = await exec("git", ["rev-parse", "--show-toplevel"], { cwd: base, on: diff.on });
    if (result.code === 0) base = result.stdout.replace(/\r?\n$/, "");
  } catch {
    // An unavailable origin must not prevent reading a diff from its pinned repo.
    return diffPath(diff);
  }
  return diffPath(diff, base);
}
