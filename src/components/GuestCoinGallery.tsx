import type { CSSProperties } from "react";
import { useInView } from "../lib/useInView";
import { coinFaces } from "./coin-faces";

type CoinStyle = CSSProperties & {
  "--coin-delay": string;
};

export const GuestCoinGallery = () => {
  // 画像は画面に近づいてから読み込む。初回表示の通信量を抑えるため
  const { ref, inView } = useInView<HTMLElement>();

  return (
    <section
      aria-label="Bar Misakiメンバーコイン"
      className="coin-preview"
      ref={ref}
    >
      <header>
        <p>CAST COINS</p>
        <p>09 MEMBERS</p>
      </header>
      {inView && (
        <div className="coin-preview-track">
          {coinFaces.map((face, index) => {
            const style: CoinStyle = { "--coin-delay": `${index * -0.85}s` };
            return (
              <div
                className="gallery-coin aspect-square"
                key={face.src}
                style={style}
              >
                <div className="gallery-coin__rotor">
                  <div
                    aria-label={`メンバーコイン ${index + 1}`}
                    className="gallery-coin__face gallery-coin__front"
                    role="img"
                    style={{
                      backgroundImage: `url(${face.src})`,
                      backgroundPosition: face.backgroundPosition,
                      backgroundSize: face.backgroundSize ?? "cover",
                    }}
                  />
                  <div className="gallery-coin__face gallery-coin__back">
                    <img
                      alt="Bar Misaki"
                      decoding="async"
                      draggable={false}
                      loading="lazy"
                      src={`${import.meta.env.BASE_URL}bar-misaki-mark.png`}
                    />
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
};
