export const Logo = ({ size = 26 }: { size?: number; }) => (
  <svg
    width={size}
    height={size}
    viewBox='0 0 32 32'
    fill='none'
    aria-hidden='true'
  >
    <rect width='32' height='32' rx='9' fill='currentColor' />
    <path
      d='M8 21V11l8 6 8-6v10M8 21l8-6 8 6'
      stroke='var(--logo-ink)'
      strokeWidth='1.8'
      strokeLinecap='round'
      strokeLinejoin='round'
    />
  </svg>
);
