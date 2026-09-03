/**
 * What kind of spoiler a sentence carries. The reader's control is a number, but what they are
 * choosing between is kinds: whether being told who dies matters more to them than being told
 * which scene closes the film. Naming the kinds is what lets one dial mean something.
 */
export type SpoilerCategory =
  | "death"
  | "identity"
  | "outcome"
  | "return"
  | "relationship"
  | "ending"
  | "hint";

/**
 * One kind of spoiler: how much of the ending it gives away, and what the reader is told in place
 * of the sentence. The reason names the kind and never the wording that matched, so a placeholder
 * cannot give away what it is standing in for.
 */
export type CategoryMatch = {
  category: SpoilerCategory;
  weight: number;
  reason: string;
};

/**
 * English wording is matched on word boundaries, so "dies" is not found in "diesel". Japanese runs
 * without spaces and takes no boundary, so a phrase is matched wherever it appears. A pattern that
 * should also catch its own inflections is written as the stem: `betray` finds "betrays" and
 * "betrayed" as well.
 */
function wording(english: string[], japanese: string[]): RegExp {
  const bounded = english.map((phrase) => String.raw`\b${phrase}`);
  return new RegExp([...bounded, ...japanese].join("|"), "i");
}

const CATEGORIES: (CategoryMatch & { pattern: RegExp })[] = [
  {
    category: "death",
    weight: 90,
    reason: "a sentence that names who dies",
    pattern: wording(
      [
        String.raw`dies\b`,
        String.raw`(?:is|are|was|were|be) killed\b`,
        String.raw`murders\b`,
        String.raw`murdered\b`,
        String.raw`commits suicide\b`,
        String.raw`kills (?:himself|herself|themselves)\b`,
        String.raw`(?:is|was|been) dead\b`,
        String.raw`survives\b`,
      ],
      ["死亡", "死ぬ", "殺され", "命を落と", "生き残", "自殺"],
    ),
  },
  {
    category: "identity",
    weight: 90,
    reason: "a sentence that names who someone really is",
    pattern: wording(
      [
        String.raw`true identity\b`,
        String.raw`(?:is|are|was|were) actually\b`,
        String.raw`turns out\b`,
        String.raw`turned out\b`,
        String.raw`the culprit\b`,
        String.raw`the killer\b`,
        String.raw`the murderer\b`,
        String.raw`mastermind\b`,
      ],
      ["正体", "実は", "真犯人", "黒幕", "本当は"],
    ),
  },
  {
    category: "outcome",
    weight: 75,
    reason: "a sentence that states how it turns out",
    pattern: wording(
      [
        String.raw`wins\b`,
        String.raw`loses\b`,
        String.raw`defeats\b`,
        String.raw`(?:is|are|was|were) arrested\b`,
        String.raw`escapes\b`,
        String.raw`in the end\b`,
      ],
      ["勝利", "敗北", "倒す", "逮捕され", "逃亡", "結末"],
    ),
  },
  {
    category: "return",
    weight: 70,
    reason: "a sentence that names a turn late in the story",
    pattern: wording(
      [
        String.raw`resurrected\b`,
        String.raw`returns\b`,
        String.raw`transforms into\b`,
        String.raw`revealed to be\b`,
        String.raw`(?:is|are|was|were) revealed (?:that|to|as)\b`,
        String.raw`twists?\b`,
      ],
      ["復活", "生き返", "戻ってく", "変身", "だったことが判明", "どんでん返し"],
    ),
  },
  {
    category: "relationship",
    weight: 60,
    reason: "a sentence that states how two characters are related",
    pattern: wording(
      [
        String.raw`betray`,
        String.raw`father of\b`,
        String.raw`mother of\b`,
        String.raw`sibling`,
        String.raw`married\b`,
        String.raw`twin`,
      ],
      ["裏切", "父親", "母親", "兄弟", "姉妹", "結婚", "双子"],
    ),
  },
  {
    category: "ending",
    weight: 55,
    reason: "a sentence about the closing scenes",
    pattern: wording(
      [
        String.raw`final (?:scene|episode|act)\b`,
        String.raw`finale\b`,
        String.raw`epilogue\b`,
        String.raw`post-credits scene\b`,
        String.raw`climax`,
      ],
      ["ラストシーン", "最終回", "最終話", "エピローグ", "エンドロール後", "クライマックス"],
    ),
  },
  /**
   * Wording that only leans towards the ending: it is what the strongest preset is for, and it is
   * scored low because the sentences it catches are as often about a press interview as a plot.
   */
  {
    category: "hint",
    weight: 40,
    reason: "wording that hints at the ending",
    pattern: wording(
      [
        String.raw`reveal`,
        String.raw`revelation`,
        String.raw`fate of\b`,
        String.raw`death of\b`,
        String.raw`ending\b`,
        String.raw`secret`,
        String.raw`sacrifice`,
        String.raw`confront`,
      ],
      ["秘密", "運命", "犠牲", "対決"],
    ),
  },
];

/**
 * The worst thing a sentence gives away, or nothing if its wording carries none of them. The
 * pattern that matched is deliberately not returned: nothing downstream can put it on the screen.
 */
export function strongestCategory(text: string): CategoryMatch | null {
  let strongest: CategoryMatch | null = null;
  for (const { pattern, ...match } of CATEGORIES) {
    if (!pattern.test(text)) continue;
    if (!strongest || match.weight > strongest.weight) strongest = match;
  }
  return strongest;
}
