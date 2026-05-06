import type { Config } from 'tailwindcss';
import { tokens } from './tokens';

const preset: Partial<Config> = {
  theme: {
    extend: {
      colors: {
        background: tokens.colors.background,
        foreground: tokens.colors.foreground,
        muted: {
          DEFAULT: tokens.colors.muted,
          foreground: tokens.colors.mutedForeground,
        },
        primary: {
          DEFAULT: tokens.colors.primary,
          foreground: tokens.colors.primaryForeground,
        },
        destructive: {
          DEFAULT: tokens.colors.destructive,
          foreground: tokens.colors.destructiveForeground,
        },
        accent: {
          DEFAULT: tokens.colors.accent,
          foreground: tokens.colors.accentForeground,
        },
        border: tokens.colors.border,
        input: tokens.colors.input,
        ring: tokens.colors.ring,
      },
      borderRadius: {
        lg: tokens.radius.lg,
        md: tokens.radius.md,
        sm: tokens.radius.sm,
      },
    },
  },
  plugins: [],
};

export default preset;
