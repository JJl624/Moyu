// Delimiter resolution follows micromark-extension-gfm-strikethrough (MIT,
// Titus Wormer). Use its attention rules for paired == markers so escaping,
// nested inline syntax, code spans and Markdown source positions stay native.
import { splice } from "micromark-util-chunked";
import { classifyCharacter } from "micromark-util-classify-character";
import { resolveAll } from "micromark-util-resolve-all";

export function pairedDelimiterSyntax(marker, type) {
  const temporary = type + "Temporary", sequence = type + "Sequence";
  const construct = { name: type, tokenize, resolveAll: resolve };
  return { text: { [marker]: construct }, insideSpan: { null: [construct] }, attentionMarkers: { null: [marker] } };
  function tokenize(effects, ok, nok) {
    const previous = this.previous, events = this.events;
    let size = 0;
    return start;
    function start(code) {
      if (previous === marker && events.at(-1)?.[1].type !== "characterEscape") return nok(code);
      effects.enter(temporary);
      return more(code);
    }
    function more(code) {
      if (code === marker) {
        if (size === 2) return nok(code);
        effects.consume(code);
        size++;
        return more;
      }
      if (size !== 2) return nok(code);
      const before = classifyCharacter(previous), after = classifyCharacter(code), token = effects.exit(temporary);
      token._open = !after || after === 2 && Boolean(before);
      token._close = !before || before === 2 && Boolean(after);
      return ok(code);
    }
  }
  function resolve(events, context) {
    let index = -1;
    while (++index < events.length) {
      if (events[index][0] !== "enter" || events[index][1].type !== temporary || !events[index][1]._close) continue;
      let open = index;
      while (open--) {
        if (events[open][0] !== "exit" || events[open][1].type !== temporary || !events[open][1]._open) continue;
        const first = events[open][1], last = events[index][1];
        first.type = last.type = sequence;
        const token = { type, start: { ...first.start }, end: { ...last.end } },
          body = { type: type + "Text", start: { ...first.end }, end: { ...last.start } };
        const inside = context.parser.constructs.insideSpan.null;
        const next = [["enter", token, context], ["enter", first, context], ["exit", first, context], [
          "enter",
          body,
          context,
        ]];
        splice(
          next,
          next.length,
          0,
          inside ? resolveAll(inside, events.slice(open + 1, index), context) : events.slice(open + 1, index),
        );
        splice(next, next.length, 0, [["exit", body, context], ["enter", last, context], ["exit", last, context], [
          "exit",
          token,
          context,
        ]]);
        splice(events, open - 1, index - open + 3, next);
        index = open + next.length - 2;
        break;
      }
    }
    for (const event of events) if (event[1].type === temporary) event[1].type = "data";
    return events;
  }
}
