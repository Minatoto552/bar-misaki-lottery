import type { CSSProperties } from 'react';
import { coinFaces } from './coin-faces';

type CoinStyle = CSSProperties & {
  '--coin-delay': string;
};

export const GuestCoinGallery = () => (
  <section aria-label="Bar Misakiメンバーコイン" className="mt-10 rounded-[32px] border border-white/45 bg-[rgba(242,242,238,0.62)] p-5 shadow-[0_20px_70px_rgba(25,40,55,0.12)] backdrop-blur-xl sm:p-7">
    <div className="mb-5 flex items-end justify-between gap-4">
      <div>
        <p className="text-xs font-bold tracking-[0.18em] text-[var(--color-accent)]">BAR MISAKI COINS</p>
        <h2 className="mt-1 text-xl font-bold sm:text-2xl">メンバーコイン</h2>
      </div>
      <p className="hidden text-xs font-semibold opacity-50 sm:block">表：メンバー / 裏：Bar Misaki</p>
    </div>
    <div className="grid grid-cols-3 gap-3 sm:grid-cols-5 sm:gap-5 lg:grid-cols-9">
      {coinFaces.map((face, index) => {
        const style: CoinStyle = { '--coin-delay': `${index * -0.85}s` };
        return (
          <div className="gallery-coin aspect-square" key={face.src} style={style}>
            <div className="gallery-coin__rotor">
              <div
                aria-label={`メンバーコイン ${index + 1}`}
                className="gallery-coin__face gallery-coin__front"
                role="img"
                style={{ backgroundImage: `url(${face.src})`, backgroundPosition: face.backgroundPosition, backgroundSize: face.backgroundSize ?? 'cover' }}
              />
              <div className="gallery-coin__face gallery-coin__back">
                <img alt="Bar Misaki" draggable={false} src={`${import.meta.env.BASE_URL}bar-misaki-mark.png`} />
              </div>
            </div>
          </div>
        );
      })}
    </div>
  </section>
);
