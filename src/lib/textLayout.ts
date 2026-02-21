import {
  CARD_TEXT_PAD, CARD_ACCENT_HEIGHT, LINE_HEIGHT,
  CARD_MIN_HEIGHT, CARD_MAX_HEIGHT, DOT_SPACING,
} from "../constants";

export interface WrappedLine {
  text: string;
  isHeader: boolean;
}

export function wrapText(
  ctx: CanvasRenderingContext2D,
  text: string,
  maxWidth: number,
): WrappedLine[] {
  const paragraphs = text.split("\n");
  const lines: WrappedLine[] = [];

  for (let pi = 0; pi < paragraphs.length; pi++) {
    const isHeader = pi === 0;
    const para = paragraphs[pi];

    if (para === "") {
      lines.push({ text: "", isHeader });
      continue;
    }

    const words = para.split(/\s+/);
    let current = "";

    for (const word of words) {
      const measured = isHeader ? word.toUpperCase() : word;

      if (current === "") {
        // Force-break words longer than maxWidth
        if (ctx.measureText(measured).width > maxWidth) {
          let chars = "";
          for (const ch of word) {
            const testChar = isHeader ? ch.toUpperCase() : ch;
            if (chars !== "" && ctx.measureText(isHeader ? (chars + testChar).toUpperCase() : chars + testChar).width > maxWidth) {
              lines.push({ text: chars, isHeader });
              chars = "";
            }
            chars += ch;
          }
          current = chars;
        } else {
          current = word;
        }
      } else {
        const test = current + " " + word;
        const measuredTest = isHeader ? test.toUpperCase() : test;
        if (ctx.measureText(measuredTest).width > maxWidth) {
          lines.push({ text: current, isHeader });
          current = word;
        } else {
          current = test;
        }
      }
    }

    if (current !== "") {
      lines.push({ text: current, isHeader });
    }
  }

  return lines;
}

export function computeCardHeight(
  ctx: CanvasRenderingContext2D,
  text: string,
  cardWidth: number,
): number {
  const maxWidth = cardWidth - CARD_TEXT_PAD * 2;
  const lines = wrapText(ctx, text, maxWidth);
  const rawHeight = CARD_ACCENT_HEIGHT + CARD_TEXT_PAD + lines.length * LINE_HEIGHT + CARD_TEXT_PAD;
  const snapped = Math.ceil(rawHeight / DOT_SPACING) * DOT_SPACING;
  return Math.max(CARD_MIN_HEIGHT, Math.min(CARD_MAX_HEIGHT, snapped));
}
