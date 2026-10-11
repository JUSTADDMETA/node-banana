/**
 * The questions people ask about Node Banana, answered in plain sentences an
 * answer engine can quote whole. Rendered on the page (Faq.astro), as FAQPage
 * structured data, and in /llms.txt, so the three never disagree.
 */
import { minMac, minWindows } from "./release";

export interface FaqEntry {
  question: string;
  answer: string;
  /** A closing sentence of links, "<lead> A and B.", with the addresses spelled out in the data. */
  links?: { lead: string; items: { label: string; href: string }[] };
}

/** The answer as one plain sentence run, with the link's address spelled out. */
export const faqAnswerText = ({ answer, links }: FaqEntry) =>
  links ? `${answer} ${links.lead} ${joinNaturally(links.items.map((link) => `${link.label} (${link.href})`))}.` : answer;

/** "A", "A and B", "A, B and C". */
export const joinNaturally = (parts: string[]) =>
  parts.length <= 1 ? parts.join("") : `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`;

export const FAQ: FaqEntry[] = [
  {
    question: "What is Node Banana?",
    answer:
      "Node Banana is a free, open source desktop app for Mac and Windows that lets you build AI media workflows on a node-based canvas. You connect image, video, audio, 3D and language-model nodes into a graph, and each node calls an AI provider with your own API key.",
  },
  {
    question: "Is Node Banana free?",
    answer:
      "Yes. Node Banana is MIT licensed and costs nothing. There is no account, no subscription and no telemetry. You pay the AI providers directly for what you generate, with the API keys you bring.",
  },
  {
    question: "Is Node Banana the same as Google's Nano Banana?",
    answer:
      "No. Nano Banana is Google's name for its Gemini image generation models. Node Banana is an independent open source app that can run those models, alongside models from OpenAI, Replicate, fal.ai, Kie.ai, WaveSpeed and ComfyUI, on one canvas.",
  },
  {
    question: "Which AI providers and models does Node Banana support?",
    answer:
      "Google Gemini (Nano Banana image models, Veo video, Gemini text), OpenAI (GPT Image and text models), Anthropic text models, Replicate, fal.ai, Kie.ai, WaveSpeed, and ComfyUI, whose Comfy Router serves over 150 partner models from FLUX, Kling, Seedream, Ideogram, Runway, ElevenLabs and others under one key. Every model becomes a node with typed sockets for images, video, audio, text and 3D.",
  },
  {
    question: "What does Node Banana run on?",
    answer:
      `The desktop app runs on Apple Silicon Macs with ${minMac} or later and on 64-bit Windows with ${minWindows} or later, and updates itself. On any other computer, including Intel Macs and Linux, Node Banana runs from source in a web browser with Node.js.`,
  },
  {
    question: "Does Node Banana work offline?",
    answer:
      "The app, your workflows and your generated media live on your own disk, and nothing is uploaded to Node Banana. Generating needs an internet connection, because each node sends its request to the provider you chose, such as Google or OpenAI.",
  },
  {
    question: "Where are my API keys and files stored?",
    answer:
      "API keys are encrypted in your operating system's profile for the app and are sent only to the provider they belong to. Workflows are JSON files and generated media are ordinary image, video and audio files, saved in the Node Banana folder in your Documents or in a project folder you choose.",
  },
  {
    question: "What is the Node Banana agent and what does it cost?",
    answer:
      "The agent is a chat window inside the app that creates workflows, edits the canvas and changes node settings for you. It runs on your existing Claude Code or ChatGPT (Codex) subscription through the vendor's own command-line tool, never on API credits, and it stops rather than spend extra usage.",
  },
  {
    question: "Can Node Banana run ComfyUI workflows?",
    answer:
      "Yes. Drop a ComfyUI workflow onto the canvas and it becomes a node: the workflow's App Mode inputs become sockets, its widgets become settings and its outputs become handles. The node runs on Comfy Cloud, on a ComfyUI on the same computer, or on one elsewhere on your network.",
  },
  {
    question: "How do I install Node Banana?",
    answer:
      "Download the Mac or Windows installer from nodebanana.app, open it, then paste the API keys for the providers you use into Settings → Providers. The Mac app is signed and notarised. The Windows installer is not yet code-signed, so SmartScreen may ask you to confirm the first time.",
  },
  {
    question: "Who made Node Banana?",
    answer:
      "Node Banana is made by Willie (Shrimbly on GitHub), with help from the open source community. Willie is a product designer at ComfyUI, and Node Banana is his passion project: a place to experiment with ideas and features for node-based interfaces.",
    links: {
      lead: "Find Willie on",
      items: [
        { label: "X", href: "https://x.com/ReflctWillie" },
        { label: "LinkedIn", href: "https://www.linkedin.com/in/willie-falloon-961a8a68/" },
      ],
    },
  },
];
