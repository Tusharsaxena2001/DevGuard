type Token =
  | { readonly t: "char"; readonly c: string }
  | { readonly t: "any" }
  | { readonly t: "star" }
  | { readonly t: "globstar" }
  /** `/**` + `/` between two segments: zero or more whole directories, as in Git (`a/**` + `/b` matches `a/b`). */
  | { readonly t: "dirs" };

function tokenize(pattern: string): Token[] {
  const tokens: Token[] = [];
  for (let i = 0; i < pattern.length; i++) {
    const c = pattern.charAt(i);
    if (c === "*") {
      if (pattern.charAt(i + 1) === "*") {
        while (pattern.charAt(i + 1) === "*") i++;
        const prev = tokens[tokens.length - 1];
        if (prev?.t === "char" && prev.c === "/" && pattern.charAt(i + 1) === "/") {
          tokens.push({ t: "dirs" });
          i++;
        } else {
          tokens.push({ t: "globstar" });
        }
      } else {
        tokens.push({ t: "star" });
      }
    } else if (c === "?") {
      tokens.push({ t: "any" });
    } else {
      tokens.push({ t: "char", c });
    }
  }
  return tokens;
}

/**
 * Whole-string wildcard match (`*` and `?` stop at `/`, `**` crosses it) by dynamic programming: O(tokens x text),
 * no backtracking, so a hostile pattern or path cannot cause catastrophic runtime.
 */
function matchTokens(tokens: readonly Token[], text: string): boolean {
  const n = text.length;
  let prev: boolean[] = new Array<boolean>(n + 1).fill(false);
  prev[0] = true;
  for (const token of tokens) {
    const cur: boolean[] = new Array<boolean>(n + 1).fill(false);
    cur[0] = (token.t === "star" || token.t === "globstar" || token.t === "dirs") && prev[0] === true;
    let anyPrev = prev[0] === true;
    for (let j = 1; j <= n; j++) {
      const ch = text.charAt(j - 1);
      switch (token.t) {
        case "char":
          cur[j] = prev[j - 1] === true && ch === token.c;
          break;
        case "any":
          cur[j] = prev[j - 1] === true && ch !== "/";
          break;
        case "star":
          cur[j] = prev[j] === true || (cur[j - 1] === true && ch !== "/");
          break;
        case "globstar":
          cur[j] = prev[j] === true || cur[j - 1] === true;
          break;
        case "dirs":
          cur[j] = prev[j] === true || (ch === "/" && anyPrev);
          break;
      }
      anyPrev ||= prev[j] === true;
    }
    prev = cur;
  }
  return prev[n] === true;
}

/**
 * Compile a path glob into a predicate. Case-insensitive (`.ENV` must not slip past on case-insensitive filesystems).
 * A pattern without `/` matches the file's basename at any depth; a pattern with `/` matches the full repo-relative
 * path (a leading `/` also anchors to the root), and a leading `**` + `/` also matches at the repository root.
 * An empty pattern matches nothing.
 */
export function compileGlob(pattern: string): (path: string) => boolean {
  const rooted = pattern.startsWith("/");
  const lowered = (rooted ? pattern.slice(1) : pattern).toLowerCase();
  if (lowered.length === 0) return () => false;

  const anchored = rooted || lowered.includes("/");
  const variants = (lowered.startsWith("**/") ? [lowered, lowered.slice(3)] : [lowered]).map(tokenize);

  return (path) => {
    const lowerPath = path.toLowerCase();
    const target = anchored ? lowerPath : lowerPath.slice(lowerPath.lastIndexOf("/") + 1);
    return variants.some((tokens) => matchTokens(tokens, target));
  };
}

/**
 * Only `*`, `**` and `?` are wildcards. Constructs other globbers give meaning to (`[..]`, `{..}`, `\` escapes, a
 * trailing `/`) would otherwise be matched literally and silently never fire, so callers must treat them as errors.
 */
export function isSupportedGlob(pattern: string): boolean {
  return !/[[\]{}\\]/.test(pattern) && !pattern.endsWith("/");
}
