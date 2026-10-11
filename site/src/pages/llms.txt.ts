import type { APIRoute } from "astro";
import { FAQ, faqAnswerText } from "../lib/faq";
import { minMac, minWindows, version } from "../lib/release";

// /llms.txt: the page's facts as Markdown for language models that read a
// site before answering about it, with the links that carry the detail.
export const GET: APIRoute = ({ site }) => {
  const base = site ?? new URL("https://nodebanana.app");
  const url = (path: string) => new URL(path, base).href;
  const lines = [
    "# Node Banana",
    "",
    "> Node Banana is a free, open source (MIT) generative media canvas for Mac and Windows. You build AI image, video, audio, 3D and text workflows by connecting nodes on a canvas; each node calls an AI provider with your own API key. There is no account, no subscription and no telemetry.",
    "",
    `Current version: ${version}. Desktop app for Apple Silicon Macs (${minMac} or later) and 64-bit Windows (${minWindows} or later); runs from source in a browser elsewhere.`,
    "",
    "## Facts",
    "",
    ...FAQ.map((entry) => `- **${entry.question}** ${faqAnswerText(entry)}`),
    "",
    "## Links",
    "",
    `- [Website](${url("/")}): downloads for Mac (${url("/download/mac")}) and Windows (${url("/download/windows")})`,
    "- [Documentation](https://node-banana-docs.vercel.app/): every node, setting and provider",
    "- [Source code](https://github.com/shrimbly/node-banana): the repository, MIT licensed",
    "- [Releases](https://github.com/shrimbly/node-banana/releases): installers, release notes and checksums",
    "- [Changelog](https://github.com/shrimbly/node-banana/blob/master/CHANGELOG.md)",
    "- [Discord](https://discord.com/invite/89Nr6EKkTf): help and sharing workflows",
    "",
  ];
  return new Response(lines.join("\n"), { headers: { "Content-Type": "text/plain; charset=utf-8" } });
};
