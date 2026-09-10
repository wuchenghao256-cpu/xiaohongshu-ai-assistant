import { ImageResponse } from "next/og";

export const size = { width: 180, height: 180 };
export const contentType = "image/png";

export default function AppleIcon() {
  return new ImageResponse(
    <div
      style={{
        alignItems: "center",
        background: "linear-gradient(145deg, #ff4d67 0%, #ff2442 58%, #d90b2c 100%)",
        color: "white",
        display: "flex",
        height: "100%",
        justifyContent: "center",
        width: "100%",
      }}
    >
      <div
        style={{
          alignItems: "center",
          background: "rgba(255,255,255,0.16)",
          border: "6px solid rgba(255,255,255,0.92)",
          borderRadius: 42,
          display: "flex",
          fontSize: 74,
          fontWeight: 800,
          height: 124,
          justifyContent: "center",
          letterSpacing: -7,
          lineHeight: 1,
          paddingRight: 7,
          width: 124,
        }}
      >
        小
      </div>
    </div>,
    size,
  );
}
