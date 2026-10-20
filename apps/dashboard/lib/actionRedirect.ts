import { stat } from "node:fs/promises";
import path from "node:path";
import { LIBRARY_PATH, SAFE_ID, SAFE_KEY, resolveLibraryEntry } from "../app/api/operator-script/route";

/**
 * `/actions?q=<id>` becomes `/actions/<id>` only when q is exactly an operator-script id (or a
 * `<project>--<id>` key of a registered Project's library), decided by two stat calls on that
 * entry's own files: no library listing. Any other q stays a list search.
 */
export async function singleActionPath(q: string | string[] | undefined, library: string = LIBRARY_PATH): Promise<string | null> {
  const id = (Array.isArray(q) ? q[0] : q)?.trim();
  if (!id || !SAFE_KEY.test(id)) return null;
  try {
    let directory = library;
    let file = id;
    if (!SAFE_ID.test(id)) {
      const entry = resolveLibraryEntry(id);
      directory = entry.library;
      file = entry.id;
    }
    await stat(path.join(directory, `${file}.json`));
    await stat(path.join(directory, `${file}.sh`));
    return `/actions/${id}`;
  } catch {
    return null;
  }
}
