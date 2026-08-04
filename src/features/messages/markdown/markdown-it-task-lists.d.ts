// Ambient declaration for markdown-it-task-lists: the package ships no
// types (no @types/markdown-it-task-lists exists), so the small plugin
// surface is declared here (TASK-M2-07).

declare module "markdown-it-task-lists" {
  import type MarkdownIt from "markdown-it";

  interface TaskListsOptions {
    /** Whether the checkboxes are clickable; disabled by default. */
    enabled?: boolean;
    /** Whether to wrap the label in a <label> element; default true. */
    label?: boolean;
  }

  function taskLists(md: MarkdownIt, options?: TaskListsOptions): void;

  export default taskLists;
}
