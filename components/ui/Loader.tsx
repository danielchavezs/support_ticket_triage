'use client';

import type React from 'react';

export type LoaderProps = {
  className?: string;
  color?: string;
  ariaLabel?: string;
  style?: React.CSSProperties;
};

export default function Loader(props: LoaderProps) {
  const {
    className,
    color = '#ffffff',
    ariaLabel = 'Loading',
    style,
  } = props;

  const mergedClassName = ['loadership_TPWNH', className].filter(Boolean).join(' ');
  const mergedStyle: React.CSSProperties & { ['--loader-dot-color']?: string } = {
    ...(style ?? {}),
    ['--loader-dot-color']: color,
  };

  return (
    <div role="status" aria-live="polite" aria-label={ariaLabel} className={mergedClassName} style={mergedStyle}>
      <div />
      <div />
      <div />
      <div />
      <style jsx>{`
        .loadership_TPWNH {
          display: flex;
          position: relative;
          width: 61px;
          height: 13px;
        }

        .loadership_TPWNH div {
          position: absolute;
          width: 13px;
          height: 13px;
          border-radius: 50%;
          background: var(--loader-dot-color, #ffffff);
          top: 0px;
          animation-timing-function: cubic-bezier(0, 1, 1, 0);
        }

        .loadership_TPWNH div:nth-child(1) {
          left: 0px;
          animation: loadership_TPWNH_scale_up 0.6s infinite;
        }

        .loadership_TPWNH div:nth-child(2) {
          left: 0px;
          animation: loadership_TPWNH_translate 0.6s infinite;
        }

        .loadership_TPWNH div:nth-child(3) {
          left: 24px;
          animation: loadership_TPWNH_translate 0.6s infinite;
        }

        .loadership_TPWNH div:nth-child(4) {
          left: 48px;
          animation: loadership_TPWNH_scale_down 0.6s infinite;
        }

        @keyframes loadership_TPWNH_scale_up {
          0% {
            transform: scale(0);
          }
          100% {
            transform: scale(1);
          }
        }

        @keyframes loadership_TPWNH_scale_down {
          0% {
            transform: scale(1);
          }
          100% {
            transform: scale(0);
          }
        }

        @keyframes loadership_TPWNH_translate {
          0% {
            transform: translate(0, 0);
          }
          100% {
            transform: translate(24px, 0);
          }
        }
      `}</style>
    </div>
  );
}
