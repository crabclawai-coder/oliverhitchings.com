function normaliseAtRulePrelude(value) {
  return value.replace(/\s+/g, "").toLowerCase();
}

function findNextAtRule(source, atRuleName, startIndex) {
  let quote = null;
  let inComment = false;

  for (let index = startIndex; index < source.length; index += 1) {
    const character = source[index];
    const nextCharacter = source[index + 1];

    if (inComment) {
      if (character === "*" && nextCharacter === "/") {
        inComment = false;
        index += 1;
      }
      continue;
    }

    if (quote) {
      if (character === "\\") {
        index += 1;
      } else if (character === quote) {
        quote = null;
      }
      continue;
    }

    if (character === "/" && nextCharacter === "*") {
      inComment = true;
      index += 1;
    } else if (character === '"' || character === "'") {
      quote = character;
    } else if (
      character === "@" &&
      source.startsWith(atRuleName, index) &&
      !/[\w-]/.test(source[index + atRuleName.length] ?? "")
    ) {
      return index;
    }
  }

  return -1;
}

function findOpeningBrace(source, atRuleIndex) {
  let quote = null;
  let inComment = false;

  for (let index = atRuleIndex; index < source.length; index += 1) {
    const character = source[index];
    const nextCharacter = source[index + 1];

    if (inComment) {
      if (character === "*" && nextCharacter === "/") {
        inComment = false;
        index += 1;
      }
      continue;
    }

    if (quote) {
      if (character === "\\") {
        index += 1;
      } else if (character === quote) {
        quote = null;
      }
      continue;
    }

    if (character === "/" && nextCharacter === "*") {
      inComment = true;
      index += 1;
    } else if (character === '"' || character === "'") {
      quote = character;
    } else if (character === "{") {
      return index;
    }
  }

  return -1;
}

function findMatchingBrace(source, openingBraceIndex) {
  let depth = 1;
  let quote = null;
  let inComment = false;

  for (let index = openingBraceIndex + 1; index < source.length; index += 1) {
    const character = source[index];
    const nextCharacter = source[index + 1];

    if (inComment) {
      if (character === "*" && nextCharacter === "/") {
        inComment = false;
        index += 1;
      }
      continue;
    }

    if (quote) {
      if (character === "\\") {
        index += 1;
      } else if (character === quote) {
        quote = null;
      }
      continue;
    }

    if (character === "/" && nextCharacter === "*") {
      inComment = true;
      index += 1;
    } else if (character === '"' || character === "'") {
      quote = character;
    } else if (character === "{") {
      depth += 1;
    } else if (character === "}") {
      depth -= 1;
      if (depth === 0) return index;
    }
  }

  throw new Error(`Unclosed CSS block at index ${openingBraceIndex}`);
}

export function extractCssAtRuleBlocks(source, atRulePrelude) {
  const normalisedTarget = normaliseAtRulePrelude(atRulePrelude);
  const atRuleName = atRulePrelude.match(/^\s*@[\w-]+/)?.[0]?.trim();

  if (!atRuleName) {
    throw new TypeError("Expected an at-rule prelude such as @media (max-width: 620px)");
  }

  const blocks = [];
  let cursor = 0;

  while (cursor < source.length) {
    const atRuleIndex = findNextAtRule(source, atRuleName, cursor);
    if (atRuleIndex === -1) break;

    const openingBraceIndex = findOpeningBrace(
      source,
      atRuleIndex + atRuleName.length,
    );
    if (openingBraceIndex === -1) break;

    const closingBraceIndex = findMatchingBrace(source, openingBraceIndex);
    const prelude = source.slice(atRuleIndex, openingBraceIndex);

    if (normaliseAtRulePrelude(prelude) === normalisedTarget) {
      blocks.push(source.slice(openingBraceIndex + 1, closingBraceIndex));
    }

    cursor = closingBraceIndex + 1;
  }

  return blocks;
}
