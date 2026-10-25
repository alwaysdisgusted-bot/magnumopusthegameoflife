import gameHtml from "../public/index.html?raw";

export function GET() {
  return new Response(gameHtml, { headers: {
    "Content-Type": "text/html; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "same-origin",
  } });
}
