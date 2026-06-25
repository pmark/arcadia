import { ImageResponse } from "next/og";

export const size = { width: 180, height: 180 };
export const contentType = "image/png";

export default function AppleIcon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "#f5f7f8"
        }}
      >
        <div
          style={{
            width: 130,
            height: 130,
            borderRadius: "50%",
            background: "#2f6f55",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            color: "#f5f7f8",
            fontSize: 96,
            fontWeight: 700,
            fontFamily: "system-ui"
          }}
        >
          A
        </div>
      </div>
    ),
    { ...size }
  );
}
