import { ImageResponse } from "next/og";

export const size = { width: 512, height: 512 };
export const contentType = "image/png";

export default function Icon() {
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
          border: "18px solid rgba(255,255,255,0.92)",
          borderRadius: 120,
          display: "flex",
          fontSize: 210,
          fontWeight: 800,
          height: 350,
          justifyContent: "center",
          letterSpacing: -20,
          lineHeight: 1,
          paddingRight: 20,
          width: 350,
        }}
      >
        小
      </div>
    </div>,
    size,
  );
}
