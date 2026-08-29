export type CoinFace = {
  backgroundPosition: string;
  backgroundSize?: string;
  src: string;
};

export const coinFaces: CoinFace[] = [
  { src: `${import.meta.env.BASE_URL}coin-faces/guest-01.webp`, backgroundPosition: '45% 50%' },
  { src: `${import.meta.env.BASE_URL}coin-faces/guest-02.webp`, backgroundPosition: '51% 31%' },
  { src: `${import.meta.env.BASE_URL}coin-faces/guest-03.webp`, backgroundPosition: '60% 21%', backgroundSize: '200% auto' },
  { src: `${import.meta.env.BASE_URL}coin-faces/guest-04.webp`, backgroundPosition: '50% 14%', backgroundSize: '125% auto' },
  { src: `${import.meta.env.BASE_URL}coin-faces/guest-05.webp`, backgroundPosition: '50% 25%', backgroundSize: '130% auto' },
  { src: `${import.meta.env.BASE_URL}coin-faces/guest-06.webp`, backgroundPosition: '48% 23%', backgroundSize: '135% auto' },
  { src: `${import.meta.env.BASE_URL}coin-faces/guest-07.webp`, backgroundPosition: '50% 25%', backgroundSize: '130% auto' },
  { src: `${import.meta.env.BASE_URL}coin-faces/guest-08.webp`, backgroundPosition: '40% 0%', backgroundSize: 'auto 145%' },
  { src: `${import.meta.env.BASE_URL}coin-faces/guest-09.webp`, backgroundPosition: '4% 14%', backgroundSize: '135% auto' },
];
