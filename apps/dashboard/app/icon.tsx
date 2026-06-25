import { ImageResponse } from "next/og";

export const size = { width: 512, height: 512 };
export const contentType = "image/png";

export default function Icon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "#f5f7f8",
          borderRadius: 64
        }}
      >
        <div
          style={{
            width: 280,
            height: 280,
            borderRadius: "50%",
            background: "#2f6f55",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            color: "#f5f7f8",
            fontSize: 220,
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
