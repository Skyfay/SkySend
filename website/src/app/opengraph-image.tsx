import { ImageResponse } from "next/og";
import { TAGLINE } from "@/lib/content";

export const dynamic = "force-static";
export const alt = "SkySend - End-to-End Encrypted File & Note Sharing";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default async function Image() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
          padding: "80px",
          background: "#0b0e14",
          color: "#f5f6f8",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "20px",
            fontSize: 40,
            fontWeight: 700,
          }}
        >
          <div
            style={{
              display: "flex",
              width: 56,
              height: 56,
              borderRadius: 14,
              background: "#46c89d",
            }}
          />
          SkySend
        </div>
        <div
          style={{
            display: "flex",
            marginTop: 48,
            fontSize: 52,
            fontWeight: 700,
            lineHeight: 1.15,
            maxWidth: 950,
          }}
        >
          Share files and notes, without anyone reading them.
        </div>
        <div
          style={{
            display: "flex",
            marginTop: 28,
            fontSize: 28,
            color: "#9aa1ad",
            maxWidth: 900,
          }}
        >
          {TAGLINE}
        </div>
      </div>
    ),
    { ...size }
  );
}
