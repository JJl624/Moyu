import { pairedDelimiterSyntax } from "./paired-delimiter-syntax.mjs";
// Paired underscores also work beside Chinese text. CommonMark handles the
// remaining underscore emphasis/triple delimiters; asterisk strong stays bold.
export default function remarkUnderline() {
  const data = this.data();
  (data.micromarkExtensions ||= []).push(pairedDelimiterSyntax(95, "moyuUnderline"));
  (data.fromMarkdownExtensions ||= []).push({
    canContainEols: ["underline"],
    enter: {
      moyuUnderline(token) {
        this.enter({ type: "underline", children: [], data: { hName: "u" } }, token);
      },
      strong(token) {
        const underline = this.sliceSerialize(token).startsWith("__");
        this.enter({
          type: underline ? "underline" : "strong",
          children: [],
          ...(underline ? { data: { hName: "u" } } : {}),
        }, token);
      },
    },
    exit: {
      moyuUnderline(token) {
        this.exit(token);
      },
      strong(token) {
        this.exit(token);
      },
    },
  });
}
