import { extendTailwindMerge } from "tailwind-merge";

// tailwind-merge resolves conflicts (a later `min-h-12` beats the base `min-h-14`), and is
// told about this app's theme tokens so they merge as radius, shadow and colour classes. taste-skill-ignore: the word, not a style
const merge = extendTailwindMerge({
  extend: {
    theme: {
      text: ["caption", "label", "body", "lead", "intro", "title-sm", "title-md", "title-lg", "step", "display", "title-page", "title-session"],
      radius: ["tile", "mini", "bubble", "card", "panel", "inner", "badge"],
      shadow: ["button", "panel", "mini", "deal", "card", "lift"],
      ease: ["deal"],
      color: ["table", "ink", "ink-soft", "line", "paper", "film", "tv", "music", "games", "books", "mat", "ink-hover", "danger", "games-ink", "games-tint"],
    },
  },
});

export const cn = (...classes: (string | undefined | null | false)[]) => merge(classes.filter(Boolean).join(" "));
