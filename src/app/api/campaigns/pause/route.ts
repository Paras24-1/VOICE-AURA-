import { NextResponse } from "next/server";

export async function POST(req: Request) {
  try {
    const body = await req.json();
    
    // Determine the gateway API URL
    let gatewayUrl = process.env.GATEWAY_URL;
    
    if (!gatewayUrl && process.env.NEXT_PUBLIC_WS_URL) {
      gatewayUrl = process.env.NEXT_PUBLIC_WS_URL
        .replace(/^ws/, "http")
        .replace("/webRTC-stream", "");
    }
    
    // Default fallback list of URLs to try in development
    const urlsToTry = gatewayUrl 
      ? [gatewayUrl] 
      : ["http://localhost:5050", "http://localhost:8080"];
      
    let lastError: any = null;
    let response: Response | null = null;
    
    for (const url of urlsToTry) {
      try {
        console.log(`[Proxy] Forwarding pause campaign request to: ${url}/api/campaigns/pause`);
        response = await fetch(`${url}/api/campaigns/pause`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify(body),
        });
        if (response.ok) {
          break;
        }
      } catch (err) {
        lastError = err;
      }
    }
    
    if (!response) {
      return NextResponse.json(
        { error: `Gateway connection failed. Make sure server.js is running. Error: ${lastError?.message || "No response"}` },
        { status: 502 }
      );
    }
    
    if (!response.ok) {
      const errText = await response.text();
      return NextResponse.json(
        { error: errText || "Response not OK from Gateway" },
        { status: response.status }
      );
    }
    
    const data = await response.json();
    return NextResponse.json(data);
  } catch (error: any) {
    console.error("Proxy pause campaign error:", error);
    return NextResponse.json(
      { error: error.message || "Internal Server Error in campaign pause proxy" },
      { status: 500 }
    );
  }
}
