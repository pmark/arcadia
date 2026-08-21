import { NextResponse } from "next/server";
import { ArcadiaCliError, setupProjectContext } from "../../../../../lib/arcadia-cli";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Adopt this Project's repository from the Project page.
 *
 * The page is where the missing-PROJECT.md refusal is read, and until this
 * existed the only way to act on it was to leave for a terminal and know the
 * command by name. Adoption writes files into a repository, so it is a POST,
 * and it never overwrites a control document the operator already wrote.
 */
export async function POST(_request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    const response = await setupProjectContext(id);
    const { controlDocuments } = response.data;

    const wrote = [
      controlDocuments.projectDocument ? "PROJECT.md" : null,
      controlDocuments.plan ? "a first plan" : null
    ].filter((entry): entry is string => entry !== null);

    return NextResponse.json({
      message: wrote.length > 0
        ? `Adopted ${response.data.repoPath}. Wrote ${wrote.join(" and ")}.`
        : `Refreshed the Arcadia context files in ${response.data.repoPath}.`,
      // The reasons a document was deliberately left alone are the whole
      // answer when nothing was written, so they travel with the message
      // rather than only into a log.
      skipped: controlDocuments.skipped,
      result: response.data
    });
  } catch (error) {
    const details = error instanceof ArcadiaCliError ? error.details : null;
    const cause = details && typeof details === "object" && "cause" in details && typeof details.cause === "string"
      ? details.cause
      : null;
    return NextResponse.json(
      {
        error: cause ?? (error instanceof Error ? error.message : String(error)),
        details
      },
      { status: error instanceof ArcadiaCliError ? error.statusCode : 500 }
    );
  }
}
