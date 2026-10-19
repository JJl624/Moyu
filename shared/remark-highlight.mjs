import { pairedDelimiterSyntax } from "./paired-delimiter-syntax.mjs";
export default function remarkHighlight() {
  const data = this.data();
  (data.micromarkExtensions ||= []).push(pairedDelimiterSyntax(61, "moyuHighlight"));
  (data.fromMarkdownExtensions ||= []).push({
    canContainEols: ["highlight"],
    enter: {
      moyuHighlight(token) {
        this.enter({ type: "highlight", children: [], data: { hName: "mark" } }, token);
      },
    },
    exit: {
      moyuHighlight(token) {
        this.exit(token);
      },
    },
  });
}
