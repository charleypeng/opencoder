// Shared error-copy hook (TASK-M9-02): components render ApiError titles
// through i18n — `errorTitleKey` classifies to a resource key, this hook
// resolves it with the current language and composes the "Title: detail"
// lines used by the dialogs/banners. The raw server message (extracted by
// errorDetailMessage) is never translated; it is dropped when it duplicates
// the translated title (the pre-i18n behavior).

import { useT } from "../i18n";
import { ApiError, errorDetailMessage, errorTitleKey } from "../services/errors";

export function useErrorCopy(): {
  /** Translated classified title of the error. */
  title: (err: ApiError) => string;
  /** "Title: detail" (title only when the raw message is absent or equal). */
  line: (err: ApiError) => string;
} {
  const t = useT();
  const title = (err: ApiError): string => {
    const ref = errorTitleKey(err);
    return t(ref.key, ref.options ?? {});
  };
  const line = (err: ApiError): string => {
    const translated = title(err);
    const detail = errorDetailMessage(err);
    return detail === null || detail === translated ? translated : `${translated}: ${detail}`;
  };
  return { title, line };
}
