import { ImageResponse } from "next/og";
import { SITE_NAME } from "@/lib/metadata";

export const alt = `${SITE_NAME} — Projetos & Artigos`;
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function OpenGraphImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
          backgroundColor: "#facc15",
          border: "12px solid #000",
          padding: "64px",
        }}
      >
        <div
          style={{
            fontSize: 72,
            fontWeight: 900,
            color: "#000",
            letterSpacing: "-0.04em",
            marginBottom: 24,
          }}
        >
          godri<span style={{ color: "#f472b6" }}>.</span>dev
        </div>
        <div
          style={{
            fontSize: 32,
            fontWeight: 700,
            color: "#000",
            maxWidth: 900,
            lineHeight: 1.3,
          }}
        >
          Open source · software engineer · tech lead
        </div>
      </div>
    ),
    { ...size }
  );
}
