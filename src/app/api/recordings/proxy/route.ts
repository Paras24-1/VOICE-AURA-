import { NextResponse } from "next/server";

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const targetUrl = searchParams.get("url");

  if (!targetUrl) {
    return new NextResponse("Missing url parameter", { status: 400 });
  }

  // Determine the gateway API URL (same pattern as campaigns/start)
  let gatewayUrl = process.env.GATEWAY_URL;
  if (!gatewayUrl && process.env.NEXT_PUBLIC_WS_URL) {
    gatewayUrl = process.env.NEXT_PUBLIC_WS_URL
      .replace(/^ws/, "http")
      .replace("/webRTC-stream", "");
  }

  const baseUrl = gatewayUrl || "http://localhost:5050";
  const proxyUrl = `${baseUrl}/api/recordings/proxy?url=${encodeURIComponent(targetUrl)}`;

  try {
    // Forward Range header from the browser for seeking support
    const headers: Record<string, string> = {};
    const rangeHeader = req.headers.get("range");
    if (rangeHeader) {
      headers["Range"] = rangeHeader;
    }

    console.log(`[Vercel Recording Proxy] Relaying to gateway: ${proxyUrl}`);
    const response = await fetch(proxyUrl, { headers });

    if (!response.ok && response.status !== 206) {
      const errText = await response.text();
      console.error(`[Vercel Recording Proxy] Gateway error: ${response.status} - ${errText}`);
      return new NextResponse(`Gateway error: ${errText}`, { status: response.status });
    }

    // Build response headers
    const responseHeaders = new Headers();
    responseHeaders.set("Content-Type", response.headers.get("content-type") || "audio/mpeg");

    const contentLength = response.headers.get("content-length");
    if (contentLength) {
      responseHeaders.set("Content-Length", contentLength);
    }

    const contentRange = response.headers.get("content-range");
    if (contentRange) {
      responseHeaders.set("Content-Range", contentRange);
    }

    const acceptRanges = response.headers.get("accept-ranges");
    if (acceptRanges) {
      responseHeaders.set("Accept-Ranges", acceptRanges);
    }

    // Stream the audio body through
    return new NextResponse(response.body as ReadableStream, {
      status: response.status,
      headers: responseHeaders,
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error("[Vercel Recording Proxy] Error:", message);
    return new NextResponse(`Proxy error: ${message}`, { status: 502 });
  }
}
