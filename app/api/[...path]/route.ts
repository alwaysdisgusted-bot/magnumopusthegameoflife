import { env } from "cloudflare:workers";
import { handleAuth, json, ApiError, type AuthEnv } from "../../../server/auth";
import { handleAcademy } from "../../../server/academy";
import { handleQuotes } from "../../../server/quotes";
import { handleDesk } from "../../../server/desk";
import { handleCalendar } from "../../../server/calendar";
import { handleStudy } from "../../../server/study";
import { handleCalendarNotes } from "../../../server/calendar-notes";
import { handleSocial } from "../../../server/social";
import { handleShowcase } from "../../../server/showcase";
import { handleLibraryCategories } from "../../../server/library-categories";
import { handleKnowledgeRequest } from "../../../server/knowledge";
import { handleKnowledgeGrimoireRequest } from "../../../server/knowledge-grimoire";

async function handle(request: Request) {
  const bindings = { ...env, DEV: import.meta.env.DEV } as unknown as AuthEnv;
  try {
    return await handleAuth(request, bindings)
      ?? await handleAcademy(request, bindings)
      ?? await handleQuotes(request, bindings)
      ?? await handleDesk(request, bindings)
      ?? await handleCalendarNotes(request, bindings)
      ?? await handleCalendar(request, bindings)
      ?? await handleStudy(request, bindings)
      ?? await handleKnowledgeRequest(request, bindings)
      ?? await handleKnowledgeGrimoireRequest(request, bindings)
      ?? await handleLibraryCategories(request, bindings)
      ?? await handleShowcase(request, bindings)
      ?? await handleSocial(request, bindings)
      ?? json({ error: { code: "not_found", message: "Táto stránka neexistuje." } }, 404);
  } catch (error) {
    const api = error instanceof ApiError ? error : new ApiError(503, "service_unavailable", "Služba momentálne nie je dostupná. Skús to znova.");
    return json({ error: { code: api.code, message: api.message } }, api.status);
  }
}

export { handle as GET, handle as POST, handle as PUT, handle as DELETE, handle as PATCH };
