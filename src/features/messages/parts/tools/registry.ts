// Tool card registry (TASK-M3-01): maps tool names to their renderers,
// falling back to the generic JSON card for anything unlisted (mcp__*,
// todoWrite, webFetch, ...).

import BashCard from "./BashCard.js";
import EditCard from "./EditCard.js";
import GenericCard from "./GenericCard.js";
import GlobCard from "./GlobCard.js";
import GrepCard from "./GrepCard.js";
import ReadCard from "./ReadCard.js";
import WriteCard from "./WriteCard.js";
import type { ToolCard } from "./shared.js";

const toolCards: Record<string, ToolCard> = {
  bash: BashCard,
  edit: EditCard,
  read: ReadCard,
  write: WriteCard,
  glob: GlobCard,
  grep: GrepCard,
};

export function resolveToolCard(tool: string): ToolCard {
  return toolCards[tool] ?? GenericCard;
}
