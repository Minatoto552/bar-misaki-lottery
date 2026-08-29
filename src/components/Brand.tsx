import { Link } from 'react-router-dom';

export const BrandMark = ({ size = 'md' }: { size?: 'sm' | 'md' | 'lg' }) => {
  const sizes = { sm: 'h-10 w-10', md: 'h-12 w-12', lg: 'h-20 w-20' };
  return <img alt="BarMisaki" className={`${sizes[size]} rounded-full border border-white/60 bg-white object-cover shadow-[0_4px_18px_rgba(25,40,55,0.16)]`} src="/bar-misaki-mark.png" />;
};

export const PublicHeader = () => (
  <header className="relative z-10 mx-auto flex max-w-7xl items-center justify-between px-5 py-4 sm:px-8 sm:py-5">
    <div className="flex items-center gap-3">
      <Link aria-label="ホームに戻る" className="rounded-full transition-transform hover:scale-105" to="/lottery"><BrandMark /></Link>
      <span className="text-sm font-bold tracking-[0.18em]">BAR MISAKI</span>
    </div>
    <span className="hidden rounded-full bg-white/45 px-4 py-2 text-xs font-semibold backdrop-blur-sm sm:block">SPECIAL LOTTERY</span>
  </header>
);
