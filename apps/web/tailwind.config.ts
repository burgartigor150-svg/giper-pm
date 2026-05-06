import type { Config } from 'tailwindcss';
import preset from '@giper/ui/tailwind-preset';

const config: Config = {
  content: [
    './app/**/*.{ts,tsx}',
    './components/**/*.{ts,tsx}',
    '../../packages/ui/src/**/*.{ts,tsx}',
  ],
  presets: [preset as Config],
  theme: {
    extend: {},
  },
  plugins: [],
};

export default config;
