import { stat } from "node:fs/promises";
import path from "node:path";
import { LIBRARY_PATH, SAFE_ID } from "../app/api/operator-script/route";

/**
 * `/actions?q=<id>` becomes `/actions/<id>` only when q is exactly an operator-script id, decided by
 * two stat calls on that id's own files: no library listing. Any other q stays a list search.
 */
export async function singleActionPath(q: string | string[] | undefined, library: string = LIBRARY_PATH): Promise<string | null> {
  const id = (Array.isArray(q) ? q[0] : q)?.trim();
  if (!id || !SAFE_ID.test(id)) return null;
  try {
    await stat(path.join(library, `${id}.json`));
    await stat(path.join(library, `${id}.sh`));
    return `/actions/${id}`;
  } catch {
    return null;
  }
}
